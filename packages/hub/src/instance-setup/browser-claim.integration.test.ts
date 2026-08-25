import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { z } from "zod";
import {
  createDatabase,
  createPostgresPool,
  testDatabaseLocks,
  testDatabaseRuntime,
} from "../db/test-utils/runtime.js";
import type { Database } from "../db/types.js";
import { composeEntitlements, type ComposedEntitlements } from "../auth/entitlements.js";
import { createAuthServer, type AuthServer } from "../auth/server.js";
import type { InstanceAuthPolicy } from "../auth/instance-policy.js";
import { RegistrationAdmissionError } from "../auth/registration-admission.js";
import type { InitialOperator } from "./index.js";
import { TRUSTED_REQUEST_ORIGIN_HEADER } from "../http/request-origin.js";

const ORIGIN = "http://localhost:3000";

/** node-postgres' default pool size — the burst has to be at least this wide to matter. */
const POOL_SIZE = 10;

const operator: InitialOperator = {
  email: "browser.operator@example.test",
  password: "browser-operator-password",
};

const accountStateSchema = z
  .object({
    status: z.string(),
    account: z.object({ email: z.string() }).optional(),
    organization: z.object({ name: z.string(), slug: z.string() }).optional(),
    isInstanceOperator: z.boolean().optional(),
    registration: z.string().optional(),
  })
  .passthrough();

describe("first-run claim at the browser boundary", () => {
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
  }, 120_000);

  afterAll(async () => {
    await postgres.stop();
  }, 120_000);

  it("turns a pristine instance into a signed-in operator", async () => {
    const instance = await startInstance(postgres, "browser_claim");
    try {
      assert.equal((await readAccountState(instance.auth)).status, "instanceSetupRequired");

      const claim = await instance.auth.claimInstance!(
        {
          ...operator,
          name: "Client-controlled operator",
          organizationName: "Client-controlled organization",
        } as InitialOperator & { name: string; organizationName: string },
        browserHeaders(),
      );
      assert.deepEqual(claim, { status: "claimed" });

      // The claim itself established the browser session — nothing signed in afterwards.
      assert.deepEqual(await sessionsPerOperator(instance), [
        { email: operator.email, sessions: 1 },
      ]);

      // The claimed instance shows ordinary sign-in to anyone without a session.
      const signedOut = await readAccountState(instance.auth);
      assert.equal(signedOut.status, "signedOut");
      assert.equal(signedOut.registration, "invite_only");

      // The chosen password is final, but the first operator must explicitly finish or skip app
      // setup before the durable account state becomes active.
      const cookie = await signIn(instance.auth, operator.email, operator.password);
      const appSetup = await readAccountState(instance.auth, cookie);
      assert.equal(appSetup.status, "appSetupRequired");
      // App setup already resolves the organization the daemon handoff has to address, and it is
      // the same one the dashboard opens on — the handoff never re-resolves it.
      assert.match(appSetup.organization?.slug ?? "", /^paseo-hub-[0-9a-f]{8}$/u);
      await instance.auth.completeAppOnboarding!(
        new Request(`${ORIGIN}/`, {
          method: "POST",
          headers: { cookie, origin: ORIGIN },
        }),
      );
      const active = await readAccountState(instance.auth, cookie);
      assert.equal(active.status, "active");
      assert.equal(active.account?.email, operator.email);
      assert.equal(active.organization?.name, "Paseo Hub");
      assert.equal(active.organization?.slug, appSetup.organization?.slug);
      assert.equal(active.isInstanceOperator, true);

      const storedNames = await instance.database.query<{
        account_name: string;
        organization_name: string;
      }>(
        `select "user".name as account_name, organization.name as organization_name
         from instance_bootstrap
         join "user" on "user".id = instance_bootstrap.owner_user_id
         join organization on organization.id = instance_bootstrap.organization_id`,
      );
      assert.deepEqual(storedNames.rows, [
        { account_name: "browser.operator", organization_name: "Paseo Hub" },
      ]);
    } finally {
      await instance.close();
    }
  }, 120_000);

  /**
   * A pool's worth of real Better Auth signups against one claim. The claim's table lock is the
   * only serialization, and it is held inside the claim's own transaction, so no registration
   * parks a connection waiting for it: every request has to finish. An earlier design wrapped
   * each signup in a session advisory lock and starved this exact scenario of connections.
   */
  it("settles a pool-sized signup burst racing a claim", async () => {
    const instance = await startInstance(postgres, "browser_claim_burst", "open");
    try {
      const started = Date.now();
      const signups = Array.from({ length: POOL_SIZE }, (_, index) =>
        instance.auth.signUpEmail!(
          {
            name: `Burst ${index}`,
            email: `burst-${index}@example.test`,
            password: `burst-${index}-password`,
          },
          browserHeaders(),
        ),
      );
      const outcomes = await Promise.allSettled([
        instance.auth.claimInstance!(operator, browserHeaders()),
        ...signups,
      ]);

      // Nothing timed out, deadlocked, or was starved of a connection.
      assert.deepEqual(outcomes.filter(({ status }) => status === "rejected").map(reasonOf), []);
      assert.ok(Date.now() - started < 30_000);
      const claim = outcomes[0];
      assert.ok(claim.status === "fulfilled");
      const claimed = claim.value.status === "claimed";
      assert.deepEqual(await claimOutcome(instance), {
        operators: claimed ? 1 : 0,
        completions: claimed ? 1 : 0,
        // The claim only provisions on a database it found empty, so a completed claim means it
        // went first and every signup landed after it.
        users: claimed ? POOL_SIZE + 1 : POOL_SIZE,
        completionOwnedByOperator: claimed,
      });
    } finally {
      await instance.close();
    }
  }, 180_000);

  /**
   * The same burst under invite-only. Registration admission refuses each one on its own, before
   * anything touches instance setup, and the claim is unaffected.
   */
  it("refuses an inadmissible signup burst without disturbing the claim", async () => {
    const instance = await startInstance(postgres, "browser_claim_burst_closed");
    try {
      const outcomes = await Promise.allSettled([
        instance.auth.claimInstance!(operator, browserHeaders()),
        ...Array.from({ length: POOL_SIZE }, (_, index) =>
          instance.auth.signUpEmail!(
            {
              name: `Closed ${index}`,
              email: `closed-${index}@example.test`,
              password: `closed-${index}-password`,
            },
            browserHeaders(),
          ),
        ),
      ]);

      const [claim, ...signups] = outcomes;
      assert.deepEqual(claim, { status: "fulfilled", value: { status: "claimed" } });
      assert.deepEqual(
        signups.map((outcome) => outcome.status === "rejected" && isAdmissionRefusal(outcome)),
        Array.from({ length: POOL_SIZE }, () => true),
      );
      assert.deepEqual(await claimOutcome(instance), {
        operators: 1,
        completions: 1,
        users: 1,
        completionOwnedByOperator: true,
      });
    } finally {
      await instance.close();
    }
  }, 180_000);

  it("refuses a claim that does not come from the browser origin", async () => {
    const instance = await startInstance(postgres, "browser_claim_origin");
    try {
      await assert.rejects(
        instance.auth.claimInstance!(operator, new Headers({ origin: "https://attacker.test" })),
        /invalid origin/u,
      );
      await assert.rejects(
        instance.auth.claimInstance!(operator, new Headers()),
        /invalid origin/u,
      );

      assert.equal(await countUsers(instance), 0);
      assert.equal((await readAccountState(instance.auth)).status, "instanceSetupRequired");
    } finally {
      await instance.close();
    }
  }, 120_000);

  it("claims through the adapter's trusted reverse-proxy origin", async () => {
    const instance = await startInstance(postgres, "browser_claim_proxy_origin");
    try {
      const externalOrigin = "https://hub.example.test";
      const headers = new Headers({ origin: externalOrigin });
      headers.set(TRUSTED_REQUEST_ORIGIN_HEADER, externalOrigin);

      assert.deepEqual(await instance.auth.claimInstance!(operator, headers), {
        status: "claimed",
      });
      assert.deepEqual(await sessionsPerOperator(instance), [
        { email: operator.email, sessions: 1 },
      ]);
    } finally {
      await instance.close();
    }
  }, 120_000);

  it("keeps ordinary registration from claiming the instance", async () => {
    const instance = await startInstance(postgres, "browser_claim_signup", "open");
    try {
      await instance.auth.signUpEmail!(
        { name: "Ordinary", email: "ordinary@example.test", password: "ordinary-password" },
        browserHeaders(),
      );

      const operators = await instance.database.query<{ count: number }>(
        `select count(*)::integer as count from "user" where is_instance_operator`,
      );
      assert.equal(operators.rows[0]?.count, 0);
      // The account exists, so the instance is no longer provably unowned: setup closes and the
      // welcome journey gives way to sign-in without anyone having claimed operator authority.
      assert.equal((await readAccountState(instance.auth)).status, "signedOut");
      assert.deepEqual(await instance.auth.claimInstance!(operator, browserHeaders()), {
        status: "unavailable",
      });
    } finally {
      await instance.close();
    }
  }, 120_000);
});

interface RunningInstance {
  auth: AuthServer;
  database: ReturnType<typeof testDatabaseRuntime>;
  locks: ReturnType<typeof testDatabaseLocks>;
  close(): Promise<void>;
}

async function startInstance(
  postgres: StartedPostgreSqlContainer,
  name: string,
  registrationMode: InstanceAuthPolicy["registrationMode"] = "invite_only",
): Promise<RunningInstance> {
  const url = await isolatedDatabaseUrl(postgres.getConnectionUri(), name);
  const database: Database = await createDatabase(url);
  const entitlements: ComposedEntitlements = composeEntitlements(
    database,
    testDatabaseRuntime(database),
  );
  const auth = createAuthServer({
    database: testDatabaseRuntime(database),
    locks: testDatabaseLocks(database),
    entitlements: entitlements.service,
    secret: "first-run-claim-secret-at-least-32-characters",
    baseURL: ORIGIN,
    policy: { registrationMode, organizationCreation: "disabled", bootstrap: undefined },
  });
  return {
    auth,
    database: testDatabaseRuntime(database),
    locks: testDatabaseLocks(database),
    async close() {
      await auth.close();
      await entitlements.close();
      await database.close();
    },
  };
}

function browserHeaders(): Headers {
  return new Headers({ origin: ORIGIN });
}

async function readAccountState(auth: AuthServer, cookie?: string) {
  const response = await auth.browserAccount!(
    new Request(
      `${ORIGIN}/api/auth/paseo/state`,
      cookie === undefined ? {} : { headers: { cookie } },
    ),
  );
  assert.equal(response.status, 200);
  return accountStateSchema.parse(await response.json());
}

/** One row per instance operator with the number of sessions Better Auth has issued to it. */
async function sessionsPerOperator(instance: RunningInstance) {
  const result = await instance.database.query<{ email: string; sessions: number }>(
    `select "user".email,
            (select count(*)::integer from session where session.user_id = "user".id) as sessions
     from "user"
     where "user".is_instance_operator
     order by "user".email`,
  );
  return result.rows;
}

async function claimOutcome(instance: RunningInstance) {
  const result = await instance.database.query<{
    operators: number;
    completions: number;
    users: number;
    completion_owned_by_operator: boolean;
  }>(`
    select
      (select count(*)::integer from "user" where is_instance_operator) as operators,
      (select count(*)::integer from instance_bootstrap where completed_at is not null) as completions,
      (select count(*)::integer from "user") as users,
      exists (
        select 1 from instance_bootstrap
        join "user" on "user".id = instance_bootstrap.owner_user_id
        where instance_bootstrap.completed_at is not null and "user".is_instance_operator
      ) as completion_owned_by_operator
  `);
  const row = result.rows[0]!;
  return {
    operators: row.operators,
    completions: row.completions,
    users: row.users,
    completionOwnedByOperator: row.completion_owned_by_operator,
  };
}

function reasonOf(outcome: PromiseSettledResult<unknown>): unknown {
  return outcome.status === "rejected" ? outcome.reason : undefined;
}

function isAdmissionRefusal(outcome: PromiseRejectedResult): boolean {
  return outcome.reason instanceof RegistrationAdmissionError;
}

async function countUsers(instance: RunningInstance): Promise<number> {
  const result = await instance.database.query<{ count: number }>(
    `select count(*)::integer as count from "user"`,
  );
  return result.rows[0]?.count ?? -1;
}

async function signIn(auth: AuthServer, email: string, password: string): Promise<string> {
  const response = await auth.handle(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  assert.equal(response.status, 200);
  const cookie = response.headers
    .get("set-cookie")
    ?.match(/^(?:[^;]+);/u)?.[0]
    ?.slice(0, -1);
  if (cookie === undefined) throw new Error("sign-in did not issue a session cookie");
  return cookie;
}

async function isolatedDatabaseUrl(baseUrl: string, name: string): Promise<string> {
  const base = new URL(baseUrl);
  base.pathname = "/postgres";
  const admin = await createPostgresPool(base.toString());
  const databaseName = `${name}_${Date.now()}`;
  await admin.query(`create database "${databaseName}"`);
  await admin.close();
  base.pathname = `/${databaseName}`;
  return base.toString();
}
