import assert from "node:assert/strict";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, it } from "vitest";
import { createDatabase } from "./pg.js";
import { postgresDatabaseRuntime } from "./runtime/index.js";
import type { DatabaseRuntimeBundle, TransactionHandle } from "./runtime/index.js";
import type { Locks } from "./runtime/locks/index.js";
import type { Database } from "./types.js";

const START_ACCESS = {
  sessionId: "session",
  userId: "operator",
  membershipId: "member",
  organizationId: "org",
  returnRoute: "/",
};
const CALLBACK_ACCESS = { sessionId: "session", userId: "operator" };
const LINEAR_ORGANIZATION_ID = "linear-organization";
const LINEAR_EXTERNAL_LOCK_KEY = JSON.stringify([
  "paseo-connection",
  "linear",
  "external",
  LINEAR_ORGANIZATION_ID,
]);

describe("Linear token refresh persistence", () => {
  it("serializes an expired refresh with OAuth rebind on the canonical transaction lock", async () => {
    const postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    const bundle = await postgresDatabaseRuntime(postgres.getConnectionUri());
    try {
      await seedAuthority(bundle);
      let sessionLockCalls = 0;
      let captureExternalLocks = false;
      const externalLockKeys: string[] = [];
      let markSecondExternalLock!: () => void;
      const secondExternalLock = new Promise<void>((resolve) => {
        markSecondExternalLock = resolve;
      });
      const locks: Locks = {
        withLock: async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
          sessionLockCalls += 1;
          return bundle.locks.withLock(key, operation);
        },
        withTxLock: async (transaction: TransactionHandle, key: string): Promise<void> => {
          if (captureExternalLocks && key === LINEAR_EXTERNAL_LOCK_KEY) {
            externalLockKeys.push(key);
            if (externalLockKeys.length === 2) markSecondExternalLock();
          }
          await bundle.locks.withTxLock(transaction, key);
        },
      };
      // Separate database facades model independent Hub processes. Their only coordination is
      // the PostgreSQL transaction lock, not the client-local refresh promise map.
      const refreshDatabase = createDatabase(bundle.runtime, locks);
      const rebindDatabase = createDatabase(bundle.runtime, locks);

      await startLinearAttempt(rebindDatabase, "initial");
      await bindLinearConnection(rebindDatabase, "initial", {
        accessToken: "expired-access-token",
        refreshToken: "old-rotating-refresh-token",
        accessTokenExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
      });
      await startLinearAttempt(rebindDatabase, "rebind");

      let releaseRefresh!: () => void;
      let markRefreshEntered!: () => void;
      const refreshEntered = new Promise<void>((resolve) => {
        markRefreshEntered = resolve;
      });
      const refreshReleased = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      captureExternalLocks = true;
      const refresh = refreshDatabase.withLinearConnectionRefresh(
        LINEAR_ORGANIZATION_ID,
        async (connection, updateTokens) => {
          assert.equal(connection?.accessToken, "expired-access-token");
          markRefreshEntered();
          await refreshReleased;
          await updateTokens({
            accessToken: "refreshed-access-token",
            refreshToken: "next-rotating-refresh-token",
            accessTokenExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
          });
        },
      );
      await refreshEntered;
      const rebind = bindLinearConnection(rebindDatabase, "rebind", {
        accessToken: "rebound-access-token",
        refreshToken: "rebound-refresh-token",
        accessTokenExpiresAt: new Date("2031-01-01T00:00:00.000Z"),
      });
      try {
        await settlesWithin(
          secondExternalLock,
          3_000,
          "OAuth rebind did not reach the Linear external-connection lock",
        );
      } finally {
        releaseRefresh();
        await Promise.all([refresh, rebind]);
      }

      assert.deepEqual(externalLockKeys, [LINEAR_EXTERNAL_LOCK_KEY, LINEAR_EXTERNAL_LOCK_KEY]);
      assert.equal(sessionLockCalls, 0);
      const connection = await rebindDatabase.findLinearConnection(LINEAR_ORGANIZATION_ID);
      assert.equal(connection?.accessToken, "rebound-access-token");
      assert.equal(connection?.refreshToken, "rebound-refresh-token");
      assert.deepEqual(connection?.accessTokenExpiresAt, new Date("2031-01-01T00:00:00.000Z"));
    } finally {
      await bundle.runtime.close();
      await postgres.stop();
    }
  }, 120_000);
});

async function startLinearAttempt(database: Database, stateVerifier: string): Promise<void> {
  await database.startConnectionAttempt({
    provider: "linear",
    stateVerifier,
    access: START_ACCESS,
    lifetimeMinutes: 10,
    configurationVersion: 0,
    providerApplicationId: "linear-app",
    callbackOrigin: "https://hub.example.test",
    configurationSnapshot: { provider: "linear" },
    expectedConfigurationVersion: null,
    activateConfiguration: false,
  });
}

function bindLinearConnection(
  database: Database,
  stateVerifier: string,
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: Date;
  },
): Promise<void> {
  return database.bindLinearConnection({
    stateVerifier,
    phase: "linear_authorization",
    access: CALLBACK_ACCESS,
    providerApplicationId: "linear-app",
    linearOrganizationId: LINEAR_ORGANIZATION_ID,
    linearOrganizationName: "Acme",
    appUserId: "linear-app-user",
    ...tokens,
    scopes: ["read", "comments:create"],
  });
}

async function seedAuthority(bundle: DatabaseRuntimeBundle): Promise<void> {
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at,
                         must_change_password, is_instance_operator)
     values ('operator', 'Operator', 'operator@example.test', true, now(), now(), false, true)`,
  );
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ('org', 'Org', 'org')`,
  );
  await bundle.runtime.query(
    `insert into session (id, token, user_id, active_organization_id, expires_at)
     values ('session', 'token', 'operator', 'org', now() + interval '1 hour')`,
  );
  await bundle.runtime.query(
    `insert into member (id, organization_id, user_id, role)
     values ('member', 'org', 'operator', 'owner')`,
  );
  await bundle.runtime.query(
    `insert into runtime_provider_activation (provider, provider_application_id, configuration_version)
     values ('linear', 'linear-app', 0)`,
  );
}

async function settlesWithin<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
