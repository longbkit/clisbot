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
import type { Database } from "../db/types.js";
import { SLACK_REQUIRED_BOT_SCOPES } from "../providers/slack/client.js";
import {
  activateProviderApplicationsAtStartup,
  createProviderApplicationInventory,
  createProviderApplicationStore,
  type Provider,
  type ProviderApplicationConfiguration,
  type ProviderApplicationIdentity,
  type ProviderRuntimeCandidate,
  type ProviderRuntimeOwner,
} from "./index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("provider application OAuth bind authority", () => {
  it.each(["PGlite", "PostgreSQL"] as const)(
    "rejects replaced stored and environment callback snapshots in %s",
    async (engine) => {
      const fixture = await databaseFixture(engine);
      try {
        await seedAuthority(fixture.bundle);
        for (const provider of ["github", "slack", "discord"] as const) {
          await rejectsStoredReplacement(fixture.bundle, provider);
          await resetProvider(fixture.bundle, provider);
          await serializesReplacementRace(fixture.bundle, provider);
          await resetProvider(fixture.bundle, provider);
          await rejectsEnvironmentFallback(fixture.bundle, provider);
          await resetProvider(fixture.bundle, provider);
        }
      } finally {
        await fixture.close();
      }
    },
    120_000,
  );
});

async function rejectsStoredReplacement(bundle: DatabaseRuntimeBundle, provider: Provider) {
  const database = createDatabase(bundle.runtime, bundle.locks);
  const store = createProviderApplicationStore(bundle.runtime, bundle.locks, database);
  const first = application(provider, "A");
  const replacement = application(provider, "B");
  await store.save({
    provider,
    configuration: first.configuration,
    identity: first.identity,
    expectedVersion: undefined,
    updatedByUserId: "operator",
  });
  const state = await startAttempt(
    database,
    provider,
    first.configuration,
    1,
    `${provider}-stored`,
  );
  await store.save({
    provider,
    configuration: replacement.configuration,
    identity: replacement.identity,
    expectedVersion: 1,
    updatedByUserId: "operator",
  });

  await assertStaleBindRollsBack(bundle, database, provider, state, first.identity.id);
  assert.equal((await store.read(provider))?.identity.id, replacement.identity.id);
  assert.equal((await store.read(provider))?.version, 2);

  const current = await startAttempt(
    database,
    provider,
    replacement.configuration,
    2,
    `${provider}-stored-current`,
  );
  await bind(database, provider, current, replacement.identity.id);
  assert.equal(await connectionApplicationId(bundle, provider), replacement.identity.id);
}

async function serializesReplacementRace(bundle: DatabaseRuntimeBundle, provider: Provider) {
  const database = createDatabase(bundle.runtime, bundle.locks);
  const store = createProviderApplicationStore(bundle.runtime, bundle.locks, database);
  const first = application(provider, "RACE-A");
  const replacement = application(provider, "RACE-B");
  await store.save({
    provider,
    configuration: first.configuration,
    identity: first.identity,
    expectedVersion: undefined,
    updatedByUserId: "operator",
  });
  const state = await startAttempt(database, provider, first.configuration, 1, `${provider}-race`);

  const [saved, bound] = await Promise.allSettled([
    store.save({
      provider,
      configuration: replacement.configuration,
      identity: replacement.identity,
      expectedVersion: 1,
      updatedByUserId: "operator",
    }),
    bind(database, provider, state, first.identity.id),
  ]);

  assert.equal([saved, bound].filter((result) => result.status === "fulfilled").length, 1);
  if (saved.status === "fulfilled") {
    assert.equal(await connectionApplicationId(bundle, provider), undefined);
    assert.equal((await store.read(provider))?.identity.id, replacement.identity.id);
    await assertAttemptConsumed(bundle, state, false);
  } else {
    assert.equal(bound.status, "fulfilled");
    assert.equal(await connectionApplicationId(bundle, provider), first.identity.id);
    assert.equal((await store.read(provider))?.identity.id, first.identity.id);
    await assertAttemptConsumed(bundle, state, true);
  }
}

async function rejectsEnvironmentFallback(bundle: DatabaseRuntimeBundle, provider: Provider) {
  const database = createDatabase(bundle.runtime, bundle.locks);
  const store = createProviderApplicationStore(bundle.runtime, bundle.locks, database);
  const environment = application(provider, "ENV");
  const fallback = application(provider, "STORED");
  await store.save({
    provider,
    configuration: fallback.configuration,
    identity: fallback.identity,
    expectedVersion: undefined,
    updatedByUserId: "operator",
  });
  const inventory = createProviderApplicationInventory(bundle.runtime);
  const runtime = new RecordingRuntime();
  assert.deepEqual(
    await activateProviderApplicationsAtStartup({
      store,
      environment: { [provider]: environment.configuration },
      runtime,
      verifier: { verify: (_provider, configuration) => Promise.resolve(identity(configuration)) },
      inventory,
      callbackOrigin: "https://hub.example.test",
    }),
    [],
  );
  const state = await startAttempt(
    database,
    provider,
    environment.configuration,
    0,
    `${provider}-environment`,
  );
  assert.deepEqual(
    await activateProviderApplicationsAtStartup({
      store,
      environment: {},
      runtime,
      verifier: { verify: (_provider, configuration) => Promise.resolve(identity(configuration)) },
      inventory,
      callbackOrigin: "https://hub.example.test",
    }),
    [],
  );

  await assertStaleBindRollsBack(bundle, database, provider, state, environment.identity.id);
  assert.equal(runtime.published.at(-1), provider);

  const current = await startAttempt(
    database,
    provider,
    fallback.configuration,
    1,
    `${provider}-fallback-current`,
  );
  await bind(database, provider, current, fallback.identity.id);
  assert.equal(await connectionApplicationId(bundle, provider), fallback.identity.id);
}

async function assertStaleBindRollsBack(
  bundle: DatabaseRuntimeBundle,
  database: Database,
  provider: Provider,
  stateVerifier: string,
  applicationId: string,
) {
  await assert.rejects(() => bind(database, provider, stateVerifier, applicationId));
  assert.equal(await connectionApplicationId(bundle, provider), undefined);
  await assert.rejects(() =>
    database.consumeConnectionAttempt({
      stateVerifier,
      phase: callbackPhase(provider),
      access: CALLBACK_ACCESS,
    }),
  );
  assert.equal(
    (
      await bundle.runtime.query<{ consumed_at: Date | null }>(
        `select consumed_at from organization_connection_attempts where state_verifier = $1`,
        [stateVerifier],
      )
    ).rows[0]?.consumed_at,
    null,
  );
}

async function assertAttemptConsumed(
  bundle: DatabaseRuntimeBundle,
  stateVerifier: string,
  consumed: boolean,
) {
  assert.equal(
    (
      await bundle.runtime.query<{ consumed: boolean }>(
        `select consumed_at is not null as consumed
         from organization_connection_attempts where state_verifier = $1`,
        [stateVerifier],
      )
    ).rows[0]?.consumed,
    consumed,
  );
}

function callbackPhase(provider: Provider) {
  if (provider === "github") return "github_user_authorization" as const;
  return provider === "slack"
    ? ("slack_authorization" as const)
    : ("discord_authorization" as const);
}

async function startAttempt(
  database: Database,
  provider: Provider,
  configuration: ProviderApplicationConfiguration,
  configurationVersion: number,
  name: string,
): Promise<string> {
  const initialState = `${name}-initial`;
  await database.startConnectionAttempt({
    provider,
    stateVerifier: initialState,
    access: START_ACCESS,
    lifetimeMinutes: 10,
    configurationVersion,
    providerApplicationId: identity(configuration).id,
    callbackOrigin: "https://hub.example.test",
    configurationSnapshot: configuration,
    expectedConfigurationVersion: null,
    activateConfiguration: false,
  });
  if (provider !== "github") return initialState;
  const callbackState = `${name}-callback`;
  await database.advanceGitHubConnectionAttempt({
    stateVerifier: initialState,
    phase: "github_setup",
    access: CALLBACK_ACCESS,
    nextStateVerifier: callbackState,
    installationId: 42,
    pkceVerifier: "pkce",
  });
  return callbackState;
}

function bind(
  database: Database,
  provider: Provider,
  stateVerifier: string,
  providerApplicationId: string,
): Promise<void> {
  const shared = { stateVerifier, access: CALLBACK_ACCESS, providerApplicationId };
  if (provider === "github") {
    return database.bindGitHubConnection({
      ...shared,
      phase: "github_user_authorization",
      installationId: 42,
      accountId: "account",
      accountLogin: "Acme",
      accountType: "Organization",
      status: "active",
    });
  }
  if (provider === "slack") {
    return database.bindSlackConnection({
      ...shared,
      phase: "slack_authorization",
      teamId: "team",
      teamName: "Acme",
      botUserId: "bot",
      botAccessToken: "xoxb-token",
      scopes: [...SLACK_REQUIRED_BOT_SCOPES],
    });
  }
  return database.bindDiscordConnection({
    ...shared,
    phase: "discord_authorization",
    guildId: "guild",
    guildName: "Acme",
  });
}

async function connectionApplicationId(
  bundle: DatabaseRuntimeBundle,
  provider: Provider,
): Promise<string | undefined> {
  const table = `${provider}_connections`;
  return (
    await bundle.runtime.query<{ provider_application_id: string }>(
      `select provider_application_id from ${table} limit 1`,
    )
  ).rows[0]?.provider_application_id;
}

async function resetProvider(bundle: DatabaseRuntimeBundle, provider: Provider): Promise<void> {
  await bundle.runtime.query(`delete from ${provider}_connections`);
  await bundle.runtime.query(`delete from organization_connection_attempts`);
  await bundle.runtime.query(`delete from runtime_provider_configuration where provider = $1`, [
    provider,
  ]);
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
}

function application(provider: Provider, suffix: string) {
  let configuration: ProviderApplicationConfiguration;
  if (provider === "github") {
    configuration = {
      provider,
      appId: `github-${suffix}`,
      appSlug: `github-${suffix}`,
      clientId: `github-client-${suffix}`,
      clientSecret: `github-secret-${suffix}`,
      privateKey: `github-key-${suffix}`,
      webhookSecret: `github-webhook-${suffix}`,
    };
  } else if (provider === "slack") {
    configuration = {
      provider,
      transport: "webhook",
      appId: `slack-${suffix}`,
      clientId: `slack-client-${suffix}`,
      clientSecret: `slack-secret-${suffix}`,
      signingSecret: `slack-signing-${suffix}`,
    };
  } else {
    configuration = {
      provider,
      applicationId: `discord-${suffix}`,
      clientSecret: `discord-secret-${suffix}`,
      botToken: `discord-token-${suffix}`,
    };
  }
  return { configuration, identity: identity(configuration) };
}

function identity(configuration: ProviderApplicationConfiguration): ProviderApplicationIdentity {
  if (configuration.provider === "github") {
    return {
      provider: "github",
      id: configuration.appId,
      name: configuration.appSlug,
      ownerLogin: "acme",
    };
  }
  if (configuration.provider === "slack") {
    return { provider: "slack", id: configuration.appId, name: configuration.appId };
  }
  return {
    provider: "discord",
    id: configuration.applicationId,
    name: configuration.applicationId,
  };
}

const START_ACCESS = {
  sessionId: "session",
  userId: "operator",
  membershipId: "member",
  organizationId: "org",
  returnRoute: "/settings/apps",
};
const CALLBACK_ACCESS = { sessionId: "session", userId: "operator" };

async function databaseFixture(engine: "PGlite" | "PostgreSQL"): Promise<{
  bundle: DatabaseRuntimeBundle;
  close(): Promise<void>;
}> {
  if (engine === "PGlite") {
    const root = await mkdtemp(join(tmpdir(), "hub-oauth-bind-safety-"));
    roots.push(root);
    const bundle = await embeddedDatabaseRuntime(root);
    return { bundle, close: () => bundle.runtime.close() };
  }
  const postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
  const bundle = await postgresDatabaseRuntime(postgres.getConnectionUri());
  return {
    bundle,
    close: async () => {
      await bundle.runtime.close();
      await postgres.stop();
    },
  };
}

class RecordingRuntime implements ProviderRuntimeOwner {
  readonly published: Provider[] = [];

  prepare(provider: Provider): Promise<ProviderRuntimeCandidate> {
    return Promise.resolve({
      start: () => Promise.resolve(),
      publish: () => this.published.push(provider),
      close: () => Promise.resolve(),
    });
  }
}
