// Start the local daemon and Hub, provision a daemon-owned Bot, then connect a channel.
// The local manifest contains only restart metadata; the daemon owns identity and files.

import { hydrateBotReference, listDaemonBots, provisionDaemonBot } from "./daemon-bot.js";
import { ownerBootstrapEnvironment } from "./owner-bootstrap.js";
import { botRestartCommand } from "./start-output.js";
import {
  assertLocalOnboardingAccess,
  onboardingDaemonListen,
  recordedDaemonHost,
  verifyOnboardingDaemon,
  waitForOnboardingHub,
} from "./local-runtime.js";
import type { BotTemplateResult } from "@clisbot/protocol/bots/rpc-schemas";
type WorkspaceTemplateResult = BotTemplateResult & { directory: string; backupDirectory?: string };
import { connectOnboardingDaemon, isOnboardingEnabled } from "./onboarding-client.js";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { connectToDaemon } from "../../utils/client.js";
import type { CommandError } from "../../output/index.js";
import { resolveControlPlaneTarget, type ControlPlaneTarget } from "../control-plane.js";
import {
  addChannel,
  channelStatus,
  findChannelStatus,
  type ChannelAddInput,
  type ChannelAddResult,
  type ChannelStatusAccount,
} from "../channels/client.js";
import {
  readDaemonPasswordFile,
  readHubStateFile,
  resolveLocalHubState,
  startLocalHubDetached,
} from "../hub/local-hub.js";
import { resolveTcpHostFromListen, startLocalDaemonDetached } from "../daemon/local-daemon.js";
import { readDaemonInstance, daemonLogPath } from "@clisbot/server/daemon-control";
import { assertBotName, readBotManifest, writeBotManifest, type BotManifest } from "./manifest.js";
import {
  buildBotManifest,
  buildBotStartPlan,
  planUnchanged,
  type BotStartOptions,
  type BotStartPlan,
} from "./plan.js";
import { resolveTokenSecret } from "./token-input.js";

export interface BotStartInput {
  /** Commander's camelCase option bag for `bot start`. */
  options: BotStartOptions;
  /** The Clisbot home the daemon + Hub + manifest live under. */
  home: string;
  env: NodeJS.ProcessEnv;
}

export interface BotStartReport {
  botId?: string;
  name: string;
  reused: boolean;
  agentId: string;
  agentTitle: string;
  provider: string;
  model?: string;
  channel: "slack" | "telegram";
  account: string;
  workspacePath: string;
  workspaceId: string;
  credential: "persisted";
  hub: "started" | "already-running";
  /** The Hub's loopback URL (the one-screen state: hub port). */
  hubUrl: string;
  /** The Hub's recorded PID (the one-screen state: hub pid). */
  hubPid: string;
  daemon: "started" | "already-running";
  /** The daemon's listen target (the one-screen state: daemon port). */
  daemonHost: string;
  /** The account's transport after install (`started`/`deferred`/...), from the
   * Hub's channel status. */
  channelTransport?: string;
  nextStep: string;
  routeNote: string;
  ownerReady?: boolean;
  ownerLinkCommand?: string;
  ownerLinkExpiresAt?: string;
  ownerLinkRenewCommand?: string;
  template?: WorkspaceTemplateResult;
}

/** Every external boundary the orchestrator touches, injectable for tests. */
export interface BotStartDeps {
  ensureHubUp(
    home: string,
    env: NodeJS.ProcessEnv,
  ): Promise<{ hub: "started" | "already-running"; url: string }>;
  waitHubReady(url: string): Promise<void>;
  ensureDaemonUp(
    home: string,
    env: NodeJS.ProcessEnv,
  ): Promise<{ daemon: "started" | "already-running" }>;
  /** Wait until the daemon has recorded its pid file + listen (a just-spawned
   * daemon writes them shortly after boot). */
  waitDaemonUp(home: string): Promise<void>;
  daemonHost(
    home: string,
    env: NodeJS.ProcessEnv,
  ): Promise<string | undefined> | string | undefined;
  /** The daemon's WS-auth password from `<home>/.daemon-password` (a
   * password-protected local daemon otherwise rejects the CLI at the WS upgrade). */
  daemonPassword(home: string): string | undefined;
  openDaemon(host: string | undefined, password?: string): Promise<DaemonClient>;
  closeDaemon(client: DaemonClient): Promise<void>;
  prepareOnboarding(
    client: DaemonClient,
    ownerEmail?: string,
  ): Promise<{ daemonId: string; ownerEmail: string }>;
  provisionBot: typeof provisionDaemonBot;
  addChannel(input: ChannelAddInput): Promise<ChannelAddResult>;
  /** The running Hub's per-account channel status (the plane-boot verification). */
  channelStatus(): Promise<ChannelStatusAccount[]>;
  readManifest(home: string, name: string): Promise<BotManifest | null>;
  writeManifest(home: string, manifest: BotManifest): Promise<void>;
}

/** Run the full `bot start` flow. Pure of transport: all I/O is in `deps`. */
export async function runBotStart(
  input: BotStartInput,
  deps: BotStartDeps,
): Promise<BotStartReport> {
  const name = input.options.botName ?? `${input.options.botType ?? "personal"}-assistant`;
  assertBotName(name);
  let saved = await deps.readManifest(input.home, name);
  if (saved?.version === 2) {
    await deps.ensureDaemonUp(input.home, input.env);
    await deps.waitDaemonUp(input.home);
    const daemon = await deps.openDaemon(
      await deps.daemonHost(input.home, input.env),
      deps.daemonPassword(input.home),
    );
    try {
      const bot = (await listDaemonBots(daemon)).find((entry) => entry.id === saved?.botId);
      if (!bot) throw new Error("The saved Bot is missing or archived on this Host.");
      saved = hydrateBotReference(saved, bot);
    } finally {
      await deps.closeDaemon(daemon);
    }
  }
  const options = resumeBotOptions(input.options, saved);
  const plan = buildBotStartPlan(options, input.home);
  assertBotName(plan.name);

  const existing = saved;
  const reused = existing !== null && planUnchanged(existing, plan);

  input = { ...input, env: ownerBootstrapEnvironment(options, input.env) };
  const infrastructure = await ensureInfrastructure(input, deps);
  const client = await deps.openDaemon(
    await deps.daemonHost(input.home, input.env),
    deps.daemonPassword(input.home),
  );
  try {
    const ids = await resolveAssistantResources(client, deps, plan, existing, reused, input.env);
    const template = ids.template;
    // Keep the local assistant available even if Account setup or Channel installation needs a retry.
    await writeRecordedManifest(input.home, deps, plan, existing, ids);
    const onboarding = isOnboardingEnabled(input.env)
      ? await deps.prepareOnboarding(client, input.options.ownerEmail)
      : undefined;
    const installed = await installChannelAccount(
      deps,
      plan,
      onboarding
        ? channelSetup(
            plan,
            ids,
            onboarding,
            input.options.ownerIdentity,
            shouldUpdateRuntime(input.options, reused),
          )
        : undefined,
    );
    await recordInstalledConnection(input.home, deps, plan, installed, Boolean(onboarding));
    const channel = await verifyChannelInstalled(deps, plan);
    return withOnboardingStatus(
      {
        ...buildReport(plan, ids, reused, infrastructure, channel),
        ownerLinkRenewCommand: botRestartCommand(input.home, plan.name, onboarding?.ownerEmail),
      },
      installed,
      template,
    );
  } finally {
    await deps.closeDaemon(client);
  }
}

async function resolveAssistantResources(
  client: DaemonClient,
  deps: BotStartDeps,
  plan: BotStartPlan,
  existing: BotManifest | null,
  reused: boolean,
  env: NodeJS.ProcessEnv,
) {
  void reused;
  void env;
  return deps.provisionBot(client, plan, existing?.botId);
}

async function recordInstalledConnection(
  home: string,
  deps: BotStartDeps,
  plan: BotStartPlan,
  installed: ChannelAddResult,
  onboarding: boolean,
): Promise<void> {
  const recorded = await deps.readManifest(home, plan.name);
  if (!recorded)
    throw new Error("The onboarding checkpoint disappeared; rerun setup before proceeding.");
  await deps.writeManifest(home, {
    ...recorded,
    ...(installed.connectionId ? { connectionId: installed.connectionId } : {}),
    credentials: { [`${plan.channel}:${plan.account}`]: { persisted: true } },
    routeNote: onboarding
      ? "Member routes are configured for the seeded workspace"
      : recorded.routeNote,
  });
}

function resumeBotOptions(options: BotStartOptions, existing: BotManifest | null): BotStartOptions {
  if (!existing) return options;
  const supplied = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  );
  const resumed: BotStartOptions = {
    provider: existing.provider,
    model: existing.model,
    mode: existing.mode,
    botType: existing.botType,
    botName: existing.name,
    workspace: options.workspace ?? options.cwd ?? existing.sourcePath ?? existing.workspacePath,

    ...supplied,
  };
  if (
    !options.slackConnectionId &&
    !options.slackBotToken &&
    !options.telegramBotToken &&
    !options.telegramConnectionId &&
    existing.connectionId
  ) {
    if (existing.channel === "slack") {
      resumed.slackConnectionId = existing.connectionId;
      resumed.slackAccount = existing.account;
    } else {
      resumed.telegramConnectionId = existing.connectionId;
      resumed.telegramAccount = existing.account;
    }
  }
  return resumed;
}

function shouldUpdateRuntime(options: BotStartOptions, reused: boolean): boolean {
  return (
    !reused ||
    [
      options.provider,
      options.model,
      options.mode,
      options.workspace,
      options.cwd,
      options.newWorkspace,
    ].some((value) => value !== undefined)
  );
}

function channelSetup(
  plan: BotStartPlan,
  ids: { projectId: string; workspacePath: string },
  onboarding: { daemonId: string; ownerEmail: string },
  ownerIdentity?: string,
  update = false,
): import("../channels/client.js").ChannelSetupInput {
  return {
    name: plan.name,
    update,
    daemonId: onboarding.daemonId,
    projectId: ids.projectId,
    cwd: ids.workspacePath,
    provider: plan.provider,
    ...(plan.model ? { model: plan.model } : {}),
    ...(plan.mode ? { mode: plan.mode } : {}),
    ownerEmail: onboarding.ownerEmail,
    ...(ownerIdentity ? { ownerIdentity } : {}),
  };
}

function withOnboardingStatus(
  report: BotStartReport,
  installed: ChannelAddResult,
  template?: WorkspaceTemplateResult,
): BotStartReport {
  if (!template) return report;
  let nextStep = "Check bot status; the channel is not ready yet";
  if (installed.owner?.command)
    nextStep =
      "Send the owner linking command to this bot from your channel account, then send your request";
  if (installed.owner?.ready && report.channelTransport === "started")
    nextStep = buildNextStep(report.channel);
  return {
    ...report,
    template,
    nextStep,
    routeNote: "Member routes are configured for the seeded workspace",
    ownerReady: installed.owner?.ready === true,
    ...(installed.owner?.command ? { ownerLinkCommand: installed.owner.command } : {}),
    ...(installed.owner?.expiresAt ? { ownerLinkExpiresAt: installed.owner.expiresAt } : {}),
  };
}

/**
 * The brief's step 4: the channel plane is up when the installed account shows
 * in the Hub's channel status. A status that is still warming up (transport not
 * yet `started`) is reported as-is, never as a failure — the operator sees the
 * live transport on the one-screen state and can `bot status` it.
 */
async function verifyChannelInstalled(
  deps: BotStartDeps,
  plan: BotStartPlan,
): Promise<{ transport?: string } | undefined> {
  const accounts = await deps.channelStatus();
  return findChannelStatus(accounts, plan.channel, plan.account);
}

async function ensureInfrastructure(
  input: BotStartInput,
  deps: BotStartDeps,
): Promise<{
  hub: "started" | "already-running";
  hubPid: string;
  daemon: "started" | "already-running";
  url: string;
  daemonHost: string;
}> {
  const daemon = await deps.ensureDaemonUp(input.home, input.env);
  await deps.waitDaemonUp(input.home);
  const hub = await deps.ensureHubUp(input.home, input.env);
  await deps.waitHubReady(hub.url);
  const hubPid = String(resolveHubPid(input.home) ?? "-");
  return {
    hub: hub.hub,
    hubPid,
    daemon: daemon.daemon,
    url: hub.url,
    daemonHost: (await deps.daemonHost(input.home, input.env)) ?? "unknown",
  };
}

async function installChannelAccount(
  deps: BotStartDeps,
  plan: BotStartPlan,
  setup?: import("../channels/client.js").ChannelSetupInput,
): Promise<ChannelAddResult> {
  const credential = plan.credential;
  if ("connectionId" in credential) {
    const connection = {
      account: plan.account,
      connectionId: credential.connectionId,
      ...(setup ? { setup } : {}),
    };
    return deps.addChannel(
      credential.channel === "slack"
        ? { ...connection, channel: "slack" }
        : { ...connection, channel: "telegram" },
    );
  }
  return deps.addChannel({
    ...(credential.channel === "slack"
      ? slackChannelInput(credential, plan.account)
      : {
          channel: "telegram" as const,
          account: plan.account,
          botToken: resolveTokenSecret(credential.input),
        }),
    ...(setup ? { setup } : {}),
  });
}

function slackChannelInput(
  credential: Extract<BotStartPlan["credential"], { channel: "slack" }>,
  account: string,
): ChannelAddInput {
  if ("connectionId" in credential)
    return { channel: "slack", account, connectionId: credential.connectionId };
  return {
    channel: "slack",
    account,
    botToken: resolveTokenSecret(credential.botToken),
    appToken: resolveTokenSecret(credential.appToken),
  };
}

async function writeRecordedManifest(
  home: string,
  deps: BotStartDeps,
  plan: BotStartPlan,
  existing: BotManifest | null,
  ids: {
    botId?: string;
    agentId: string;
    agentTitle: string;
    workspacePath: string;
    workspaceId: string;
    projectId: string;
  },
): Promise<void> {
  const now = new Date();
  const manifest: BotManifest = {
    ...buildBotManifest(plan, { workspaceId: ids.workspaceId, agentId: ids.agentId }, now),
    version: 2,
    botId: ids.botId,
    workspacePath: ids.workspacePath,
    projectId: ids.projectId,
    createdAt: existing?.createdAt ?? now.toISOString(),
  };
  manifest.routeNote = plan.routeNote;
  manifest.credentials = existing?.credentials ?? {};
  if (
    existing?.connectionId &&
    existing.channel === plan.channel &&
    existing.account === plan.account
  )
    manifest.connectionId = existing.connectionId;
  await deps.writeManifest(home, manifest);
}

function buildReport(
  plan: BotStartPlan,
  ids: {
    botId?: string;
    agentId: string;
    agentTitle: string;
    workspacePath: string;
    workspaceId: string;
  },
  reused: boolean,
  infrastructure: {
    hub: "started" | "already-running";
    hubPid: string;
    daemon: "started" | "already-running";
    url: string;
    daemonHost: string;
  },
  channel: { transport?: string } | undefined,
): BotStartReport {
  return {
    name: plan.name,
    botId: ids.botId,
    reused,
    agentId: ids.agentId,
    agentTitle: ids.agentTitle,
    provider: plan.provider,
    ...(plan.model === undefined ? {} : { model: plan.model }),
    channel: plan.channel,
    account: plan.account,
    workspacePath: ids.workspacePath,
    workspaceId: ids.workspaceId,
    credential: "persisted",
    hub: infrastructure.hub,
    hubUrl: infrastructure.url,
    hubPid: infrastructure.hubPid,
    daemon: infrastructure.daemon,
    daemonHost: infrastructure.daemonHost,
    ...(channel?.transport !== undefined ? { channelTransport: channel.transport } : {}),
    nextStep: buildNextStep(plan.channel),
    routeNote: plan.routeNote,
  };
}

function buildNextStep(channel: "slack" | "telegram"): string {
  return channel === "slack"
    ? "DM the bot, or mention it in your Slack channel"
    : "DM the bot, or mention it in your Telegram group";
}

/** The real boundary implementations, wired to the shared home + env. */
export function createBotStartDeps(home: string, env: NodeJS.ProcessEnv): BotStartDeps {
  return {
    ensureHubUp: async (_home, childEnv) => {
      const state = resolveLocalHubState({ home }, env);
      if (state.running) {
        return { hub: "already-running", url: state.state?.url ?? "" };
      }
      const started = await startLocalHubDetached({ home }, undefined, childEnv);
      return { hub: "started", url: started.url };
    },
    waitHubReady: (url) => waitForOnboardingHub(url, home),
    ensureDaemonUp: async () => {
      if (isOnboardingEnabled(env)) await assertLocalOnboardingAccess(home, env);
      const state = await readDaemonInstance(home);
      if (state) return { daemon: "already-running" };
      const listen = isOnboardingEnabled(env) ? await onboardingDaemonListen(home, env) : undefined;
      await startLocalDaemonDetached({ home, ...(listen ? { listen } : {}) });
      return { daemon: "started" };
    },
    waitDaemonUp: () => waitDaemonUp(home),
    daemonHost: () => daemonHostFor(home),
    daemonPassword: () => readDaemonPasswordFile(home),
    openDaemon: (host, password) => openVerifiedDaemon(home, host, password),
    closeDaemon: (client) => client.close().catch(() => undefined),
    prepareOnboarding: (client, email) =>
      connectOnboardingDaemon(localControlPlaneTarget(home, env), client, email),
    provisionBot: provisionDaemonBot,
    addChannel: (input) => addChannel(localControlPlaneTarget(home, env), input),
    channelStatus: () => channelStatus(localControlPlaneTarget(home, env)),
    readManifest: (h, name) => readBotManifest(h, name),
    writeManifest: (h, manifest) => writeBotManifest(h, manifest),
  };
}

function localControlPlaneTarget(home: string, env: NodeJS.ProcessEnv): ControlPlaneTarget {
  return resolveControlPlaneTarget({ home }, env);
}

/** The Hub's recorded PID from `hub-local.json` (the one-screen state). */
function resolveHubPid(home: string): number | null {
  return readHubStateFile(home)?.pid ?? null;
}

async function daemonHostFor(home: string): Promise<string | undefined> {
  const listen = await recordedDaemonHost(home);
  const tcp = resolveTcpHostFromListen(listen);
  if (tcp !== null) return tcp;
  if (listen.startsWith("/") || listen.startsWith("unix://")) return listen;
  return undefined;
}

const DAEMON_READY_TIMEOUT_MS = 20_000;
const DAEMON_READY_POLL_MS = 250;

/**
 * Wait until a just-spawned daemon has written its pid file (which records the
 * listen target). Until then `daemonHostFor` would fall back to the config's
 * default listen, not the port the daemon actually bound. Bounded: an already
 * running daemon reports true immediately.
 */
async function waitDaemonUp(home: string): Promise<void> {
  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;
  while (true) {
    const state = await readDaemonInstance(home);
    if (state?.listen) return;
    if (Date.now() >= deadline) {
      throw {
        code: "DAEMON_NOT_READY",
        message: `The daemon did not record a ready listener. Check ${daemonLogPath(home)} for startup or port conflicts.`,
      } satisfies CommandError;
    }
    await sleep(DAEMON_READY_POLL_MS);
  }
}

/**
 * Connect to the daemon, retrying while a just-spawned daemon is still coming
 * up. `connectToDaemon` makes one attempt per host, so a cold daemon (started a
 * moment ago) would otherwise fail with `DAEMON_NOT_RUNNING` before it accepts
 * the first socket. `password` (the dev home's `.daemon-password`) authenticates
 * a password-protected local daemon at the WS upgrade.
 */
async function openVerifiedDaemon(home: string, host: string | undefined, password?: string) {
  const client = await openDaemonWithRetry(home, host, password);
  await verifyOnboardingDaemon(client, home);
  return client;
}

async function openDaemonWithRetry(
  home: string,
  host: string | undefined,
  password?: string,
): Promise<DaemonClient> {
  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;
  let lastError: unknown;
  const target = daemonHostWithPassword(host, password);
  for (;;) {
    try {
      return await connectToDaemon({
        target:
          target === undefined ? { kind: "instance", home } : { kind: "endpoint", host: target },
      });
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) break;
      await sleep(DAEMON_READY_POLL_MS);
    }
  }
  throw lastError;
}

/**
 * The `tcp://` URI form of a TCP daemon host, carrying the WS password as a
 * query param (the client's `resolveDaemonPassword` reads it back). IPC hosts
 * never carry a password: they are local unix sockets.
 */
function daemonHostWithPassword(host: string | undefined, password?: string): string | undefined {
  if (host === undefined || password === undefined) return host;
  if (host.startsWith("/") || host.startsWith("unix://") || host.startsWith("pipe://")) return host;
  const bare = host.startsWith("tcp://") ? host.slice("tcp://".length) : host;
  return `tcp://${bare}?password=${encodeURIComponent(password)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
