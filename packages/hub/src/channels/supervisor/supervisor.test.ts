// Tests for the channel supervisor (plan §4-S1 / implementation doc §4.3.9):
// the per-account lifecycle the control plane drives. These pin the P13
// contract at the public API — one account's failure never aborts the others,
// failures land in `detail` / the transport state (never thrown) — plus the
// byte-equivalent flag-off no-ops. The happy path (install → load → start →
// drive against real supply + a real daemon) is the live E2E's job: it needs
// the pinned OpenClaw tarballs and a trusted daemon session, both out of
// reach of a unit test.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createMemoryDatabase } from "../../db/memory.js";
import type { DatabaseRuntime } from "../../db/runtime/index.js";
import { OrganizationTriggerStore } from "../../triggers/store.js";
import type { Database } from "../../db/types.js";
import { enrollTestDaemon } from "../../test-utils/project-configuration.js";
import type { PlaneLogger } from "../plane/types.js";
import { createChannelSupervisor, flatInboundNormalizer } from "./index.js";
import type {
  ChannelAccountStatusEntry,
  ChannelSupervisor,
  ChannelSupervisorOptions,
} from "./types.js";

const HUB_YAML = `
environments:
  work:
    kind: daemon
    daemon: daemon-10000000
    cwd: /workspace/app
agents:
  codex-safe:
    provider: codex
    model: gpt-5.5
`;

const POLICY_YAML = `
enabled: true
channels:
  slack:
    enabled: true
`;

function accountYaml(accountId: string, enabled: boolean): string {
  return `
channel: slack
accountId: ${accountId}
connectionId: slack:${accountId}
transport:
  mode: socket
${enabled ? "" : "enabled: false\n"}routes:
  - match:
      kind: dm
    agent: codex-safe
    environment: work
fallback:
  deny: true
`;
}

const ORG_ID = "org-1";

/**
 * A pin manifest with no channel entries: every install fails closed at
 * `ensureChannelInstalled` ("unknown channel") BEFORE any network I/O, which is
 * the deterministic failure seam the isolation tests drive.
 */
const PINS_FIXTURE = {
  registry: "https://registry.npmjs.org",
  main: { package: "openclaw", version: "1.0.0", dist: { integrity: `sha512-${"A".repeat(128)}` } },
  channels: {},
};

function memoryDatabase(): Database {
  return createMemoryDatabase({
    memberships: [
      {
        userId: "user-1",
        organizationId: ORG_ID,
        organizationName: "Operator",
        organizationSlug: "operator",
        membershipId: "member-1",
        role: "owner",
      },
    ],
  });
}

/** The single org's active Channel revision: two enabled
 * slack accounts (`work`, `ops`) and one disabled one (`off`). */
async function seedConfiguration(database: Database): Promise<void> {
  await enrollTestDaemon(database, ORG_ID);
  await new OrganizationTriggerStore(database, ORG_ID).save({
    yaml: `name: handoff\nenabled: true\non:\n  manual.run: {}\nrun:\n  target: { daemon: daemon-10000000, cwd: /workspace/app }\n  agent: { provider: codex, mode: default }\n  prompt: hand off\n  max_runtime: 1h\n  idle_timeout: 5m\n`,
    userId: null,
  });
  const files = [
    { path: ".paseo/hub.yml", content: HUB_YAML },
    { path: ".paseo/channels/policy.yml", content: POLICY_YAML },
    { path: ".paseo/channels/slack/work.yml", content: accountYaml("work", true) },
    { path: ".paseo/channels/slack/ops.yml", content: accountYaml("ops", true) },
    { path: ".paseo/channels/slack/off.yml", content: accountYaml("off", false) },
  ];
  await database.saveChannelConfiguration({
    organizationId: ORG_ID,
    files,
    contentHash: "test-channel-configuration",
    createdByUserId: null,
  });
}

/** The supervisor only calls `runtime.drizzle()` at construction (ChannelStore);
 * the install-failure paths below issue no query, so a bare handle suffices. */
function fakeDatabaseRuntime(): DatabaseRuntime {
  return { drizzle: () => ({}) } as unknown as DatabaseRuntime;
}

describe("createChannelSupervisor", () => {
  let dataDir: string;
  let pinsPath: string;
  let warnings: string[];
  const logger: PlaneLogger = {
    warn: (message) => {
      warnings.push(message);
    },
  };

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), "hub-supervisor-"));
    pinsPath = join(dataDir, "channel-pins.json");
    writeFileSync(pinsPath, JSON.stringify(PINS_FIXTURE));
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function supervisorFor(options: Partial<ChannelSupervisorOptions>): ChannelSupervisor {
    warnings = [];
    return createChannelSupervisor({
      database: options.database ?? memoryDatabase(),
      databaseRuntime: fakeDatabaseRuntime(),
      dataDir,
      pinsPath,
      logger,
      resolveConnection: () =>
        Promise.resolve({ botToken: "test-bot-token", appToken: "test-app-token" }),
      ...(options.env !== undefined ? { env: options.env } : {}),
    });
  }

  describe("flag off (byte-equivalent no-ops)", () => {
    it("defers startAccount and touches no install dir, no config, no logs", async () => {
      const database = memoryDatabase();
      await seedConfiguration(database);
      const supervisor = supervisorFor({
        database,
        env: { PASEO_HUB_CHANNELS_ENABLED: "0" },
      });
      const result = await supervisor.startAccount("slack", "work");
      assert.deepEqual(result, {
        channel: "slack",
        account: "work",
        installed: false,
        transport: "deferred",
        detail: "the channel control plane is disabled",
      });
      assert.equal(existsSync(join(dataDir, "channels")), false);
      assert.deepEqual(supervisor.status(), []);
      assert.deepEqual(warnings, []);
    });

    it("keeps startAll / reconcile / stopAll safe no-ops", async () => {
      const database = memoryDatabase();
      await seedConfiguration(database);
      const supervisor = supervisorFor({
        database,
        env: { PASEO_HUB_CHANNELS_ENABLED: "off" },
      });
      await supervisor.startAll();
      assert.deepEqual(await supervisor.reconcile(), { accounts: [], stopped: [] });
      await supervisor.stopAll();
      assert.deepEqual(supervisor.status(), []);
      assert.deepEqual(warnings, []);
    });
  });

  describe("flag on, config-level deferrals", () => {
    it("defers an account disabled in the active configuration", async () => {
      const database = memoryDatabase();
      await seedConfiguration(database);
      const supervisor = supervisorFor({ database });
      const result = await supervisor.startAccount("slack", "off");
      assert.deepEqual(result, {
        channel: "slack",
        account: "off",
        installed: false,
        transport: "deferred",
        detail: "channels are disabled in the active configuration",
      });
      // The attempt is booked as a deferred handle (visible to `channels
      // status`), carrying the same detail that explains the deferral.
      assert.deepEqual(supervisor.status(), [
        {
          channel: "slack",
          account: "off",
          integrity: "not-checked",
          loadTrace: "not-loaded",
          transport: "deferred",
          detail: "channels are disabled in the active configuration",
        },
      ]);
    });

    it("defers an account that is not in the active configuration", async () => {
      const database = memoryDatabase();
      await seedConfiguration(database);
      const supervisor = supervisorFor({ database });
      const result = await supervisor.startAccount("slack", "ghost");
      assert.deepEqual(result, {
        channel: "slack",
        account: "ghost",
        installed: false,
        transport: "deferred",
        detail: 'the account "ghost" is not in the active slack configuration',
      });
    });

    it("defers cleanly before the first Channel revision exists (log, not throw)", async () => {
      const supervisor = supervisorFor({ database: memoryDatabase() });
      const result = await supervisor.startAccount("slack", "work");
      assert.equal(result.transport, "deferred");
      assert.match(result.detail ?? "", /account|configuration|organization/u);
      assert.deepEqual(warnings, []);
    });
  });

  describe("supported channels", () => {
    /** A Discord account in the active configuration (slice 13b). */
    async function seedDiscord(database: Database): Promise<void> {
      await enrollTestDaemon(database, ORG_ID);
      await database.saveChannelConfiguration({
        organizationId: ORG_ID,
        files: [
          { path: ".paseo/hub.yml", content: HUB_YAML },
          { path: ".paseo/channels/policy.yml", content: POLICY_YAML },
          {
            path: ".paseo/channels/discord/guild.yml",
            content: `
channel: discord
accountId: guild
connectionId: discord:guild
transport:
  mode: gateway
routes:
  - match:
      kind: channel
    agent: codex-safe
    environment: work
fallback:
  deny: true
`,
          },
        ],
        contentHash: "test-discord-configuration",
        createdByUserId: null,
      });
    }

    it("drives a Discord account to the install step instead of rejecting its name", async () => {
      const database = memoryDatabase();
      await seedDiscord(database);
      const supervisor = supervisorFor({ database });
      // The pin fixture has no channels, so the account fails AT the install —
      // which is the point: nothing between the compiled configuration and the
      // supply gate treats `discord` as an unknown channel.
      const result = await supervisor.startAccount("discord", "guild");
      assert.equal(result.transport, "deferred");
      assert.equal(result.detail, "unknown channel: discord");
      assert.deepEqual(supervisor.status(), [
        {
          channel: "discord",
          account: "guild",
          integrity: "failed",
          loadTrace: "not-loaded",
          transport: "failed",
          detail: "unknown channel: discord",
        },
      ]);
    });
  });

  describe("P13 failure isolation (startAll never throws)", () => {
    it("isolates one account's install failure from the others", async () => {
      const database = memoryDatabase();
      await seedConfiguration(database);
      const supervisor = supervisorFor({ database });
      // Every install fails closed at the pin manifest (no channel entries) —
      // the assertion is that the sweep completes with per-account outcomes,
      // not a throw, and that the disabled account stays deferred.
      await supervisor.startAll();
      const statuses = new Map<string, ChannelAccountStatusEntry>();
      for (const entry of supervisor.status()) {
        statuses.set(`${entry.channel}:${entry.account}`, entry);
      }
      assert.deepEqual(statuses.get("slack:work"), {
        channel: "slack",
        account: "work",
        integrity: "failed",
        loadTrace: "not-loaded",
        transport: "failed",
        detail: "unknown channel: slack",
      });
      assert.equal(statuses.get("slack:ops")?.transport, "failed");
      assert.equal(statuses.get("slack:off")?.transport, "deferred");
      let failedStarts = 0;
      for (const message of warnings) {
        if (message === "channel account start failed") failedStarts += 1;
      }
      assert.equal(failedStarts, 2);
    });

    it("reconcile re-attempts failed accounts and drops the disabled one", async () => {
      const database = memoryDatabase();
      await seedConfiguration(database);
      const supervisor = supervisorFor({ database });
      await supervisor.startAll();
      const result = await supervisor.reconcile();
      // `off` is no longer enabled: its handle is removed from the map.
      assert.deepEqual(result.stopped, [{ channel: "slack", account: "off" }]);
      // Bundle files sort by path: `ops` re-attempts before `work` (both fail
      // at the pin manifest again).
      assert.deepEqual(result.accounts, [
        {
          channel: "slack",
          account: "ops",
          installed: false,
          transport: "deferred",
          detail: "unknown channel: slack",
        },
        {
          channel: "slack",
          account: "work",
          installed: false,
          transport: "deferred",
          detail: "unknown channel: slack",
        },
      ]);
      const accounts: string[] = [];
      for (const entry of supervisor.status()) accounts.push(entry.account);
      accounts.sort();
      assert.deepEqual(accounts, ["ops", "work"]);
    });

    it("stopAll tears down every booked handle", async () => {
      const database = memoryDatabase();
      await seedConfiguration(database);
      const supervisor = supervisorFor({ database });
      await supervisor.startAll();
      assert.equal(supervisor.status().length, 3);
      await supervisor.stopAll();
      assert.deepEqual(supervisor.status(), []);
    });
  });
});

// --- Inbound normalizer -------------------------------------------------------

describe("flatInboundNormalizer", () => {
  it("maps MessageSid to the marker's externalMessageId", () => {
    const message = flatInboundNormalizer({
      channel: "slack",
      accountId: "work",
      ctxPayload: {
        Body: "hi",
        ChatType: "channel",
        ChatId: "C0APP",
        SenderId: "U0ALICE",
        MessageSid: "1700000000.000001",
      },
    });
    assert.equal(message?.externalMessageId, "1700000000.000001");
  });

  it("omits externalMessageId when the ctxPayload carries no MessageSid", () => {
    const message = flatInboundNormalizer({
      channel: "slack",
      accountId: "work",
      ctxPayload: {
        Body: "hi",
        ChatType: "channel",
        ChatId: "C0APP",
        SenderId: "U0ALICE",
      },
    });
    assert.notEqual(message, null);
    assert.equal(message?.externalMessageId, undefined);
  });

  // Discord admission (slice 13b): the vertical emits `direct` for a DM and
  // `channel` for every guild message, with the thread id set when the message
  // sits in a thread (transport/gateway.ts). A channel with no in-repo vertical
  // is never normalized, whatever its payload looks like.
  it("maps a Discord guild message to a channel conversation", () => {
    const message = flatInboundNormalizer({
      channel: "discord",
      accountId: "guild",
      ctxPayload: {
        Body: "hi",
        ChatType: "channel",
        ChatId: "1180000000000000001",
        SenderId: "1190000000000000002",
        MessageSid: "1200000000000000003",
        WasMentioned: true,
      },
    });
    assert.equal(message?.channel, "discord");
    assert.equal(message?.senderIdentity, "discord:1190000000000000002");
    assert.equal(message?.conversation.kind, "channel");
    assert.equal(message?.conversation.threadId, null);
    assert.equal(message?.mentionedBot, true);
  });

  it("maps a Discord thread message to a thread conversation", () => {
    const message = flatInboundNormalizer({
      channel: "discord",
      accountId: "guild",
      ctxPayload: {
        Body: "hi",
        ChatType: "channel",
        ChatId: "1180000000000000001",
        SenderId: "1190000000000000002",
        MessageThreadId: "1180000000000000004",
        MessageSid: "1200000000000000005",
      },
    });
    assert.equal(message?.conversation.kind, "thread");
    assert.equal(message?.conversation.id, "1180000000000000004");
    assert.equal(message?.conversation.rootConversationId, "1180000000000000001");
  });

  it("maps a Discord DM to a dm conversation", () => {
    const message = flatInboundNormalizer({
      channel: "discord",
      accountId: "guild",
      ctxPayload: {
        Body: "hi",
        ChatType: "direct",
        ChatId: "1180000000000000006",
        SenderId: "1190000000000000002",
      },
    });
    assert.equal(message?.conversation.kind, "dm");
  });

  it("drops an inbound message from a channel with no in-repo vertical", () => {
    const message = flatInboundNormalizer({
      channel: "googlechat",
      accountId: "space",
      ctxPayload: {
        Body: "hi",
        ChatType: "channel",
        ChatId: "spaces/AAAA",
        SenderId: "users/1",
      },
    });
    assert.equal(message, null);
  });

  it("maps MessageThreadId to the marker conversation's threadId", () => {
    const message = flatInboundNormalizer({
      channel: "slack",
      accountId: "work",
      ctxPayload: {
        Body: "hi",
        ChatType: "channel",
        ChatId: "C0APP",
        SenderId: "U0ALICE",
        MessageThreadId: "1700000000.000002",
        MessageSid: "1700000001.000001",
      },
    });
    assert.equal(message?.conversation.kind, "thread");
    assert.equal(message?.conversation.threadId, "1700000000.000002");
    assert.equal(message?.externalMessageId, "1700000001.000001");
  });
});
