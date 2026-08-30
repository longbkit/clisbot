// COMPAT(clisbot-bot): `bot start` orchestration (implementation doc §2.1).
// The one-line bootstrap: ensure the daemon + embedded Hub are up, then create the
// bot composite (workspace + idle agent + channel account) and tie their ids
// together in the bot manifest. Every external boundary (lifecycle, daemon socket,
// control-plane HTTP, disk) is a `BotStartDeps` function so the orchestration is
// testable with fakes; `createBotStartDeps` wires the real implementations.

import { mkdir } from "node:fs/promises";
import { BUILTIN_PROVIDER_IDS } from "@getpaseo/protocol/provider-manifest";
import type {
  AgentSnapshotPayload,
  WorkspaceCreateRequest,
  WorkspaceCreateResponse,
} from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
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
import {
  resolveLocalDaemonState,
  resolveTcpHostFromListen,
  startLocalDaemonDetached,
} from "../daemon/local-daemon.js";
import { assertBotName, readBotManifest, writeBotManifest, type BotManifest } from "./manifest.js";
import {
  buildBotManifest,
  buildBotStartPlan,
  planUnchanged,
  type BotStartOptions,
  type BotStartPlan,
} from "./plan.js";
import { resolveTokenSecret, persistBotCredential, type BotChannelSecret } from "./token-input.js";

export interface BotStartInput {
  /** Commander's camelCase option bag for `bot start`. */
  options: BotStartOptions;
  /** The Clisbot home the daemon + Hub + manifest live under. */
  home: string;
  env: NodeJS.ProcessEnv;
}

export interface BotStartReport {
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
  credential: "persisted" | "runtime-only";
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
  daemonHost(home: string, env: NodeJS.ProcessEnv): string | undefined;
  /** The daemon's WS-auth password from `<home>/.daemon-password` (a
   * password-protected local daemon otherwise rejects the CLI at the WS upgrade). */
  daemonPassword(home: string): string | undefined;
  openDaemon(host: string | undefined, password?: string): Promise<DaemonClient>;
  closeDaemon(client: DaemonClient): Promise<void>;
  providerKnown(client: DaemonClient, provider: string): Promise<boolean>;
  createWorkspace(
    client: DaemonClient,
    source: BotWorkspaceSource,
    title?: string,
  ): Promise<{ id: string; directory?: string }>;
  createIdleAgent(client: DaemonClient, options: BotAgentCreateOptions): Promise<{ id: string }>;
  /** Create the bot's workspace directory on disk (a `directory` source must exist). */
  ensureWorkspaceDir(path: string): Promise<void>;
  addChannel(input: ChannelAddInput): Promise<ChannelAddResult>;
  /** The running Hub's per-account channel status (the plane-boot verification). */
  channelStatus(): Promise<ChannelStatusAccount[]>;
  persistCredential(home: string, plan: BotStartPlan): string;
  readManifest(home: string, name: string): Promise<BotManifest | null>;
  writeManifest(home: string, manifest: BotManifest): Promise<void>;
}

/** The daemon workspace source a bot is created in (directory or worktree). */
export type BotWorkspaceSource = WorkspaceCreateRequest["source"];

export interface BotAgentCreateOptions {
  provider: string;
  model?: string;
  modeId?: string;
  cwd: string;
  workspaceId: string;
  title: string;
}

/** Run the full `bot start` flow. Pure of transport: all I/O is in `deps`. */
export async function runBotStart(
  input: BotStartInput,
  deps: BotStartDeps,
): Promise<BotStartReport> {
  const plan = buildBotStartPlan(input.options, input.home);
  assertBotName(plan.name);

  const existing = await deps.readManifest(input.home, plan.name);
  const reused = existing !== null && planUnchanged(existing, plan);

  const infrastructure = await ensureInfrastructure(input, deps);
  const persistPath = plan.persist ? deps.persistCredential(input.home, plan) : undefined;
  const secret = assembleChannelSecret(plan);

  let ids: { agentId: string; agentTitle: string; workspacePath: string; workspaceId: string };
  if (reused && existing !== null) {
    // Same flags as the recorded bot: keep the existing workspace + agent, but
    // re-install the channel account so the transport is live after a Hub restart.
    ids = {
      agentId: existing.agentId,
      agentTitle: existing.agentTitle,
      workspacePath: existing.workspacePath,
      workspaceId: existing.workspaceId,
    };
    await installChannelAccount(deps, plan, secret);
  } else {
    ids = await createBotBundle(input, deps, plan, secret);
  }

  await writeRecordedManifest(input.home, deps, plan, existing, ids, persistPath);
  const channel = await verifyChannelInstalled(deps, plan);
  return buildReport(plan, ids, reused, infrastructure, persistPath, channel);
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
  const hub = await deps.ensureHubUp(input.home, input.env);
  await deps.waitHubReady(hub.url);
  const hubPid = String(resolveHubPid(input.home) ?? "-");
  const daemon = await deps.ensureDaemonUp(input.home, input.env);
  await deps.waitDaemonUp(input.home);
  return {
    hub: hub.hub,
    hubPid,
    daemon: daemon.daemon,
    url: hub.url,
    daemonHost: daemonHostFor(input.home) ?? "unknown",
  };
}

async function createBotBundle(
  input: BotStartInput,
  deps: BotStartDeps,
  plan: BotStartPlan,
  secret: string,
): Promise<{ agentId: string; agentTitle: string; workspacePath: string; workspaceId: string }> {
  const host = deps.daemonHost(input.home, input.env);
  const client = await deps.openDaemon(host, deps.daemonPassword(input.home));
  try {
    if (!(await deps.providerKnown(client, plan.provider))) {
      throw unknownProviderError(plan.provider, input.home);
    }
    // A `directory` workspace source must exist on disk (the daemon rejects a
    // missing path with `directory_not_found`), so create it before requesting.
    if (plan.isolation !== "worktree") await deps.ensureWorkspaceDir(plan.workspacePath);
    const workspace = await deps.createWorkspace(client, buildBotWorkspaceSource(plan), plan.name);
    const agent = await deps.createIdleAgent(client, {
      provider: plan.provider,
      ...(plan.model === undefined ? {} : { model: plan.model }),
      ...(plan.mode === undefined ? {} : { modeId: plan.mode }),
      cwd: workspace.directory ?? plan.workspacePath,
      workspaceId: workspace.id,
      title: plan.agentTitle,
    });
    await installChannelAccount(deps, plan, secret);
    return {
      agentId: agent.id,
      agentTitle: plan.agentTitle,
      workspacePath: plan.workspacePath,
      workspaceId: workspace.id,
    };
  } finally {
    await deps.closeDaemon(client);
  }
}

/** Add the channel account, translating the cold-instance 409 into a `hub init` pointer. */
async function installChannelAccount(
  deps: BotStartDeps,
  plan: BotStartPlan,
  secret: string,
): Promise<void> {
  try {
    await deps.addChannel({ channel: plan.channel, account: plan.account, secret });
  } catch (error) {
    if (isNoActiveConfiguration(error)) {
      const commandError: CommandError = {
        code: "NO_ACTIVE_CONFIGURATION",
        message:
          "The Hub has no active configuration, so the channel account cannot be installed. " +
          "Run `clisbot hub init` to create and deploy the starter configuration, then re-run this command.",
      };
      throw commandError;
    }
    throw error;
  }
}

async function writeRecordedManifest(
  home: string,
  deps: BotStartDeps,
  plan: BotStartPlan,
  existing: BotManifest | null,
  ids: { agentId: string; agentTitle: string; workspacePath: string; workspaceId: string },
  persistPath: string | undefined,
): Promise<void> {
  const now = new Date();
  const credentialKey = `${plan.channel}:${plan.account}`;
  const manifest: BotManifest =
    existing === null
      ? buildBotManifest(plan, { workspaceId: ids.workspaceId, agentId: ids.agentId }, now)
      : { ...existing, updatedAt: now.toISOString() };
  manifest.routeNote = plan.routeNote;
  manifest.credentials[credentialKey] = {
    persisted: plan.persist,
    ...(persistPath === undefined ? {} : { secretPath: persistPath }),
  };
  await deps.writeManifest(home, manifest);
}

function buildReport(
  plan: BotStartPlan,
  ids: { agentId: string; agentTitle: string; workspacePath: string; workspaceId: string },
  reused: boolean,
  infrastructure: {
    hub: "started" | "already-running";
    hubPid: string;
    daemon: "started" | "already-running";
    url: string;
    daemonHost: string;
  },
  persistPath: string | undefined,
  channel: { transport?: string } | undefined,
): BotStartReport {
  return {
    name: plan.name,
    reused,
    agentId: ids.agentId,
    agentTitle: ids.agentTitle,
    provider: plan.provider,
    ...(plan.model === undefined ? {} : { model: plan.model }),
    channel: plan.channel,
    account: plan.account,
    workspacePath: ids.workspacePath,
    workspaceId: ids.workspaceId,
    credential: persistPath === undefined ? "runtime-only" : "persisted",
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

/** The Slack/Telegram `secret` the Hub mirrors: a JSON document the supervisor reads. */
export function assembleChannelSecret(plan: BotStartPlan): string {
  const botToken = resolveTokenSecret(plan.credential.input);
  if (plan.channel === "slack") {
    const appToken = plan.credential.secondary
      ? resolveTokenSecret(plan.credential.secondary)
      : undefined;
    return JSON.stringify({ botToken, ...(appToken === undefined ? {} : { appToken }) });
  }
  return JSON.stringify({ botToken });
}

/** Persist a `--persist`-ed credential to a 0600 file; returns its path. */
export function persistBotCredentialFile(home: string, plan: BotStartPlan): string {
  const botToken = resolveTokenSecret(plan.credential.input);
  const secret: BotChannelSecret =
    plan.channel === "slack"
      ? {
          botToken,
          ...(plan.credential.secondary
            ? { appToken: resolveTokenSecret(plan.credential.secondary) }
            : {}),
        }
      : { token: botToken };
  return persistBotCredential(home, plan.channel, plan.account, secret);
}

function buildBotWorkspaceSource(plan: BotStartPlan): BotWorkspaceSource {
  if (plan.isolation === "worktree") {
    return { kind: "worktree", cwd: plan.workspacePath };
  }
  return { kind: "directory", path: plan.workspacePath };
}

function buildNextStep(channel: "slack" | "telegram"): string {
  return channel === "slack"
    ? "mention the bot in your Slack channel"
    : "message the bot in its Telegram group";
}

function unknownProviderError(provider: string, home: string): CommandError {
  const builtins = BUILTIN_PROVIDER_IDS.join(", ");
  return {
    code: "UNKNOWN_PROVIDER",
    message: `Provider "${provider}" is not registered on the daemon.`,
    details:
      `Built-in providers are: ${builtins}. To add a custom ACP provider, register it in ` +
      `${home}/config.json under "agents.providers", for example:\n\n` +
      `{\n  "agents": {\n    "providers": {\n` +
      `      "${provider}": { "extends": "acp", "command": ["<binary>", "<acp-subcommand>"] }\n` +
      `    }\n  }\n}\n\n` +
      "See docs/custom-providers.md for the full shape.",
  };
}

/**
 * True when a Hub error is the cold-instance 409 from `loadChannelControlPlane`
 * (no active configuration). It surfaces two ways: a conforming problem body
 * ("Control plane unavailable: the default project has no active configuration")
 * or a plain "… with HTTP 409."
 */
export function isNoActiveConfiguration(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== "HUB_REQUEST_FAILED") return false;
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return (
    /no active configuration/i.test(message) ||
    /no_active_configuration/.test(message) ||
    /HTTP 409/.test(message)
  );
}

/** The real boundary implementations, wired to the shared home + env. */
export function createBotStartDeps(home: string, env: NodeJS.ProcessEnv): BotStartDeps {
  return {
    ensureHubUp: async () => {
      const state = resolveLocalHubState({ home }, env);
      if (state.running) {
        return { hub: "already-running", url: state.state?.url ?? "" };
      }
      const started = await startLocalHubDetached({ home });
      return { hub: "started", url: started.url };
    },
    waitHubReady: (url) => waitHubReady(url),
    ensureDaemonUp: async () => {
      const state = resolveLocalDaemonState({ home });
      if (state.running) return { daemon: "already-running" };
      await startLocalDaemonDetached({ home });
      return { daemon: "started" };
    },
    waitDaemonUp: () => waitDaemonUp(home),
    daemonHost: () => daemonHostFor(home),
    daemonPassword: () => readDaemonPasswordFile(home),
    openDaemon: (host, password) => openDaemonWithRetry(host, password),
    closeDaemon: (client) => client.close().catch(() => undefined),
    providerKnown: async (client, provider) => {
      const known = new Set<string>(BUILTIN_PROVIDER_IDS);
      try {
        const snapshot = await client.getProvidersSnapshot();
        for (const entry of snapshot.entries) known.add(entry.provider);
      } catch {
        // Snapshot unavailable — fall back to the built-in set only.
      }
      return known.has(provider);
    },
    createWorkspace: async (client, source, title) => {
      const payload: WorkspaceCreateResponse["payload"] = await client.createWorkspace({
        source: source as Parameters<DaemonClient["createWorkspace"]>[0]["source"],
        ...(title === undefined ? {} : { title }),
      });
      if (!payload.workspace) {
        throw {
          code: "WORKSPACE_CREATE_FAILED",
          message: payload.error ?? "Workspace creation failed",
        } satisfies CommandError;
      }
      return { id: payload.workspace.id, directory: payload.workspace.workspaceDirectory };
    },
    createIdleAgent: async (client, options) => {
      const agent: AgentSnapshotPayload = await client.createAgent({
        provider: options.provider,
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.modeId === undefined ? {} : { modeId: options.modeId }),
        cwd: options.cwd,
        workspaceId: options.workspaceId,
        title: options.title,
      });
      return { id: agent.id };
    },
    ensureWorkspaceDir: async (workspacePath) => {
      await mkdir(workspacePath, { recursive: true });
    },
    addChannel: (input) => addChannel(localControlPlaneTarget(home, env), input),
    channelStatus: () => channelStatus(localControlPlaneTarget(home, env)),
    persistCredential: (h, plan) => persistBotCredentialFile(h, plan),
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

function daemonHostFor(home: string): string | undefined {
  const listen = resolveLocalDaemonState({ home }).listen;
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
    if (resolveLocalDaemonState({ home }).running) return;
    if (Date.now() >= deadline) {
      throw {
        code: "DAEMON_NOT_READY",
        message: "The daemon started but did not record its pid file in time.",
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
async function openDaemonWithRetry(
  host: string | undefined,
  password?: string,
): Promise<DaemonClient> {
  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;
  let lastError: unknown;
  const target = daemonHostWithPassword(host, password);
  for (;;) {
    try {
      return await connectToDaemon(target === undefined ? undefined : { host: target });
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

const HUB_READY_TIMEOUT_MS = 20_000;
const HUB_READY_POLL_MS = 250;

/** Poll the embedded Hub's /health until it accepts requests (bounded). */
async function waitHubReady(url: string): Promise<void> {
  if (url.length === 0) return;
  const deadline = Date.now() + HUB_READY_TIMEOUT_MS;
  while (true) {
    if (await hubHealthOk(url)) return;
    if (Date.now() >= deadline) {
      throw {
        code: "HUB_NOT_READY",
        message: "The Hub started but did not become ready in time.",
      } satisfies CommandError;
    }
    await sleep(HUB_READY_POLL_MS);
  }
}

async function hubHealthOk(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
