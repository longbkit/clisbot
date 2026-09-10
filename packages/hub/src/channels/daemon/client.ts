import { TrustedDaemonClient } from "./ws-client.js";
import { discoverLocalDaemon, type DaemonDiscoveryResult } from "./discovery.js";
import type {
  AgentPermissionResponse,
  AgentSnapshot,
  CreateAgentConfig,
  CreateAgentOptions,
  DaemonServerInfo,
  ProviderModel,
  ProviderMode,
  AgentProfile,
  AgentCommand,
  AgentConfigApply,
  TextAttachment,
} from "./types.js";

// The channel control plane's one code path to a daemon, for both forms
// (plan §14.7): the embedded form connects over loopback; the team/remote form
// pairs over the relay with the same ordinary-client wire. Everything here is an
// existing trusted-client RPC — no new schema, no enrollment.

export interface ChannelDaemonClientOptions {
  /** The daemon target host:port. Loopback form. */
  host?: string;
  /** The daemon home (pid lock lookup root). Loopback form. */
  home?: string;
  /** An explicit trusted-client URL (relay-paired leg). */
  url?: string;
  /** The daemon password (carried as the `paseo.bearer.` WS subprotocol).
   * The supervisor defaults this from the `PASEO_PASSWORD` env var. */
  password?: string;
  clientId?: string;
  /** Mint the managed-access `accessTicket` for this account's `hello`, called
   * per (re)connect. Returns `undefined` when the daemon is not in `external`
   * mode (trusted session, as today). Built by
   * `createChannelAccessTicketResolver`; absent → never ticketed. */
  resolveAccessTicket?: () => Promise<string | undefined>;
  rpcTimeoutMs?: number;
  /** Agent stream frames (`agent_stream`): one event per attached agent. */
  onStream?: (payload: { agentId: string; event: unknown; seq?: number }) => void;
  /** Agent snapshot updates (`agent_update`). */
  onAgentUpdate?: (agent: unknown) => void;
  /** Subagent wire frames (`agent.provider_subagents.update`), the
   * `provider_subagents`-gated child descriptors + timeline. */
  onSubagentUpdate?: (frame: unknown) => void;
  /** Observe the trusted session's state. `disconnected` includes an explicit
   * stop; the reconnect loop re-fires `connected` on recovery. */
  onStateChange?: (state: "connected" | "disconnected") => void;
}

export interface CreateAgentResult {
  agentId: string;
  agent: AgentSnapshot;
}

export interface DaemonConnection {
  discovery: DaemonDiscoveryResult;
  /** Resolves when the trusted session is established (daemon `server_info` seen). */
  waitForConnected(timeoutMs?: number): Promise<void>;
  createAgent(config: CreateAgentConfig, options?: CreateAgentOptions): Promise<CreateAgentResult>;
  sendAgentMessage(
    agentId: string,
    text: string,
    options?: { steer?: boolean; attachments?: TextAttachment[] },
  ): Promise<void>;
  /** Interrupt the active turn without creating a replacement turn. */
  cancelAgent(agentId: string): Promise<void>;
  respondToAgentPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void>;
  listAgents(): Promise<AgentSnapshot[]>;
  isAgentInProject(agent: AgentSnapshot, projectId: string): Promise<boolean>;
  getServerInfo(): DaemonServerInfo | undefined;
  listAvailableProviders(): Promise<{ provider: string; available: boolean }[]>;
  listProviderModels(provider: string, cwd?: string): Promise<ProviderModel[]>;
  listProviderModes(provider: string, cwd?: string): Promise<ProviderMode[]>;
  listAgentProfiles(): Promise<AgentProfile[]>;
  listCommands(agentId: string): Promise<AgentCommand[]>;
  setAgentModel(agentId: string, modelId: string | null): Promise<void>;
  setAgentThinkingOption(agentId: string, thinkingOptionId: string | null): Promise<void>;
  setAgentMode(agentId: string, modeId: string): Promise<void>;
  applyAgentConfig(agentId: string, config: AgentConfigApply): Promise<void>;
  buildAgentForkContext(
    agentId: string,
  ): Promise<{ attachment: TextAttachment | null; itemCount: number }>;

  setTimelineSubscription(agentIds: readonly string[]): Promise<void>;
  /** Stop the socket. In-flight RPCs reject; streams stop. */
  stop(): void;
}

/**
 * Open one trusted-client connection to a daemon. The `url` option serves the
 * relay-paired team/remote leg; otherwise the loopback target is discovered from
 * the pid lock / default port.
 */
export function connectChannelDaemon(options: ChannelDaemonClientOptions = {}): DaemonConnection {
  const discovery: DaemonDiscoveryResult =
    options.url !== undefined
      ? { url: options.url, source: "env" }
      : discoverLocalDaemon({ host: options.host, home: options.home });
  const socket = new TrustedDaemonClient({
    url: discovery.url,
    ...(options.password !== undefined ? { password: options.password } : {}),
    ...(options.clientId !== undefined ? { clientId: options.clientId } : {}),
    ...(options.resolveAccessTicket !== undefined
      ? { resolveAccessTicket: options.resolveAccessTicket }
      : {}),
    ...(options.rpcTimeoutMs !== undefined ? { rpcTimeoutMs: options.rpcTimeoutMs } : {}),
    ...(options.onStream !== undefined ? { onStream: options.onStream } : {}),
    ...(options.onAgentUpdate !== undefined
      ? {
          onAgentUpdate: (value: unknown) => {
            const agent = normalizeAgentSnapshot(value);
            if (agent !== undefined) options.onAgentUpdate?.(agent);
          },
        }
      : {}),
    ...(options.onSubagentUpdate !== undefined
      ? { onSubagentUpdate: options.onSubagentUpdate }
      : {}),
    ...(options.onStateChange !== undefined ? { onStateChange: options.onStateChange } : {}),
  });
  socket.connect();
  return createFacade(socket, discovery);
}

function createFacade(
  socket: TrustedDaemonClient,
  discovery: DaemonDiscoveryResult,
): DaemonConnection {
  return {
    discovery,
    waitForConnected: (timeoutMs) => socket.waitForConnected(timeoutMs),
    createAgent: (config, options) =>
      socket
        .call("create_agent_request", createAgentPayload(config, options))
        .then(mapCreatedAgent),
    sendAgentMessage: (agentId, text, options) =>
      socket
        .call("send_agent_message_request", {
          agentId,
          text,
          ...(options?.attachments === undefined ? {} : { attachments: options.attachments }),
          activeTurnBehavior: options?.steer === false ? "interrupt" : "steer",
        })
        .then((payload) => {
          const p = asRecord(payload);
          if (p !== undefined && p["accepted"] === false) {
            throw new Error((p["error"] as string | undefined) ?? "agent message rejected");
          }
          return undefined;
        }),
    cancelAgent: (agentId) =>
      socket.call("cancel_agent_request", { agentId }).then((payload) => {
        const p = asRecord(payload);
        if (p !== undefined && typeof p["error"] === "string" && p["error"] !== "") {
          throw new Error(p["error"]);
        }
        return undefined;
      }),
    respondToAgentPermission: (agentId, requestId, response) =>
      // Fire-and-forget on the daemon (no correlated reply; the resolution
      // arrives on the agent's stream as permission_resolved). Resolves once
      // the frame is written to the socket.
      socket.send({
        type: "agent_permission_response",
        agentId,
        requestId,
        response,
      }),
    listAgents: () =>
      socket.call("fetch_agents_request", {}).then((payload) => {
        const p = asRecord(payload);
        const entries = Array.isArray(p?.["entries"]) ? p["entries"] : [];
        return entries
          .map((entry) => normalizeAgentSnapshot(asRecord(entry)?.["agent"]))
          .filter((agent): agent is AgentSnapshot => agent !== undefined);
      }),
    isAgentInProject: (agent, projectId) => isAgentInProject(socket, agent, projectId),
    getServerInfo: () => socket.serverInfo as DaemonServerInfo | undefined,
    listAvailableProviders: () =>
      listField(socket, "list_available_providers_request", {}, "providers"),
    listProviderModels: (provider, cwd) =>
      listField(socket, "list_provider_models_request", { provider, cwd }, "models"),
    listProviderModes: (provider, cwd) =>
      listField(socket, "list_provider_modes_request", { provider, cwd }, "modes"),
    listAgentProfiles: async () => {
      const payload = checkedPayload(await socket.call("get_daemon_config_request", {}));
      const config = asRecord(payload["config"]);
      return Array.isArray(config?.["agentProfiles"])
        ? (config["agentProfiles"] as AgentProfile[])
        : [];
    },
    listCommands: (agentId) => listField(socket, "list_commands_request", { agentId }, "commands"),
    setAgentModel: (agentId, modelId) =>
      mutate(socket, "set_agent_model_request", { agentId, modelId }),
    setAgentThinkingOption: (agentId, thinkingOptionId) =>
      mutate(socket, "set_agent_thinking_request", { agentId, thinkingOptionId }),
    setAgentMode: (agentId, modeId) =>
      mutate(socket, "set_agent_mode_request", { agentId, modeId }),
    applyAgentConfig: (agentId, config) =>
      mutate(socket, "agent.config.apply.request", { agentId, config }),
    buildAgentForkContext: async (agentId) => {
      if (
        socket.serverInfo?.["features"] === undefined ||
        asRecord(socket.serverInfo["features"])?.["agentForkContext"] !== true
      ) {
        throw new Error("This daemon does not support agent fork context.");
      }
      const payload = checkedPayload(await socket.call("agent.fork_context.request", { agentId }));
      const attachment = payload["attachment"];
      if (
        attachment !== null &&
        (asRecord(attachment)?.["type"] !== "text" ||
          typeof asRecord(attachment)?.["text"] !== "string")
      )
        throw new Error("Invalid fork context attachment.");
      return {
        attachment: attachment as TextAttachment | null,
        itemCount: Number(payload["itemCount"]),
      };
    },
    setTimelineSubscription: (agentIds) =>
      socket
        .call("agent.timeline.set_subscription.request", {
          agentIds: [...agentIds],
        })
        .then(() => undefined),
    stop: () => socket.stop(),
  };
}

function mapCreatedAgent(payload: unknown): CreateAgentResult {
  const p = asRecord(payload);
  const agent = normalizeAgentSnapshot(p?.["agent"]);
  if (agent === undefined) {
    throw new Error("daemon did not report the created agent");
  }
  return { agentId: agent.id, agent };
}

function withTitle(config: CreateAgentConfig, title?: string): CreateAgentConfig {
  if (title === undefined) return config;
  return { ...config, title };
}

function createAgentPayload(config: CreateAgentConfig, options?: CreateAgentOptions) {
  const { projectId, worktree, ...sessionConfig } = config;
  return {
    config: withTitle(sessionConfig, options?.title),
    ...(options?.initialPrompt === undefined ? {} : { initialPrompt: options.initialPrompt }),
    ...(options?.attachments === undefined ? {} : { attachments: options.attachments }),
    ...(options?.autoArchive === undefined ? {} : { autoArchive: options.autoArchive }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(worktree === undefined ? {} : { worktree }),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** Normalize the existing wire snapshot once, for create, list, and push updates. */
function normalizeAgentSnapshot(value: unknown): AgentSnapshot | undefined {
  const source = asRecord(value);
  if (typeof source?.["id"] !== "string") return undefined;
  const agent = { ...source } as unknown as AgentSnapshot;
  const mode = "currentModeId" in source ? source["currentModeId"] : source["modeId"];
  const thinking =
    "effectiveThinkingOptionId" in source
      ? source["effectiveThinkingOptionId"]
      : source["thinkingOptionId"];
  delete agent.modeId;
  delete agent.model;
  delete agent.thinkingOptionId;
  if (typeof mode === "string") agent.modeId = mode;
  if (typeof source["model"] === "string") agent.model = source["model"];
  if (typeof thinking === "string") agent.thinkingOptionId = thinking;
  if (Array.isArray(source["features"])) {
    agent.featureValues = Object.fromEntries(
      source["features"].flatMap((entry: unknown) => {
        const feature = asRecord(entry);
        return typeof feature?.["id"] === "string" && "value" in feature
          ? [[feature["id"], feature["value"]]]
          : [];
      }),
    );
  }
  const usage = asRecord(source["lastUsage"]);
  for (const key of ["contextWindowUsedTokens", "contextWindowMaxTokens"] as const) {
    const tokens = usage?.[key] ?? source[key];
    if (typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0) agent[key] = tokens;
    else delete agent[key];
  }
  return agent;
}

/** Workspace descriptors, not cwd or a synthetic snapshot projectId, prove Project membership. */
async function isAgentInProject(
  socket: TrustedDaemonClient,
  agent: AgentSnapshot,
  projectId: string,
): Promise<boolean> {
  if (!agent.workspaceId) return false;
  const cursors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const payload = checkedPayload(
      await socket.call("fetch_workspaces_request", {
        filter: { projectId },
        page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
      }),
    );
    const entries = Array.isArray(payload["entries"]) ? payload["entries"] : [];
    if (
      entries.some((value: unknown) => {
        const workspace = asRecord(value);
        return (
          workspace !== undefined &&
          workspace["id"] === agent.workspaceId &&
          workspace["projectId"] === projectId
        );
      })
    )
      return true;
    const page = asRecord(payload["pageInfo"]);
    if (page?.["hasMore"] !== true) return false;
    const next = page["nextCursor"];
    if (typeof next !== "string" || next === "" || cursors.has(next))
      throw new Error("Invalid daemon workspace pagination.");
    cursors.add(next);
    cursor = next;
  }
}

function checkedPayload(value: unknown): Record<string, unknown> {
  const payload = asRecord(value);
  if (payload === undefined) throw new Error("Invalid daemon response.");
  if (typeof payload["error"] === "string" && payload["error"] !== "")
    throw new Error(payload["error"]);
  if (payload["accepted"] === false) throw new Error("Daemon rejected configuration change.");
  return payload;
}
async function listField<T>(
  socket: TrustedDaemonClient,
  type: string,
  fields: Record<string, unknown>,
  key: string,
): Promise<T[]> {
  const payload = checkedPayload(await socket.call(type, fields, 90_000));
  return Array.isArray(payload[key]) ? (payload[key] as T[]) : [];
}
async function mutate(
  socket: TrustedDaemonClient,
  type: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const payload = checkedPayload(await socket.call(type, fields));
  if (payload["accepted"] !== true) throw new Error("Daemon did not accept configuration change.");
}
