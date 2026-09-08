import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, describe, it } from "vitest";
import { buildAccountCarriers } from "../channels/supervisor/account-carriers.js";
import type { CompiledChannelAccount } from "../channels/config/compile.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { createProviderApplicationStore } from "../provider-applications/index.js";
import { runtimeFile } from "../runtime-files.js";
import { ChannelStore } from "./channels.js";
import { createDatabase } from "./pg.js";
import { embeddedDatabaseRuntime } from "./runtime/index.js";
import type { DatabaseRuntime, DatabaseRuntimeBundle } from "./runtime/index.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("database migrations", () => {
  it("keeps hub_config_version_id columns compatible with hub_configs.id", () => {
    const machineModel = readFileSync(join(here, "migrations/0001_machine_model.sql"), "utf8");
    const hubConfigs = readFileSync(join(here, "migrations/0003_hub_configs.sql"), "utf8");

    assert.match(machineModel, /"machines"[\s\S]*"hub_config_version_id" uuid,/);
    assert.match(machineModel, /"agent_executions"[\s\S]*"hub_config_version_id" uuid NOT NULL/);
    assert.match(
      hubConfigs,
      /ALTER TABLE "machines" ALTER COLUMN "hub_config_version_id" TYPE uuid/,
    );
    assert.match(
      hubConfigs,
      /ALTER TABLE "agent_executions" ALTER COLUMN "hub_config_version_id" TYPE uuid/,
    );
  });

  it("adds nullable signature-hash dedup for new webhook rows", () => {
    const webhookDedup = readFileSync(
      join(here, "migrations/0004_webhook_signature_dedup.sql"),
      "utf8",
    );

    assert.match(webhookDedup, /ADD COLUMN "signature_hash" text/);
    assert.match(
      webhookDedup,
      /CREATE UNIQUE INDEX "triggers_signature_hash_unique"[\s\S]*\("signature_hash"\)[\s\S]*WHERE "signature_hash" IS NOT NULL/,
    );
  });

  it("adds agent execution completion callback state", () => {
    const completionCallback = readFileSync(
      join(here, "migrations/0006_agent_execution_completion_callback.sql"),
      "utf8",
    );

    assert.match(completionCallback, /ADD COLUMN "completion_token_hash" text/);
    assert.match(completionCallback, /ADD COLUMN "completed_by_agent_at" timestamp with time zone/);
  });

  it("backfills a deadline for pending agent executions", () => {
    const deadline = readFileSync(
      join(here, "migrations/0007_agent_execution_deadline.sql"),
      "utf8",
    );

    assert.match(deadline, /ADD COLUMN "deadline_at" timestamp with time zone/);
    assert.match(deadline, /"started_at" \+ interval '30 minutes'/);
  });

  it("removes the legacy registered-daemon persistence surface", () => {
    const cleanup = readFileSync(join(here, "migrations/0009_drop_legacy_daemons.sql"), "utf8");

    assert.match(cleanup, /DROP TABLE IF EXISTS "registered_daemons" CASCADE/);
  });

  it("destructively cuts superseded trigger and execution ownership paths", () => {
    const cutover = readFileSync(join(here, "../../drizzle/0018_silky_cannonball.sql"), "utf8");

    assert.match(cutover, /DROP TABLE "triggers" CASCADE/);
    assert.match(cutover, /DROP COLUMN "trigger_id"/);
    assert.match(cutover, /DROP COLUMN "trigger_connection_id"/);
    assert.match(cutover, /DROP COLUMN "trigger_resource_id"/);
    assert.match(cutover, /provider_event_receipt_id/);
    assert.match(cutover, /preserve|disposition/iu);
  });

  it("backfills app onboarding only for installations that already exist", () => {
    const migration = readFileSync(join(here, "../../drizzle/0035_smooth_wonder_man.sql"), "utf8");
    assert.match(migration, /UPDATE "instance_bootstrap"[\s\S]*app_onboarding_completed_at/u);
    assert.match(migration, /WHERE EXISTS \(SELECT 1 FROM "user"\)/u);
    assert.match(migration, /DELETE FROM "organization_connection_attempts"/u);
  });
});

// COMPAT(clisbot-channels): forward-migration safety for a Hub that already
// ran channels before the port. `0065` opened the durable ingress queue and
// everything after it reshaped the channel plane's tables — the two channel
// CHECK constraints were dropped and rebuilt twice (`0067`, `0070`), five
// Connection owners were added, and `0071` introduced the reply-capability
// table. None of that may disturb what an operator already has.
//
// The seed is applied on the REAL pre-0065 schema: migrations are replayed up
// to (not including) `0065` against a raw PGlite, the process then reopens the
// same data directory through the production runtime and calls the production
// `migrate()`, which resumes from the recorded watermark. That is the upgrade
// an existing installation performs, not a restatement of it. "Latest" is
// whatever the journal holds, so a new migration is covered without editing
// this test.
describe("a pre-0065 channel database migrates to latest", () => {
  const ORGANIZATION_ID = "migration-org";
  const SLACK_ACCOUNT = "work";
  const TELEGRAM_ACCOUNT = "personal";
  const SLACK_CONVERSATION = "C0MIGRATE";
  const SLACK_THREAD = "1720000000.000100";
  const TELEGRAM_CONVERSATION = "-1001234567890";
  const TELEGRAM_TOPIC = "42";
  const SLACK_BOT_TOKEN = "xoxb-migration-canary";
  const SLACK_APP_TOKEN = "xapp-migration-canary";
  const TELEGRAM_BOT_TOKEN = "123456:telegram-migration-canary";
  const ROUTE = { agent: "worker-app", environment: "repo-app" };
  const POSTED_AT = new Date("2026-09-06T12:00:00.000Z");

  let root: string | undefined;
  let bundle: DatabaseRuntimeBundle | undefined;

  afterEach(async () => {
    await bundle?.runtime.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    bundle = undefined;
    root = undefined;
  });

  it("keeps Connections, bindings, ledger rows and the active revision", async () => {
    root = await mkdtemp(join(tmpdir(), "hub-migration-0065-"));
    const dataDirectory = join(root, "pgdata");
    const migrations = readMigrationFiles({ migrationsFolder: runtimeFile("drizzle") });
    const applied = await seedPre0065(dataDirectory, migrations);
    assert.ok(
      applied > 0 && applied < migrations.length,
      "0065 is not the first or last migration",
    );

    bundle = await embeddedDatabaseRuntime(dataDirectory);
    assert.equal(await tableExists(bundle.runtime, "channel_ingress_queue"), false);

    const cipher = createTestCredentialCipher();
    const database = createDatabase(bundle.runtime, bundle.locks, cipher);
    await bundle.runtime.query(
      `insert into organization (id, name, slug) values ($1, 'Migration Org', 'migration-org')`,
      [ORGANIZATION_ID],
    );
    await bundle.runtime.query(
      `insert into "user" (id, name, email, email_verified)
         values ('operator', 'Operator', 'operator@example.test', true)`,
    );

    const telegram = await database.configureChannelConnection({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      accountId: TELEGRAM_ACCOUNT,
      credentials: { botToken: TELEGRAM_BOT_TOKEN },
    });
    await createProviderApplicationStore(
      bundle.runtime,
      bundle.locks,
      cipher,
      database,
    ).completeSlackSocketApplication({
      configuration: {
        provider: "slack",
        transport: "socket",
        appId: "A1",
        appToken: SLACK_APP_TOKEN,
      },
      identity: { provider: "slack", id: "A1", name: "A1" },
      expectedVersion: undefined,
      updatedByUserId: "operator",
      organizationId: ORGANIZATION_ID,
      installation: {
        appId: "A1",
        teamId: "T1",
        teamName: "Team",
        botUserId: "U1",
        botAccessToken: SLACK_BOT_TOKEN,
        scopes: ["app_mentions:read", "chat:write"],
      },
    });
    const slackConnectionId = (
      await bundle.runtime.query<{ id: string }>(
        `select id::text from slack_connections where provider_application_id = 'A1' and team_id = 'T1'`,
      )
    ).rows[0]?.id;
    assert.ok(slackConnectionId !== undefined);

    const store = new ChannelStore(bundle.runtime);
    const slackBinding = await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: SLACK_ACCOUNT,
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      pendingExecutionId: "execution-slack",
      initiator: "slack:U0ALICE",
      route: ROUTE,
    });
    const telegramBinding = await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      accountId: TELEGRAM_ACCOUNT,
      externalConversationId: TELEGRAM_CONVERSATION,
      externalThreadId: TELEGRAM_TOPIC,
      pendingExecutionId: "execution-telegram",
      initiator: "telegram:11111",
      route: ROUTE,
    });
    const slackDelivery = await store.recordDelivery({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: SLACK_ACCOUNT,
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      eventTurnId: "turn-slack",
      sequence: 0,
    });
    await store.confirmDelivery({
      organizationId: ORGANIZATION_ID,
      accountId: SLACK_ACCOUNT,
      externalConversationId: SLACK_CONVERSATION,
      externalThreadId: SLACK_THREAD,
      eventTurnId: "turn-slack",
      sequence: 0,
      externalMessageId: "1720000000.000200",
      postedAt: POSTED_AT,
    });
    const telegramDelivery = await store.recordDelivery({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      accountId: TELEGRAM_ACCOUNT,
      externalConversationId: TELEGRAM_CONVERSATION,
      externalThreadId: TELEGRAM_TOPIC,
      eventTurnId: "turn-telegram",
      sequence: 0,
    });
    const revision = await database.saveChannelConfiguration({
      organizationId: ORGANIZATION_ID,
      files: [{ path: ".paseo/channels/slack/work.yml", content: "channel: slack\n" }],
      contentHash: "pre-0065-hash",
      createdByUserId: "operator",
    });

    // The upgrade an existing installation performs.
    await bundle.runtime.migrate();

    assert.equal(await tableExists(bundle.runtime, "channel_ingress_queue"), true);
    assert.equal(await appliedMigrationCount(bundle.runtime), migrations.length);

    const slackAfter = await store.findThreadBinding(
      ORGANIZATION_ID,
      SLACK_ACCOUNT,
      SLACK_CONVERSATION,
      SLACK_THREAD,
    );
    assert.equal(slackAfter?.id, slackBinding.id);
    assert.equal(slackAfter?.status, "pending");
    assert.equal(slackAfter?.pendingExecutionId, "execution-slack");
    assert.deepEqual(slackAfter?.route, ROUTE);
    const telegramAfter = await store.findThreadBinding(
      ORGANIZATION_ID,
      TELEGRAM_ACCOUNT,
      TELEGRAM_CONVERSATION,
      TELEGRAM_TOPIC,
    );
    assert.equal(telegramAfter?.id, telegramBinding.id);
    assert.equal(telegramAfter?.status, "pending");
    assert.equal(telegramAfter?.initiator, "telegram:11111");

    const slackLedger = await store.findDeliveryLedgerRecord(
      ORGANIZATION_ID,
      SLACK_ACCOUNT,
      "out",
      SLACK_CONVERSATION,
      SLACK_THREAD,
      "turn-slack",
      0,
    );
    assert.equal(slackLedger?.id, slackDelivery.record.id);
    assert.equal(slackLedger?.status, "posted");
    assert.equal(slackLedger?.externalMessageId, "1720000000.000200");
    assert.equal(slackLedger?.postedAt?.getTime(), POSTED_AT.getTime());
    const telegramLedger = await store.findDeliveryLedgerRecord(
      ORGANIZATION_ID,
      TELEGRAM_ACCOUNT,
      "out",
      TELEGRAM_CONVERSATION,
      TELEGRAM_TOPIC,
      "turn-telegram",
      0,
    );
    assert.equal(telegramLedger?.id, telegramDelivery.record.id);

    const active = await database.findActiveChannelConfiguration(ORGANIZATION_ID);
    assert.equal(active?.id, revision.id);
    assert.equal(active?.contentHash, "pre-0065-hash");
    assert.deepEqual(active?.files, [
      { path: ".paseo/channels/slack/work.yml", content: "channel: slack\n" },
    ]);

    // The rebuilt CHECK constraints admit the channels the port added; a row
    // for a channel that never existed pre-0065 is what proves they were
    // rebuilt rather than left at the old two-value list.
    const discordBinding = await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "discord",
      accountId: "guild",
      externalConversationId: "1180000000000000010",
      externalThreadId: null,
      pendingExecutionId: "execution-discord",
      initiator: "discord:1180000000000000011",
      route: ROUTE,
    });
    assert.equal(discordBinding.channel, "discord");
    const discordDelivery = await store.recordDelivery({
      organizationId: ORGANIZATION_ID,
      channel: "discord",
      accountId: "guild",
      externalConversationId: "1180000000000000010",
      externalThreadId: null,
      eventTurnId: "turn-discord",
      sequence: 0,
    });
    assert.equal(discordDelivery.created, true);

    // Both pre-existing Connections still resolve, and the drive-time carriers
    // the supervisor builds from them (`accountAndCfg`) are byte-identical to
    // what the pre-port supervisor built.
    const slackCredentials = await database.resolveChannelConnection({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      connectionId: slackConnectionId,
    });
    assert.deepEqual(slackCredentials, {
      botToken: SLACK_BOT_TOKEN,
      appToken: SLACK_APP_TOKEN,
      providerApplicationId: "A1",
    });
    const telegramCredentials = await database.resolveChannelConnection({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      connectionId: telegram.connectionId,
    });
    assert.deepEqual(telegramCredentials, { botToken: TELEGRAM_BOT_TOKEN });

    assert.deepEqual(
      buildAccountCarriers("slack", {
        ...slackCredentials,
        accountId: SLACK_ACCOUNT,
        compiled: compiledAccountFor("slack", SLACK_ACCOUNT, slackConnectionId, { socket: true }),
      }),
      {
        account: {
          accountId: SLACK_ACCOUNT,
          botToken: SLACK_BOT_TOKEN,
          appToken: SLACK_APP_TOKEN,
          config: {},
          transport: { mode: "socket" },
        },
        cfgAccount: {
          botToken: SLACK_BOT_TOKEN,
          appToken: SLACK_APP_TOKEN,
          config: { socket: true },
        },
      },
    );
    assert.deepEqual(
      buildAccountCarriers("telegram", {
        ...telegramCredentials,
        accountId: TELEGRAM_ACCOUNT,
        compiled: compiledAccountFor("telegram", TELEGRAM_ACCOUNT, telegram.connectionId, {
          apiRoot: "https://api.telegram.org",
        }),
      }),
      {
        account: { accountId: TELEGRAM_ACCOUNT, token: TELEGRAM_BOT_TOKEN, config: {} },
        cfgAccount: {
          botToken: TELEGRAM_BOT_TOKEN,
          gatewayClientScopes: [],
          config: { apiRoot: "https://api.telegram.org" },
          apiRoot: "https://api.telegram.org",
        },
      },
    );
  }, 180_000);

  /** Replay every migration before `0065` against a raw client, then close it
   * so the production runtime can reopen the same directory. Returns how many
   * ran. */
  async function seedPre0065(
    dataDirectory: string,
    migrations: ReturnType<typeof readMigrationFiles>,
  ): Promise<number> {
    const journal: { entries: { when: number; tag: string }[] } = JSON.parse(
      readFileSync(runtimeFile("drizzle", "meta", "_journal.json"), "utf8"),
    );
    const cutoff = journal.entries.find((entry) => entry.tag.startsWith("0065_"))?.when;
    assert.ok(cutoff !== undefined, "the journal still carries the 0065 entry");
    const client = new PGlite(dataDirectory);
    try {
      await client.waitReady;
      await client.exec(`
        create schema if not exists drizzle;
        create table if not exists drizzle.__drizzle_migrations (
          id serial primary key,
          hash text not null,
          created_at bigint
        );
      `);
      let count = 0;
      for (const migration of migrations) {
        if (migration.folderMillis >= cutoff) continue;
        for (const statement of migration.sql) await client.exec(statement);
        await client.query(
          `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
          [migration.hash, migration.folderMillis],
        );
        count += 1;
      }
      return count;
    } finally {
      await client.close();
    }
  }
});

async function tableExists(runtime: DatabaseRuntime, table: string): Promise<boolean> {
  const result = await runtime.query<{ exists: string | null }>(
    `select to_regclass($1)::text as exists`,
    [`public.${table}`],
  );
  return result.rows[0]?.exists !== null;
}

async function appliedMigrationCount(runtime: DatabaseRuntime): Promise<number> {
  const result = await runtime.query<{ count: string | number }>(
    `select count(*)::int as count from drizzle.__drizzle_migrations`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** The compiled account the supervisor would hand `buildAccountCarriers`. */
function compiledAccountFor(
  channel: string,
  accountId: string,
  connectionId: string,
  config: Record<string, unknown>,
): CompiledChannelAccount {
  return {
    channel,
    accountId,
    enabled: true,
    channelEnabled: true,
    connectionId,
    transport: { mode: channel === "slack" ? "socket" : "polling" },
    config,
    defaultRoles: [],
    assignments: [],
    defaults: {} as CompiledChannelAccount["defaults"],
    approval: [],
    routes: [],
    fallback: { deny: true } as CompiledChannelAccount["fallback"],
  };
}
