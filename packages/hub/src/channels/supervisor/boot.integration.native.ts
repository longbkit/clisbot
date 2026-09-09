// Supervisor boot against the REAL in-repo verticals + a FAKE daemon — the
// Step 1 test the 2026-08-26 review prescribed, re-pointed at the in-repo pull
// (blueprint §6.5): boot the supervisor with the real node:module loader
// hooks, the in-repo install (the Hub's own built workspace packages — no
// tarball, no integrity gate), and a loopback fake daemon; assert both P0
// accounts reach `started` through the in-repo markers, then push one
// real-shape Slack ctxPayload through the seam and assert the fake daemon
// received `create_agent_request` with the right provider/model + the first
// prompt as an interrupt.
//
// Why native (node:test + tsx) rather than vitest: the loader's node:module
// `registerHooks` only manifest under the real ESM loader — vitest's vite-node
// does not consult them (same mechanism as load-channel.native.ts). The host
// seam module is imported from the COMPILED `dist/` (tsgo output) while the
// supervisor runs from tsx source — the same cross-compilation split production
// has (vite bundle ↔ dist host modules) — so the global `Symbol.for` runtime
// store is exercised the same way.
//
// Runs: `npm run test:supervisor:native` (builds `dist/` first so the host
// module + runtime-store singleton are current). Skips cleanly when the
// in-repo verticals are not built, the live-test credential fixtures, or `.env` are absent.

import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { WebSocketServer } from "ws";
import { OrganizationTriggerStore } from "../../triggers/store.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import { createDatabase } from "../../db/pg.js";
import { createTestCredentialCipher } from "../../credentials/test-utils.js";
import type { Database } from "../../db/types.js";
import { enrollTestDaemon, TEST_DAEMON_SLUG } from "../../test-utils/project-configuration.js";
import { createChannelSupervisor } from "./index.js";
import type { ChannelSupervisor, ChannelSupervisorOptions } from "./types.js";

// --- Fixed dev state (e2e-dev.sh): never ~/.paseo, never .dev/paseo-home -----

const DEV_HOME = process.env["CLISBOT_HOME"] ?? join(homedir(), ".clisbot-dev");
// The test file's location: packages/hub/src/channels/supervisor/ — six
// levels up (the file itself is the first) reaches the repo root.
const REPO_ROOT = fileURLToPath(new URL("../../../../..", import.meta.url));
const HUB_DIST_LOADER = join(REPO_ROOT, "packages", "hub", "dist", "channels", "loader");
const PINS_PATH = join(REPO_ROOT, "packages", "hub", "channel-pins.json");

/** The in-repo workspace package dirs (blueprint §6.5): the workspace
 * symlinks under the repo root node_modules, real-pathed to the package
 * dirs — the same resolution the installer's `resolveInRepoPackageDir`
 * lands on. */
function inRepoPackageDir(packageName: string): string {
  return realpathSync(join(REPO_ROOT, "node_modules", packageName));
}
const SLACK_IN_REPO = inRepoPackageDir("@getpaseo/channels-slack");
const TELEGRAM_IN_REPO = inRepoPackageDir("@getpaseo/channels-telegram");
const DISCORD_IN_REPO = inRepoPackageDir("@getpaseo/channels-discord");

// Every hub-side log line (info/warn/error), captured for assertions: a
// dropped marker must be named by a log line, never asserted by silence.
// Timestamps in milliseconds relative to process start — the flake's socket
// close/reopen ordering is only legible on a shared clock.
const t0 = Date.now();
const hubLogLines: string[] = [];
function logLine(line: string): void {
  const stamped = `[t+${Date.now() - t0}ms] ${line}`;
  hubLogLines.push(stamped);
  process.stderr.write(`${stamped}\n`);
}

const ORG_ID = "org-boot";
const ENV_CWD = "/workspace/e2e-boot";
const SLACK_SENDER = "U_BOOT_TEST"; // synthetic; the policy grants it bot.interact
const THREAD_TS = "1753500000.000001"; // synthetic thread ts (the route match key)
const LIVE_HUB_LOCAL = join(DEV_HOME, "hub-local.json");

/** The live hub (if running) holds the same Slack app's socket connection:
 * Slack delivers each socket event to ONE client, so the in-test vertical
 * would not receive the marker while the live hub is up. Subtest 3 skips
 * (never fights) when the live hub is alive. */
function liveHubRunning(): boolean {
  let pid = 0;
  try {
    pid = (JSON.parse(readFileSync(LIVE_HUB_LOCAL, "utf8")) as { pid?: number }).pid ?? 0;
  } catch {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function slackAuthUserId(token: string): Promise<string> {
  const res = await fetch("https://slack.com/api/auth.test", {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as {
    ok: boolean;
    user_id?: string;
    error?: string;
  };
  if (!body.ok || body.user_id === undefined) {
    throw new Error(`auth.test failed: ${body.error ?? JSON.stringify(body)}`);
  }
  return body.user_id;
}

function envVar(name: string): string | undefined {
  if (!existsSync(join(REPO_ROOT, ".env"))) return undefined;
  const line = readFileSync(join(REPO_ROOT, ".env"), "utf8")
    .split("\n")
    .find((candidate) => candidate.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).trim();
  return value !== undefined && value !== "" ? value : undefined;
}

/** A live-test setting from the process env, falling back to the repo `.env`. */
function configuredVar(name: string): string | undefined {
  return process.env[name] ?? envVar(name);
}

/**
 * Discord joins the boot only when its bot token and a test channel are
 * configured (slice 13c). The credentials are not in the repo `.env` today, so
 * the case skips instead of failing; export `DISCORD_BOT_TOKEN` and
 * `DISCORD_TEST_CHANNEL_ID` to run it.
 */
const DISCORD_BOT_TOKEN = configuredVar("DISCORD_BOT_TOKEN");
const DISCORD_TEST_CHANNEL_ID = configuredVar("DISCORD_TEST_CHANNEL_ID");

/** `false` when Discord may join the boot; otherwise the skip reason. */
function discordSkip(): string | false {
  if (DISCORD_BOT_TOKEN === undefined || DISCORD_TEST_CHANNEL_ID === undefined) {
    return "DISCORD_BOT_TOKEN / DISCORD_TEST_CHANNEL_ID are not configured";
  }
  if (!existsSync(join(DISCORD_IN_REPO, "dist", "plugin.js"))) {
    return "the in-repo Discord vertical is not built (@getpaseo/channels-discord dist missing)";
  }
  return false;
}
const DISCORD_SKIP = discordSkip();

function supplyPresent(): boolean {
  // In-repo (blueprint §6.5): the supply is the Hub's own built workspace
  // packages — no provisioned install dir, no tarball, no integrity gate.
  return (
    existsSync(join(SLACK_IN_REPO, "dist", "index.js")) &&
    existsSync(join(SLACK_IN_REPO, "dist", "plugin.js")) &&
    existsSync(join(TELEGRAM_IN_REPO, "dist", "index.js")) &&
    existsSync(join(TELEGRAM_IN_REPO, "dist", "plugin.js")) &&
    existsSync(join(DEV_HOME, "secrets", "slack--work")) &&
    existsSync(join(DEV_HOME, "secrets", "telegram--work")) &&
    existsSync(join(HUB_DIST_LOADER, "hosts", "channel-inbound.js")) &&
    envVar("SLACK_TEST_CHANNEL") !== undefined
  );
}

const SKIP = supplyPresent()
  ? false
  : "in-repo channel verticals not built (@getpaseo/channels-{slack,telegram} dist missing), " +
    `or the live-test credential fixtures / .env are absent under ${DEV_HOME} (build the workspace packages first)`;

// --- Fake daemon (the stock local-client wire, trimmed to the P0 surface) ---

interface RecordedMessage {
  type: string;
  [key: string]: unknown;
}

class FakeDaemon {
  readonly server: Server;
  readonly wss: WebSocketServer;
  readonly messages: RecordedMessage[] = [];
  private readonly clients = new Set<import("ws").WebSocket>();
  port = 0;

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.server = createServer();
    this.server.on("upgrade", (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (client) => {
        this.clients.add(client);
        client.on("close", (code, reason) => {
          this.clients.delete(client);
          // Test diagnostic: which side closed the socket, and why — on the
          // shared test clock, ordered against the hub's own log lines.
          process.stderr.write(
            `[t+${Date.now() - t0}ms] [fake-daemon] client closed code=${String(code)} reason=${reason.toString()} clients=${this.clients.size}\n`,
          );
        });
        client.on("error", (error: Error) => {
          process.stderr.write(`[fake-daemon] client error ${error.message}\n`);
        });
        client.on("message", (data) => this.onMessage(client, data.toString()));
      });
    });
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", () => resolve()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  close(): Promise<void> {
    for (const client of this.clients) client.terminate();
    return new Promise((resolve) => {
      this.wss.close(() => this.server.close(() => resolve()));
    });
  }

  private onMessage(client: import("ws").WebSocket, raw: string): void {
    const frame = JSON.parse(raw) as { type: string; [key: string]: unknown };
    if (frame.type === "hello") {
      client.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: { status: "server_info", serverId: "boot-fake" },
          },
        }),
      );
      return;
    }
    if (frame.type === "ping") {
      client.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (frame.type !== "session" || typeof frame["message"] !== "object") return;
    const message = frame["message"] as RecordedMessage;
    this.messages.push(message);
    this.respond(client, message);
  }

  /** The stock wire shapes: create replies with a `status` frame; the other
   * RPCs reply with their dedicated `*_response` frame. All carry the
   * correlation id in the payload. */
  private respond(client: import("ws").WebSocket, message: RecordedMessage): void {
    switch (message["type"]) {
      case "create_agent_request": {
        client.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "status",
              payload: {
                status: "agent_created",
                requestId: message["requestId"],
                agentId: "agent-1",
                agent: {
                  id: "agent-1",
                  provider: "codex",
                  status: "initializing",
                },
              },
            },
          }),
        );
        return;
      }
      case "send_agent_message_request": {
        client.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "send_agent_message_response",
              payload: {
                requestId: message["requestId"],
                agentId: "agent-1",
                accepted: true,
              },
            },
          }),
        );
        return;
      }
      case "fetch_agents_request": {
        client.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "fetch_agents_response",
              payload: {
                requestId: message["requestId"],
                entries: [
                  {
                    agent: { id: "agent-1", provider: "codex", status: "idle" },
                  },
                ],
                pageInfo: {
                  nextCursor: null,
                  prevCursor: null,
                  hasMore: false,
                },
              },
            },
          }),
        );
        return;
      }
      case "agent.timeline.set_subscription.request": {
        client.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "agent.timeline.set_subscription.response",
              payload: {
                agentIds: message["agentIds"],
                requestId: message["requestId"],
              },
            },
          }),
        );
        return;
      }
      default: {
        client.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "rpc_error",
              payload: {
                requestId: message["requestId"],
                error: `boot-fake: unhandled ${String(message["type"])}`,
              },
            },
          }),
        );
      }
    }
  }
}

// --- Boot-time configuration (the active revision the control plane reads) ---

const HUB_YAML = `
environments:
  work:
    kind: daemon
    daemon: ${TEST_DAEMON_SLUG}
    cwd: ${ENV_CWD}
agents:
  codex-e2e:
    provider: codex
    model: gpt-5.6-luna
`;

function policyYaml(liveSender: string | undefined): string {
  const liveIdentity = liveSender !== undefined ? `\n      - slack:${liveSender}` : "";
  return `
enabled: true
channels:
  slack:
    enabled: true
  telegram:
    enabled: true${DISCORD_SKIP === false ? "\n  discord:\n    enabled: true" : ""}
roles:
  ops:
    grants:
      - bot.interact
assignments:
  - identities:
      - slack:${SLACK_SENDER}${liveIdentity}
    roles:
      - ops
`;
}

function slackAccountYaml(connectionId: string): string {
  return `
channel: slack
accountId: work
connectionId: ${connectionId}
transport:
  mode: socket
routes:
  - match:
      kind: channel
      ids: [C-WORKFLOW-E2E]
    workflow: boot-strap
  - match:
      kind: thread
    agent: codex-e2e
    environment: work
  - match:
      kind: channel
    agent: codex-e2e
    environment: work
fallback:
  deny: true
`;
}

function telegramAccountYaml(connectionId: string): string {
  return `
channel: telegram
accountId: work
connectionId: ${connectionId}
transport:
  mode: polling
routes:
  - match:
      kind: group
    agent: codex-e2e
    environment: work
  - match:
      kind: topic
    agent: codex-e2e
    environment: work
fallback:
  deny: true
`;
}

function discordAccountYaml(connectionId: string): string {
  return `
channel: discord
accountId: work
connectionId: ${connectionId}
transport:
  mode: gateway
routes:
  - match:
      kind: channel
      ids: [${DISCORD_TEST_CHANNEL_ID ?? ""}]
    agent: codex-e2e
    environment: work
fallback:
  deny: true
`;
}

const DISCORD_CONNECTION_ID = "00000000-0000-4000-8000-000000000003";

describe("channel supervisor boot (real supply + fake daemon)", { skip: SKIP }, () => {
  let workDir: string;
  let dataDir: string;
  let dbDir: string;
  let bundle: DatabaseRuntimeBundle;
  let database: Database;
  let daemon: FakeDaemon;
  let supervisor: ChannelSupervisor;
  let liveSenderId: string | undefined;
  let liveBotUserId: string | undefined;
  const workflowDispatches: Array<
    Parameters<NonNullable<ChannelSupervisorOptions["dispatchWorkflow"]>>[0]
  > = [];

  before(async () => {
    workDir = mkdtempSync(join(tmpdir(), "hub-boot-"));
    dataDir = join(workDir, "data");
    dbDir = join(workDir, "db");
    daemon = new FakeDaemon();
    await daemon.listen();

    // 1. The in-repo install (blueprint §6.5): no supply copy and no mutable
    // install marker — the Hub resolves and drives its own built workspace
    // packages directly from the package-manager dependency tree.
    const pins = JSON.parse(readFileSync(PINS_PATH, "utf8")) as {
      main: { package: string; version: string; dist: { integrity: string } };
      channels: Record<
        string,
        {
          loadMode: "published" | "bundled" | "in-repo";
          entry: string;
          channel: {
            package: string;
            version: string;
            dist: { integrity: string; gitHead?: string };
          };
        }
      >;
    };
    const slackPin = pins.channels["slack"];
    const telegramPin = pins.channels["telegram"];
    if (slackPin === undefined || telegramPin === undefined) {
      throw new Error("channel-pins.json must carry both P0 verticals");
    }
    if (slackPin.loadMode !== "in-repo" || telegramPin.loadMode !== "in-repo") {
      throw new Error("channel-pins.json must pull both P0 verticals in-repo");
    }
    const workAccountRoot = join(dataDir, "channels", "work");
    mkdirSync(workAccountRoot, { recursive: true });
    // The live dev home's persisted per-account state (poll offsets, dedupe
    // caches) — reused across runs (CLAUDE.md channel E2E guardrail) so a
    // fresh boot does not replay the dev bot's whole update history from
    // offset 0 into the fake daemon.
    const liveState = join(DEV_HOME, "channels", "work", "state");
    if (existsSync(liveState)) {
      cpSync(liveState, join(workAccountRoot, "state"), { recursive: true });
    }
    // 2. Test-only credential fixtures supplied through the resolver seam. `cpSync`
    // copies the file's own mode, so chmod only if the source was wider.
    const slackSecret = join(dataDir, "secrets", "slack-work.json");
    const telegramSecret = join(dataDir, "secrets", "telegram-work.json");
    cpSync(join(DEV_HOME, "secrets", "slack--work"), slackSecret);
    cpSync(join(DEV_HOME, "secrets", "telegram--work"), telegramSecret);
    chmodSync(slackSecret, 0o600);
    chmodSync(telegramSecret, 0o600);

    // 3. The live sender + bot ids for subtest 3 (real Slack socket pipeline).
    // The user credential is the configured `[vex]-slack` user token (the same
    // one the live E2E markers post with); the bot id comes from the app's
    // bot token. Both are raw connectivity checks, allowed at any stage.
    const userToken = process.env["SLACK_MCP_XOXP_TOKEN"] ?? envVar("SLACK_MCP_XOXP_TOKEN");
    const botToken = envVar("SLACK_BOT_TOKEN");
    if (userToken !== undefined && botToken !== undefined) {
      try {
        liveSenderId = await slackAuthUserId(userToken);
        liveBotUserId = await slackAuthUserId(botToken);
      } catch (error) {
        // Offline/no-creds: subtest 3 skips on the missing ids, not the suite.
        process.stderr.write(`[hub][warn] live Slack ids unavailable: ${String(error)}\n`);
      }
    }

    // 4. The embedded database + the organization-owned Channel revision.
    bundle = await embeddedDatabaseRuntime(dbDir);
    await bundle.runtime.migrate();
    await bundle.runtime.query(
      "insert into organization (id, name, slug) values ($1, 'Boot Org', 'boot-org')",
      [ORG_ID],
    );
    database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
    await enrollTestDaemon(database, ORG_ID);
    await new OrganizationTriggerStore(database, ORG_ID).save({
      yaml: `name: boot-strap\nenabled: true\non:\n  manual.run: {}\nrun:\n  target: { daemon: ${TEST_DAEMON_SLUG}, cwd: ${ENV_CWD} }\n  agent: { provider: codex, mode: default }\n  prompt: placeholder\n  max_runtime: 1h\n  idle_timeout: 5m\n`,
      userId: null,
    });
    const files = [
      { path: ".paseo/hub.yml", content: HUB_YAML },
      {
        path: ".paseo/channels/policy.yml",
        content: policyYaml(liveSenderId),
      },
      {
        path: ".paseo/channels/slack/work.yml",
        content: slackAccountYaml("00000000-0000-4000-8000-000000000001"),
      },
      {
        path: ".paseo/channels/telegram/work.yml",
        content: telegramAccountYaml("00000000-0000-4000-8000-000000000002"),
      },
      ...(DISCORD_SKIP === false
        ? [
            {
              path: ".paseo/channels/discord/work.yml",
              content: discordAccountYaml(DISCORD_CONNECTION_ID),
            },
          ]
        : []),
    ];
    await database.saveChannelConfiguration({
      organizationId: ORG_ID,
      files,
      contentHash: "native-channel-configuration",
      createdByUserId: null,
    });

    // 4. The supervisor: real install dir + real pins, loopback fake daemon,
    // and an env WITHOUT PASEO_PASSWORD (the fake upgrade carries no subprotocol).
    // The verticals run IN THIS process, so the native verbose log lever is
    // process.env, not the supervisor's env copy (the supervisor only reads it
    // for the channels flag + daemon password). shouldLogVerbose ->
    // isFileLogLevelEnabled("debug") reads process.env directly; every native
    // drop gate (mention policy, allowlist, debounce, ACP binding) logs at
    // debug to the openclaw file log — a drop must be named, not guessed.
    process.env["OPENCLAW_LOG_LEVEL"] = "debug";
    const env = { ...process.env } as NodeJS.ProcessEnv;
    delete env["PASEO_PASSWORD"];
    env["PASEO_HUB_CHANNELS_ENABLED"] = "1";
    env["OPENCLAW_LOG_LEVEL"] = "debug";
    supervisor = createChannelSupervisor({
      database,
      databaseRuntime: bundle.runtime,
      dataDir,
      pinsPath: PINS_PATH,
      daemon: { host: `127.0.0.1:${daemon.port}` },
      resolveConnection: ({ channel }) => {
        if (channel === "discord") {
          return Promise.resolve(
            DISCORD_BOT_TOKEN === undefined ? undefined : { botToken: DISCORD_BOT_TOKEN },
          );
        }
        const raw = readFileSync(channel === "slack" ? slackSecret : telegramSecret, "utf8");
        const parsed = JSON.parse(raw) as {
          botToken?: string;
          appToken?: string;
          token?: string;
        };
        const resolvedBotToken = parsed.botToken ?? parsed.token;
        if (resolvedBotToken === undefined) return Promise.resolve(undefined);
        return Promise.resolve({
          botToken: resolvedBotToken,
          ...(parsed.appToken === undefined ? {} : { appToken: parsed.appToken }),
        });
      },
      env,
      dispatchWorkflow: async (input) => {
        workflowDispatches.push(input);
      },
      logger: {
        info: (message, meta) => logLine(`[hub][info] ${message} ${JSON.stringify(meta)}`),
        warn: (message, meta) => logLine(`[hub][warn] ${message} ${JSON.stringify(meta)}`),
        error: (message, meta) => logLine(`[hub][error] ${message} ${JSON.stringify(meta)}`),
      },
    });
    await supervisor.startAll();
  });

  after(async () => {
    await supervisor?.stopAll();
    await daemon?.close();
    await bundle?.runtime.close();
    if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true });
  });

  it("boots both P0 accounts on the shared install root: transport started", () => {
    const entries = supervisor.status();
    const slack = entries.find((entry) => entry.channel === "slack" && entry.account === "work");
    const telegram = entries.find(
      (entry) => entry.channel === "telegram" && entry.account === "work",
    );
    assert.ok(slack !== undefined, `slack:work handle missing: ${JSON.stringify(entries)}`);
    assert.ok(telegram !== undefined, `telegram:work handle missing: ${JSON.stringify(entries)}`);
    assert.equal(slack.detail, undefined, `slack:work deferred: ${slack.detail}`);
    assert.equal(telegram.detail, undefined, `telegram:work deferred: ${telegram.detail}`);
    assert.deepEqual(
      {
        slack: [slack.integrity, slack.loadTrace, slack.transport],
        telegram: [telegram.integrity, telegram.loadTrace, telegram.transport],
      },
      {
        slack: ["ok", "ok", "started"],
        telegram: ["ok", "ok", "started"],
      },
    );
  });

  it("boots the Discord account on its gateway transport", { skip: DISCORD_SKIP }, () => {
    const discord = supervisor
      .status()
      .find((entry) => entry.channel === "discord" && entry.account === "work");
    assert.ok(
      discord !== undefined,
      `discord:work handle missing: ${JSON.stringify(supervisor.status())}`,
    );
    assert.equal(discord.detail, undefined, `discord:work deferred: ${discord.detail}`);
    assert.deepEqual(
      [discord.integrity, discord.loadTrace, discord.transport],
      ["ok", "ok", "started"],
    );
  });

  it("drives one real-shape Slack ctxPayload through the seam into the fake daemon", async () => {
    // The compiled host module (dist/): the SAME file production's loader hooks
    // serve as the bound `openclaw/plugin-sdk/channel-inbound` seam. Its
    // getChannelRuntime reads the global runtime store the tsx-loaded supervisor
    // filled at startAll — the cross-compilation split the global exists for.
    const host = (await import(
      pathToFileURL(join(HUB_DIST_LOADER, "hosts", "channel-inbound.js")).toString()
    )) as {
      dispatchChannelInboundReply(params: Record<string, unknown>): Promise<{
        dispatched: boolean;
        [key: string]: unknown;
      }>;
    };
    const chatId = envVar("SLACK_TEST_CHANNEL") as string;
    const ctxPayload = {
      AccountId: "work",
      Body: "boot-integration-e2e first mention",
      ChatType: "channel",
      ChatId: chatId,
      MessageThreadId: THREAD_TS,
      SenderId: SLACK_SENDER,
      From: SLACK_SENDER,
      WasMentioned: true,
    };
    const result = await host.dispatchChannelInboundReply({
      channel: "slack",
      accountId: "work",
      ctxPayload,
    });
    assert.equal(result.dispatched, true, JSON.stringify(result));

    const create = daemon.messages.find((message) => message["type"] === "create_agent_request");
    assert.ok(
      create !== undefined,
      `no create_agent_request: ${JSON.stringify(daemon.messages.map((m) => m["type"]))}`,
    );
    const config = create["config"] as Record<string, unknown>;
    assert.equal(config["provider"], "codex");
    assert.equal(config["model"], "gpt-5.6-luna");
    assert.equal(config["cwd"], ENV_CWD);
    assert.match(String(config["title"]), /^clisbot-channel:[0-9a-f-]{36}$/u);

    const send = daemon.messages.find(
      (message) => message["type"] === "send_agent_message_request",
    );
    assert.ok(send !== undefined, "no send_agent_message_request");
    assert.equal(send["agentId"], "agent-1");
    assert.equal(send["text"], ctxPayload["Body"]);
    // steer:false (the first prompt that starts the turn) = "interrupt".
    assert.equal(send["activeTurnBehavior"], "interrupt");
  });

  it("drives a real-shape Slack inbound through a workflow route without creating a direct Agent", async () => {
    const host = (await import(
      pathToFileURL(join(HUB_DIST_LOADER, "hosts", "channel-inbound.js")).toString()
    )) as {
      dispatchChannelInboundReply(params: Record<string, unknown>): Promise<{
        dispatched: boolean;
        [key: string]: unknown;
      }>;
    };
    const createsBefore = daemon.messages.filter(
      (message) => message["type"] === "create_agent_request",
    ).length;
    const result = await host.dispatchChannelInboundReply({
      channel: "slack",
      accountId: "work",
      ctxPayload: {
        AccountId: "work",
        Body: "run the workflow",
        ChatType: "channel",
        ChatId: "C-WORKFLOW-E2E",
        SenderId: SLACK_SENDER,
        From: SLACK_SENDER,
        WasMentioned: true,
        MessageSid: "1712000000.000321",
      },
    });

    assert.equal(result.dispatched, true, JSON.stringify(result));
    assert.equal(workflowDispatches.length, 1);
    assert.equal(workflowDispatches[0]!.payload.workflow, "boot-strap");
    assert.equal(workflowDispatches[0]!.payload.channel.route.defaults.outbound.path, "relay");
    assert.equal(
      daemon.messages.filter((message) => message["type"] === "create_agent_request").length,
      createsBefore,
    );
  });

  /**
   * The live-drop repro (2026-08-26): drive a REAL marker through the pinned
   * Slack vertical's REAL socket-mode pipeline — Slack delivers the
   * app_mention to this process's SocketModeClient, the native dedupe/debounce/
   * prepare/gates run, the seam hands the event to the plane, and the plane
   * must hit the fake daemon. This is the exact native path the live E2E
   * exercises, minus the live hub: the same app has ONE socket consumer, so
   * the live hub must be stopped (the test skips rather than fights it).
   * A drop here is reproduced + named in seconds, not in a 5–15 min restart
   * cycle; all hub-side logging (seam miss, plane outcome, socket state) and
   * the native verbose log (OPENCLAW_LOG_LEVEL=debug) are captured on stderr.
   */
  it(
    "drives a real marker through the vertical's live Slack socket into the fake daemon",
    { skip: liveSkipReason(), timeout: 180_000 },
    async function liveSocketPipeline() {
      const userToken = process.env["SLACK_MCP_XOXP_TOKEN"] ?? envVar("SLACK_MCP_XOXP_TOKEN");
      assert.ok(userToken !== undefined, "SLACK_MCP_XOXP_TOKEN missing");
      assert.ok(
        liveSenderId !== undefined && liveBotUserId !== undefined,
        "live Slack ids unavailable",
      );
      const chatId = envVar("SLACK_TEST_CHANNEL") as string;

      // The vertical's socket connection is async behind startAll: wait for
      // its "slack socket mode connected" before posting (Slack delivers a
      // socket event to the connected client only). 60s, not 30: the
      // SocketModeClient's initial handshake has no connect timeout, and a
      // transient Slack-side stall sits in `client.start()` with ZERO vertical
      // log lines (the first line lands on success or reject) — observed
      // 2026-08-26: a stall here is transient, the vertical connects on retry.
      const startedAt = Date.now();
      while (!hubLogLines.some((line) => line.includes("slack socket mode connected"))) {
        assert.ok(
          Date.now() - startedAt < 60_000,
          `no socket connect; log:\n${hubLogLines.join("\n")}`,
        );
        await new Promise((resolve) => setImmediate(resolve));
      }

      const logBaseline = hubLogLines.length;
      // Subtest 2 already drove a create + first prompt into the fake daemon;
      // only frames recorded after this point belong to the live marker.
      const frameBaseline = daemon.messages.length;
      const marker = `clisbot-boot-native-${Date.now().toString(36)}`;
      const post = (await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          authorization: `Bearer ${userToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          channel: chatId,
          text: `<@${liveBotUserId}> ${marker} — please reply with exactly: E2E-OK ${marker}`,
        }),
      }).then((response) => response.json())) as {
        ok: boolean;
        ts?: string;
        error?: string;
      };
      assert.equal(post.ok, true, `marker post failed: ${post.error ?? JSON.stringify(post)}`);
      const markerTs = post.ts as string;

      // The full native pipeline (socket -> dedupe -> debounce -> prepare ->
      // gates -> seam -> plane -> binding -> createAgent + first prompt) is
      // async end to end; poll the fake daemon's recorded frames.
      const deadline = Date.now() + 30_000;
      const markerFrames = () => daemon.messages.slice(frameBaseline);
      let create: RecordedMessage | undefined;
      while (Date.now() < deadline) {
        create = markerFrames().find((message) => message["type"] === "create_agent_request");
        if (create !== undefined) break;
        await new Promise((resolve) => setImmediate(resolve));
      }
      const recentLog = hubLogLines.slice(logBaseline).join("\n");
      assert.ok(
        create !== undefined,
        `no create_agent_request after live marker ${markerTs} (ts ${markerTs}); log since marker:\n${recentLog}\n${nativeLogTail()}`,
      );
      const config = create["config"] as Record<string, unknown>;
      assert.equal(config["provider"], "codex");
      assert.equal(config["model"], "gpt-5.6-luna");
      // The first prompt lands AFTER the create round-trip settles (the fake
      // daemon's agent_created response, then the plane's ledger consume +
      // post) — poll it like the create, never check it synchronously: create
      // and the first prompt are not guaranteed adjacent in the fake daemon's
      // frame log (observed 2026-08-26: create recorded, send still in flight
      // at the synchronous check).
      let send: RecordedMessage | undefined;
      while (Date.now() < deadline) {
        send = markerFrames().find((message) => message["type"] === "send_agent_message_request");
        if (send !== undefined) break;
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.ok(
        send !== undefined,
        `no first prompt after create; log:\n${recentLog}\n${nativeLogTail()}`,
      );
      assert.equal(
        send["text"],
        `<@${liveBotUserId}> ${marker} — please reply with exactly: E2E-OK ${marker}`,
      );

      // Self-verify the live send the way the E2E guardrail requires: read the
      // channel back and match the marker's ts (a send without read-back is
      // not a verified send).
      const history = (await fetch(
        `https://slack.com/api/conversations.history?channel=${chatId}&limit=5`,
        { headers: { authorization: `Bearer ${userToken}` } },
      ).then((response) => response.json())) as {
        ok: boolean;
        messages?: Array<{
          ts: string;
          user?: string;
          text?: string;
          bot_id?: string;
        }>;
      };
      assert.equal(history.ok, true, "history read-back failed");
      const readBack = history.messages?.find((message) => message.ts === markerTs);
      assert.ok(readBack !== undefined, `marker ${markerTs} not in read-back`);
      assert.match(readBack.text ?? "", new RegExp(marker, "u"));
      console.log(
        `live marker ${markerTs} verified in read-back; fake daemon saw create + first prompt`,
      );
    },
  );
});

/** The vertical's native file log tail (OPENCLAW_LOG_LEVEL=debug is on for
 * the whole test process). Every native drop gate names itself here — when a
 * marker never reaches the plane, this is where the gate that dropped it is.
 * The pinned logger resolves /tmp/openclaw first and falls back to
 * `<tmpdir>/openclaw-<uid>`; check both. */
function nativeLogTail(lines = 40): string {
  // The native verbose log is DATE-STAMPED (`openclaw-YYYY-MM-DD.log`), not a
  // fixed `openclaw.log` (logger-DPps3u8A.js L153-159 + tmp-openclaw-dir: the
  // preferred dir is /tmp/openclaw, fallback <tmpdir>/openclaw-<uid>). Resolve
  // today's stamp and fall back to the newest `openclaw-*.log` in each dir.
  const stamp = new Date().toISOString().slice(0, 10);
  const dirs = ["/tmp/openclaw", join(tmpdir(), `openclaw-${process.getuid?.() ?? ""}`)];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let file = join(dir, `openclaw-${stamp}.log`);
    if (!existsSync(file)) {
      const dated = readdirSync(dir)
        .filter((name) => /^openclaw-\d{4}-\d{2}-\d{2}\.log$/.test(name))
        .sort()
        .at(-1);
      if (dated !== undefined) file = join(dir, dated);
    }
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8").split("\n");
    return `openclaw ${file} tail:\n${content.slice(-lines).join("\n")}`;
  }
  return "(no date-stamped openclaw log found — native verbose log never materialized)";
}

function liveSkipReason(): string | false {
  if (liveHubRunning()) {
    return "the live hub is running and holds this Slack app's socket connection (one socket consumer per app); stop it first (scripts/e2e-dev.sh stop)";
  }
  if (
    process.env["SLACK_MCP_XOXP_TOKEN"] === undefined &&
    envVar("SLACK_MCP_XOXP_TOKEN") === undefined
  ) {
    return "no user credential (SLACK_MCP_XOXP_TOKEN) to post the marker";
  }
  return false;
}
