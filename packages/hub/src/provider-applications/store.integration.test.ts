import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterEach, describe, it } from "vitest";
import {
  embeddedDatabaseRuntime,
  postgresDatabaseRuntime,
  type DatabaseRuntimeBundle,
} from "../db/runtime/index.js";
import { createDatabase } from "../db/pg.js";
import { createProviderApplicationInventory, createProviderApplicationStore } from "./index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("provider application persistence", () => {
  it("persists, versions, and reopens write-only provider configuration in PGlite", async () => {
    const root = await mkdtemp(join(tmpdir(), "hub-provider-applications-"));
    roots.push(root);
    const first = await embeddedDatabaseRuntime(root);
    await exercisePersistence(first);
    await exerciseSlackAtomicTransition(first);
    await first.runtime.close();

    const reopened = await embeddedDatabaseRuntime(root);
    await reopened.runtime.migrate();
    const stored = await createProviderApplicationStore(reopened.runtime, reopened.locks).read(
      "github",
    );
    assert.equal(stored?.version, 2);
    assert.equal(stored?.configuration.provider, "github");
    if (stored?.configuration.provider === "github") {
      assert.equal(stored.configuration.clientSecret, "rotated");
    }
    await reopened.runtime.close();
  });

  it("persists and serializes concurrent first saves in PostgreSQL", async () => {
    const postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    try {
      const bundle = await postgresDatabaseRuntime(postgres.getConnectionUri());
      await exercisePersistence(bundle);
      await exerciseSlackAtomicTransition(bundle);
      await bundle.runtime.close();

      const reopened = await postgresDatabaseRuntime(postgres.getConnectionUri());
      const stored = await createProviderApplicationStore(reopened.runtime, reopened.locks).read(
        "github",
      );
      assert.equal(stored?.version, 2);
      await reopened.runtime.close();
    } finally {
      await postgres.stop();
    }
  });
});

async function exercisePersistence(bundle: DatabaseRuntimeBundle) {
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at,
                         must_change_password, is_instance_operator)
     values ('operator', 'Operator', 'operator@example.test', true, now(), now(), false, true)`,
  );
  const store = createProviderApplicationStore(bundle.runtime, bundle.locks);
  const configuration = {
    provider: "github" as const,
    appId: "42",
    appSlug: "paseo",
    clientId: "client",
    clientSecret: "secret",
    privateKey: "private-key",
    webhookSecret: "webhook-secret",
  };
  const identity = {
    provider: "github" as const,
    id: "42",
    name: "Paseo",
    ownerLogin: "acme",
  };
  const attempts = await Promise.allSettled([
    store.save({
      provider: "github",
      configuration,
      identity,
      expectedVersion: undefined,
      updatedByUserId: "operator",
    }),
    store.save({
      provider: "github",
      configuration,
      identity,
      expectedVersion: undefined,
      updatedByUserId: "operator",
    }),
  ]);
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = attempts.find((result) => result.status === "rejected");
  assert(rejected?.status === "rejected");
  assert.equal(
    rejected.reason instanceof Error ? rejected.reason.name : undefined,
    "ProviderConfigurationConflictError",
  );

  const rotated = await store.save({
    provider: "github",
    configuration: { ...configuration, clientSecret: "rotated" },
    identity,
    expectedVersion: 1,
    updatedByUserId: "operator",
  });
  assert.equal(rotated.version, 2);
}

async function exerciseSlackAtomicTransition(bundle: DatabaseRuntimeBundle) {
  const database = createDatabase(bundle.runtime, bundle.locks);
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ('org', 'Org', 'org')`,
  );
  await bundle.runtime.query(
    `insert into session (id, token, user_id, active_organization_id, expires_at)
     values ('session', 'session-token', 'operator', 'org', now() + interval '1 hour')`,
  );
  await bundle.runtime.query(
    `insert into member (id, organization_id, user_id, role)
     values ('member', 'org', 'operator', 'owner')`,
  );
  const configuration = {
    provider: "slack" as const,
    transport: "webhook" as const,
    appId: "A1",
    clientId: "client",
    clientSecret: "secret",
    signingSecret: "signing-secret",
  };
  const store = createProviderApplicationStore(bundle.runtime, bundle.locks, database);
  const startAttempt = async (stateVerifier: string, expectedVersion: number | null) => {
    await database.startConnectionAttempt({
      provider: "slack",
      stateVerifier,
      access: {
        sessionId: "session",
        userId: "operator",
        membershipId: "member",
        organizationId: "org",
        returnRoute: "/settings/apps",
      },
      lifetimeMinutes: 10,
      configurationVersion: (expectedVersion ?? 0) + 1,
      providerApplicationId: configuration.appId,
      callbackOrigin: "https://hub.test",
      configurationSnapshot: configuration,
      expectedConfigurationVersion: expectedVersion,
      activateConfiguration: true,
    });
  };
  const complete = (stateVerifier: string, teamId: string, expectedVersion: number | undefined) =>
    store.completeSlackInstallation({
      configuration,
      identity: { provider: "slack", id: "A1", name: "Acme" },
      expectedVersion,
      updatedByUserId: "operator",
      binding: {
        providerApplicationId: "A1",
        stateVerifier,
        phase: "slack_authorization",
        access: { sessionId: "session", userId: "operator" },
        teamId,
        teamName: "Acme",
        botUserId: "UBOT",
        botAccessToken: "xoxb-token",
        scopes: ["chat:write"],
      },
    });

  await startAttempt("state-ok", null);
  await complete("state-ok", "T1", undefined);
  assert.equal((await store.read("slack"))?.version, 1);
  assert.equal((await database.findSlackConnection("T1"))?.providerApplicationId, "A1");
  assert.equal(
    (await createProviderApplicationInventory(bundle.runtime).connectedIdentities("slack"))[0]
      ?.status,
    "actionNeeded",
  );

  await startAttempt("state-conflict", 1);
  await assert.rejects(() => complete("state-conflict", "T2", 99));
  assert.equal(await database.findSlackConnection("T2"), undefined);
  assert.equal((await store.read("slack"))?.version, 1);
  assert.equal(
    (
      await bundle.runtime.query<{ consumed_at: Date | null }>(
        `select consumed_at from organization_connection_attempts where state_verifier = 'state-conflict'`,
      )
    ).rows[0]?.consumed_at,
    null,
  );

  await bundle.runtime.query(
    `create function reject_slack_attempt_consumption() returns trigger language plpgsql as $$
       begin
         if new.state_verifier = 'state-crash' and new.consumed_at is not null then
           raise exception 'simulated crash boundary';
         end if;
         return new;
       end;
     $$`,
  );
  await bundle.runtime.query(
    `create trigger reject_slack_attempt_consumption
     before update on organization_connection_attempts
     for each row execute function reject_slack_attempt_consumption()`,
  );
  await startAttempt("state-crash", 1);
  await assert.rejects(
    () => complete("state-crash", "T3", 1),
    (error: unknown) =>
      error !== null &&
      typeof error === "object" &&
      String(Reflect.get(Reflect.get(error, "cause") ?? {}, "message")) ===
        "simulated crash boundary",
  );
  assert.equal(await database.findSlackConnection("T3"), undefined);
  assert.equal((await store.read("slack"))?.version, 1);
  assert.equal(
    (
      await bundle.runtime.query<{ consumed_at: Date | null }>(
        `select consumed_at from organization_connection_attempts where state_verifier = 'state-crash'`,
      )
    ).rows[0]?.consumed_at,
    null,
  );

  const socket = await store.completeSlackSocketApplication({
    configuration: {
      provider: "slack",
      transport: "socket",
      appId: "A1",
      appToken: "xapp-secret",
    },
    identity: { provider: "slack", id: "A1", name: "A1" },
    expectedVersion: 1,
    updatedByUserId: "operator",
    organizationId: "org",
    installation: {
      appId: "A1",
      teamId: "T2",
      teamName: "Socket Workspace",
      botUserId: "UBOT2",
      botAccessToken: "xoxb-socket",
      scopes: [
        "app_mentions:read",
        "channels:history",
        "chat:write",
        "files:read",
        "groups:history",
        "reactions:write",
        "users:read",
      ],
    },
  });
  assert.equal(socket.version, 2);
  assert.equal(socket.configuration.provider, "slack");
  assert.equal(
    socket.configuration.provider === "slack" ? socket.configuration.transport : undefined,
    "socket",
  );
  assert.equal((await database.findSlackConnection("T2"))?.providerApplicationId, "A1");
}
