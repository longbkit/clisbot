import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, describe, it } from "vitest";
import {
  embeddedDatabaseRuntime,
  postgresDatabaseRuntime,
  type DatabaseRuntimeBundle,
} from "../db/runtime/index.js";
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
const migrations = readMigrationFiles({ migrationsFolder: join(process.cwd(), "drizzle") });
const migrationsBeforeProviderApplications = migrations.slice(0, 36);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("pre-provider-app connection upgrade", () => {
  it("migrates a saved Slack webhook configuration without changing its binding in PGlite", async () => {
    const fixture = await databaseBeforeSocketMode();
    try {
      await seedLegacySlackApplication(fixture.bundle);
      await fixture.bundle.runtime.migrate();
      const saved = await createProviderApplicationStore(
        fixture.bundle.runtime,
        fixture.bundle.locks,
      ).read("slack");
      assert.deepEqual(saved?.configuration, ENVIRONMENT_APPLICATIONS.slack);
      assert.equal(saved?.version, 4);
      const connections = await createProviderApplicationInventory(
        fixture.bundle.runtime,
      ).connectedIdentities("slack");
      assert.deepEqual(
        connections.map(({ id: _id, ...connection }) => connection),
        [{ name: "Legacy Slack", applicationId: "slack-app", status: "connected" }],
      );
      const binding = await fixture.bundle.runtime.query<{ team_id: string }>(
        "select team_id from slack_connections where provider_application_id = 'slack-app'",
      );
      assert.equal(binding.rows[0]?.team_id, "legacy-team");
    } finally {
      await fixture.close();
    }
  }, 120_000);

  it.each(["PGlite", "PostgreSQL"] as const)(
    "gives concurrent legacy identity claims one durable winner in %s",
    async (engine) => {
      const fixture = await legacyDatabase(engine);
      try {
        await fixture.bundle.runtime.migrate();
        const inventory = createProviderApplicationInventory(fixture.bundle.runtime);
        const first = identity(ENVIRONMENT_APPLICATIONS.github);
        const second = { ...first, id: "competing-github-app" };

        const claims = await Promise.all([
          inventory.claimLegacyConnections("github", first),
          inventory.claimLegacyConnections("github", second),
        ]);

        assert.equal(claims.filter(Boolean).length, 1);
        const winner = claims[0] ? first : second;
        assert.deepEqual(
          (await inventory.connectedIdentities("github")).map(
            (connection) => connection.applicationId,
          ),
          [winner.id],
        );
      } finally {
        await fixture.close();
      }
    },
    120_000,
  );

  it.each(["PGlite", "PostgreSQL"] as const)(
    "activates environment-configured legacy connections after the 0036 upgrade in %s",
    async (engine) => {
      const fixture = await legacyDatabase(engine);
      try {
        await fixture.bundle.runtime.migrate();
        const inventory = createProviderApplicationInventory(fixture.bundle.runtime);
        const runtime = new RecordingRuntime();
        const failures = await activateProviderApplicationsAtStartup({
          store: createProviderApplicationStore(fixture.bundle.runtime, fixture.bundle.locks),
          environment: ENVIRONMENT_APPLICATIONS,
          runtime,
          verifier: {
            verify: (_provider, configuration) => Promise.resolve(identity(configuration)),
          },
          inventory,
          callbackOrigin: "https://hub.example.test",
        });

        assert.deepEqual(failures, []);
        assert.deepEqual(runtime.published, ["github", "slack", "discord"]);
        for (const provider of ["github", "slack", "discord"] as const) {
          assert.deepEqual(
            (await inventory.connectedIdentities(provider)).map(
              (connection) => connection.applicationId,
            ),
            [identity(ENVIRONMENT_APPLICATIONS[provider]).id],
          );
        }

        const changed = new RecordingRuntime();
        const changedFailures = await activateProviderApplicationsAtStartup({
          store: createProviderApplicationStore(fixture.bundle.runtime, fixture.bundle.locks),
          environment: {
            ...ENVIRONMENT_APPLICATIONS,
            github: { ...ENVIRONMENT_APPLICATIONS.github, appId: "different-app" },
          },
          runtime: changed,
          verifier: {
            verify: (_provider, configuration) => Promise.resolve(identity(configuration)),
          },
          inventory,
          callbackOrigin: "https://hub.example.test",
        });
        assert.equal(changedFailures[0]?.provider, "github");
        assert.equal(changed.published.includes("github"), false);
      } finally {
        await fixture.close();
      }
    },
    120_000,
  );
});

const ENVIRONMENT_APPLICATIONS = {
  github: {
    provider: "github",
    appId: "github-app",
    appSlug: "paseo",
    clientId: "github-client",
    clientSecret: "github-secret",
    privateKey: "github-private-key",
    webhookSecret: "github-webhook-secret",
  },
  slack: {
    provider: "slack",
    transport: "webhook",
    appId: "slack-app",
    clientId: "slack-client",
    clientSecret: "slack-secret",
    signingSecret: "slack-signing-secret",
  },
  discord: {
    provider: "discord",
    applicationId: "discord-app",
    clientSecret: "discord-secret",
    botToken: "discord-token",
  },
} satisfies Record<Provider, ProviderApplicationConfiguration>;

async function legacyDatabase(engine: "PGlite" | "PostgreSQL"): Promise<{
  bundle: DatabaseRuntimeBundle;
  close(): Promise<void>;
}> {
  if (engine === "PGlite") {
    const root = await mkdtemp(join(tmpdir(), "hub-provider-app-upgrade-"));
    roots.push(root);
    await applyPGliteMigrationsBeforeProviderApplications(root);
    const bundle = await embeddedDatabaseRuntime(root);
    await seedLegacyConnections(bundle);
    return { bundle, close: () => bundle.runtime.close() };
  }
  const postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
  const bundle = await postgresDatabaseRuntime(postgres.getConnectionUri());
  await applyPostgresMigrationsBeforeProviderApplications(bundle);
  await seedLegacyConnections(bundle);
  return {
    bundle,
    close: async () => {
      await bundle.runtime.close();
      await postgres.stop();
    },
  };
}

/** Applies the real historical migration stream only through 0035. */
async function applyPGliteMigrationsBeforeProviderApplications(
  root: string,
  selected = migrationsBeforeProviderApplications,
): Promise<void> {
  const client = new PGlite(root);
  await client.waitReady;
  try {
    await client.exec(migrationJournalSql());
    await client.transaction(async (transaction) => {
      for (const migration of selected) {
        for (const statement of migration.sql) await transaction.exec(statement);
        await transaction.query(
          "insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
          [migration.hash, migration.folderMillis],
        );
      }
    });
  } finally {
    await client.close();
  }
}

async function applyPostgresMigrationsBeforeProviderApplications(
  bundle: DatabaseRuntimeBundle,
  selected = migrationsBeforeProviderApplications,
): Promise<void> {
  await bundle.runtime.query("create schema if not exists drizzle");
  await bundle.runtime.query(`create table drizzle.__drizzle_migrations (
    id serial primary key,
    hash text not null,
    created_at bigint
  )`);
  await bundle.runtime.transaction(async (transaction) => {
    for (const migration of selected) {
      for (const statement of migration.sql) await transaction.query(statement);
      await transaction.query(
        "insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
        [migration.hash, migration.folderMillis],
      );
    }
  });
}

async function databaseBeforeSocketMode(): Promise<{
  bundle: DatabaseRuntimeBundle;
  close(): Promise<void>;
}> {
  const beforeSocketMode = migrations.slice(0, 38);
  const root = await mkdtemp(join(tmpdir(), "hub-slack-socket-upgrade-"));
  roots.push(root);
  await applyPGliteMigrationsBeforeProviderApplications(root, beforeSocketMode);
  const bundle = await embeddedDatabaseRuntime(root);
  return { bundle, close: () => bundle.runtime.close() };
}

async function seedLegacySlackApplication(bundle: DatabaseRuntimeBundle): Promise<void> {
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ('legacy-org', 'Legacy', 'legacy')`,
  );
  await bundle.runtime.query(
    `insert into runtime_provider_configuration
       (provider, configuration, verified_external_identity, version, verified_at, updated_at)
     values ('slack', $1, $2, 4, now(), now())`,
    [
      JSON.stringify({
        provider: "slack",
        appId: "slack-app",
        clientId: "slack-client",
        clientSecret: "slack-secret",
        signingSecret: "slack-signing-secret",
      }),
      JSON.stringify({ provider: "slack", id: "slack-app", name: "Slack app" }),
    ],
  );
  await bundle.runtime.query(
    `insert into slack_connections
       (organization_id, team_id, slug, team_name, bot_user_id, bot_access_token, scopes,
        provider_application_id)
     values ('legacy-org', 'legacy-team', 'legacy-slack', 'Legacy Slack', 'legacy-bot',
             'xoxb-legacy', $1, 'slack-app')`,
    [JSON.stringify(SLACK_REQUIRED_BOT_SCOPES)],
  );
}

function migrationJournalSql(): string {
  return `create schema if not exists drizzle;
    create table drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    );`;
}

async function seedLegacyConnections(bundle: DatabaseRuntimeBundle): Promise<void> {
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ('legacy-org', 'Legacy', 'legacy')`,
  );
  await bundle.runtime.query(
    `insert into github_connections
       (organization_id, installation_id, slug, account_id, account_login, account_type, status)
     values ('legacy-org', 1001, 'legacy-github', 'github-account', 'Legacy GitHub',
             'Organization', 'active')`,
  );
  await bundle.runtime.query(
    `insert into slack_connections
       (organization_id, team_id, slug, team_name, bot_user_id, bot_access_token, scopes)
     values ('legacy-org', 'legacy-team', 'legacy-slack', 'Legacy Slack', 'legacy-bot',
             'xoxb-legacy', $1)`,
    [JSON.stringify(SLACK_REQUIRED_BOT_SCOPES)],
  );
  await bundle.runtime.query(
    `insert into discord_connections (organization_id, guild_id, slug, guild_name)
     values ('legacy-org', 'legacy-guild', 'legacy-discord', 'Legacy Discord')`,
  );
}

function identity(configuration: ProviderApplicationConfiguration): ProviderApplicationIdentity {
  if (configuration.provider === "github") {
    return { provider: "github", id: configuration.appId, name: "GitHub app", ownerLogin: "acme" };
  }
  if (configuration.provider === "slack") {
    return { provider: "slack", id: configuration.appId, name: "Slack app" };
  }
  return { provider: "discord", id: configuration.applicationId, name: "Discord app" };
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
