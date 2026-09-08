// Boots the real channel supervisor against simulated platforms.
//
// Everything is real except the two things a test cannot own: the chat platform
// (a `@getpaseo/channels-shared/sim` loopback server) and the daemon (a
// `FakeDaemon`). The database, the config revision, the installer markers, the
// loader, the verticals' built `dist/`, the ingress queue and the plane are the
// production objects.
//
// This is the tier `docs/lessons/2026-08-26-integration-seams-before-live-e2e.md`
// rule 2 asks for. `boot.integration.native.ts` is the same shape but needs the
// live dev home's Slack/Telegram credentials; this one needs none, so it runs
// in the normal hub vitest set.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  startSlackSim,
  startTelegramSim,
  type SimSlack,
  type SimTelegram,
} from "@getpaseo/channels-shared/sim";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { createDatabase } from "../db/pg.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import type { Database } from "../db/types.js";
import { createChannelSupervisor } from "../channels/supervisor/index.js";
import type { ChannelSupervisor, ChannelSupervisorOptions } from "../channels/supervisor/types.js";
import { enrollTestDaemon, TEST_DAEMON_SLUG } from "./project-configuration.js";
import { FakeDaemon } from "./fake-daemon.js";

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const PINS_PATH = join(REPO_ROOT, "packages", "hub", "channel-pins.json");

export const SIM_ORG_ID = "00000000-0000-4000-8000-0000000000aa";
export const SIM_ACCOUNT_ID = "work";
export const SIM_ENV_CWD = "/workspace/channel-sim";
export const SIM_SLACK_CHANNEL = "C_SIM_MAIN";
export const SIM_SLACK_SENDER = "U_SIM_HUMAN";
export const SIM_TELEGRAM_CHAT = -1_001_777_000;
export const SIM_TELEGRAM_SENDER = 900_001;

const SLACK_CONNECTION_ID = "00000000-0000-4000-8000-0000000000b1";
const TELEGRAM_CONNECTION_ID = "00000000-0000-4000-8000-0000000000b2";

export interface ChannelSimBootLog {
  level: string;
  message: string;
  meta: unknown;
}

export interface ChannelSimBoot {
  readonly slack: SimSlack;
  readonly telegram: SimTelegram;
  readonly daemon: FakeDaemon;
  readonly database: Database;
  readonly bundle: DatabaseRuntimeBundle;
  readonly dataDir: string;
  readonly logs: ChannelSimBootLog[];
  /** The live supervisor. Replaced by `restart()`, so read it, never cache it. */
  supervisor: ChannelSupervisor;
  /** Stops the supervisor and starts a fresh one on the same data dir + DB. */
  restart(): Promise<ChannelSupervisor>;
  /** Log lines whose message contains `needle`, for loud-failure assertions. */
  logsMatching(needle: string): readonly ChannelSimBootLog[];
  close(): Promise<void>;
}

export interface ChannelSimBootOptions {
  /** Extra YAML appended under the Slack account's `defaults:` block. */
  readonly slackDefaultsYaml?: string;
  readonly telegramDefaultsYaml?: string;
  /** `tool` drives replies through the channel_reply MCP capability. */
  readonly outboundPath?: "tool" | "relay";
}

const HUB_YAML = `
environments:
  work:
    kind: daemon
    daemon: ${TEST_DAEMON_SLUG}
    cwd: ${SIM_ENV_CWD}
agents:
  sim-agent:
    provider: codex
    model: gpt-5.6-luna
`;

const POLICY_YAML = `
enabled: true
channels:
  slack:
    enabled: true
  telegram:
    enabled: true
roles:
  ops:
    grants:
      - bot.interact
assignments:
  - identities:
      - slack:${SIM_SLACK_SENDER}
      - telegram:${SIM_TELEGRAM_SENDER}
    roles:
      - ops
`;

function indent(yaml: string | undefined, spaces: number): string {
  if (yaml === undefined || yaml.trim() === "") return "";
  const pad = " ".repeat(spaces);
  return `\n${yaml
    .trim()
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n")}`;
}

function slackAccountYaml(options: ChannelSimBootOptions): string {
  return `
channel: slack
accountId: ${SIM_ACCOUNT_ID}
connectionId: ${SLACK_CONNECTION_ID}
transport:
  mode: socket
defaults:
  outbound:
    path: ${options.outboundPath ?? "tool"}${indent(options.slackDefaultsYaml, 2)}
routes:
  # The streaming route (D-W4-03): a threaded mention relays its own answer and
  # streams it as a progress card, so the account's tool path never applies.
  - match:
      kind: thread
    agent: sim-agent
    environment: work
    outbound:
      path: relay
    sync:
      streaming:
        mode: progress
  - match:
      kind: channel
    agent: sim-agent
    environment: work
fallback:
  deny: true
`;
}

function telegramAccountYaml(apiRoot: string, options: ChannelSimBootOptions): string {
  return `
channel: telegram
accountId: ${SIM_ACCOUNT_ID}
connectionId: ${TELEGRAM_CONNECTION_ID}
transport:
  mode: polling
config:
  apiRoot: ${apiRoot}
defaults:
  outbound:
    path: ${options.outboundPath ?? "tool"}${indent(options.telegramDefaultsYaml, 2)}
routes:
  - match:
      kind: group
    agent: sim-agent
    environment: work
  # The streaming route (D-W4-03): a topic message relays its own answer and
  # drafts it in place (block mode), so the account's tool path never applies.
  - match:
      kind: topic
    agent: sim-agent
    environment: work
    outbound:
      path: relay
    sync:
      streaming:
        mode: block
fallback:
  deny: true
`;
}

interface ChannelPins {
  main: { package: string; version: string; dist: { integrity: string } };
  channels: Record<
    string,
    {
      loadMode: string;
      entry: string;
      inRepoPackage?: string;
      channel: { package: string; version: string; dist: { integrity: string; gitHead?: string } };
    }
  >;
}

/**
 * Pre-seeds the per-account install markers the way an in-repo
 * `ensureChannelInstalled` run records them, so boot skips straight to the load
 * of the workspace `dist/`. Requires `npm run build --workspace=…` for the
 * verticals; a stale `dist/` is the failure mode the 2026-08-26 lesson opens with.
 */
function seedInstallMarkers(dataDir: string, channels: readonly string[]): void {
  const pins = JSON.parse(readFileSync(PINS_PATH, "utf8")) as ChannelPins;
  const accountRoot = join(dataDir, "channels", SIM_ACCOUNT_ID);
  mkdirSync(accountRoot, { recursive: true });
  const main = {
    package: pins.main.package,
    version: pins.main.version,
    integrity: pins.main.dist.integrity,
  };
  for (const channel of channels) {
    const pin = pins.channels[channel];
    if (pin === undefined || pin.loadMode !== "in-repo") {
      throw new Error(`channel-pins.json must pull ${channel} in-repo (got ${pin?.loadMode})`);
    }
    const packageName = pin.inRepoPackage;
    if (packageName === undefined)
      throw new Error(`channel-pins.json: ${channel} has no inRepoPackage`);
    writeFileSync(
      join(accountRoot, `install-${channel}.lock`),
      `${JSON.stringify(
        {
          channel,
          accountId: SIM_ACCOUNT_ID,
          loadMode: pin.loadMode,
          main,
          channelPackage: {
            package: pin.channel.package,
            version: pin.channel.version,
            integrity: pin.channel.dist.integrity,
            ...(pin.channel.dist.gitHead === undefined
              ? {}
              : { gitHead: pin.channel.dist.gitHead }),
          },
          entry: pin.entry,
          inRepoPackageDir: inRepoPackageDir(packageName),
          installedAt: "2026-09-07T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  }
}

/** The workspace symlink, real-pathed the way the installer resolves it. */
function inRepoPackageDir(packageName: string): string {
  const linked = join(REPO_ROOT, "node_modules", packageName);
  if (!existsSync(linked)) throw new Error(`workspace package not linked: ${packageName}`);
  return realpathSync(linked);
}

export async function startChannelSimBoot(
  options: ChannelSimBootOptions = {},
): Promise<ChannelSimBoot> {
  const workDir = mkdtempSync(join(tmpdir(), "hub-channel-sim-"));
  const dataDir = join(workDir, "data");
  const dbDir = join(workDir, "db");
  const logs: ChannelSimBootLog[] = [];

  const slack = await startSlackSim();
  const telegram = await startTelegramSim({ maxHoldMs: 120 });
  const daemon = new FakeDaemon();
  await daemon.listen();

  // The Slack SDKs read this from the ambient process env, not from the
  // supervisor's env copy, because the vertical runs in this process.
  const previousSlackApiUrl = process.env["SLACK_API_URL"];
  process.env["SLACK_API_URL"] = slack.apiUrl;

  seedInstallMarkers(dataDir, ["slack", "telegram"]);

  const bundle = await embeddedDatabaseRuntime(dbDir);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    "insert into organization (id, name, slug) values ($1, 'Sim Org', 'sim-org')",
    [SIM_ORG_ID],
  );
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await enrollTestDaemon(database, SIM_ORG_ID);
  await database.saveChannelConfiguration({
    organizationId: SIM_ORG_ID,
    files: [
      { path: ".paseo/hub.yml", content: HUB_YAML },
      { path: ".paseo/channels/policy.yml", content: POLICY_YAML },
      { path: `.paseo/channels/slack/${SIM_ACCOUNT_ID}.yml`, content: slackAccountYaml(options) },
      {
        path: `.paseo/channels/telegram/${SIM_ACCOUNT_ID}.yml`,
        content: telegramAccountYaml(telegram.apiRoot, options),
      },
    ],
    contentHash: `sim-${Date.now()}`,
    createdByUserId: null,
  });

  const env = { ...process.env } as NodeJS.ProcessEnv;
  delete env["PASEO_PASSWORD"];
  env["PASEO_HUB_CHANNELS_ENABLED"] = "1";

  const supervisorOptions: ChannelSupervisorOptions = {
    database,
    databaseRuntime: bundle.runtime,
    dataDir,
    pinsPath: PINS_PATH,
    daemon: { host: daemon.host },
    env,
    resolveConnection: ({ channel }) =>
      Promise.resolve(
        channel === "slack"
          ? { botToken: slack.botToken, appToken: slack.appToken }
          : { botToken: telegram.token },
      ),
    logger: {
      info: (message, meta) => logs.push({ level: "info", message, meta }),
      warn: (message, meta) => logs.push({ level: "warn", message, meta }),
      error: (message, meta) => logs.push({ level: "error", message, meta }),
    },
  };

  const boot: ChannelSimBoot = {
    slack,
    telegram,
    daemon,
    database,
    bundle,
    dataDir,
    logs,
    supervisor: createChannelSupervisor(supervisorOptions),
    async restart() {
      await boot.supervisor.stopAll();
      boot.supervisor = createChannelSupervisor(supervisorOptions);
      await startAccountsSettled(boot);
      return boot.supervisor;
    },
    logsMatching: (needle) => logs.filter((entry) => entry.message.includes(needle)),
    async close() {
      await boot.supervisor.stopAll().catch(() => undefined);
      await slack.close();
      await telegram.close();
      await daemon.close();
      await bundle.runtime.close();
      if (previousSlackApiUrl === undefined) delete process.env["SLACK_API_URL"];
      else process.env["SLACK_API_URL"] = previousSlackApiUrl;
      rmSync(workDir, { recursive: true, force: true });
    },
  };
  await startAccountsSettled(boot);
  return boot;
}

/**
 * Boots every configured account through the production entry point
 * (`startAll`) and waits until both transports are live on the platforms.
 *
 * `startAll` starts the accounts back to back, and each vertical finishes
 * importing its SDK (Bolt, grammY) after `startAccount` resolves. Those late
 * modules used to land in the NEXT account's load-trace window and fail it;
 * the loader now attributes a module to the account whose import graph pulled
 * it in (`loader/hooks.ts`), so the real entry point is what the harness
 * drives.
 */
async function startAccountsSettled(boot: ChannelSimBoot): Promise<void> {
  await boot.supervisor.startAll();
  try {
    await boot.telegram.waitForPoll(20_000);
    await boot.slack.waitForSocket(20_000);
  } catch (error) {
    // A transport that never reached its platform is an account that failed to
    // start: report what the supervisor says and what it logged, never the bare
    // sim timeout (2026-08-26 lesson rule 3).
    const logged = boot.logs
      .map((entry) => `${entry.level} ${entry.message} ${JSON.stringify(entry.meta)}`)
      .join(" | ");
    throw new Error(
      `channel account did not reach its platform\nstatus: ${JSON.stringify(
        boot.supervisor.status(),
      )}\nlogs: ${logged}`,
      { cause: error },
    );
  }
}
