import { TrustedDaemonClient } from "./ws-client.js";
import {
  discoverLocalDaemon,
  type DaemonDiscoveryResult,
} from "./discovery.js";
import type {
  AgentPermissionResponse,
  AgentSnapshot,
  CreateAgentConfig,
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
  rpcTimeoutMs?: number;
  /** Agent stream frames (`agent_stream`): one event per attached agent. */
  onStream?: (payload: {
    agentId: string;
    event: unknown;
    seq?: number;
  }) => void;
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
  createAgent(
    config: CreateAgentConfig,
    options?: { title?: string },
  ): Promise<CreateAgentResult>;
  sendAgentMessage(
    agentId: string,
    text: string,
    options?: { steer?: boolean },
  ): Promise<void>;
  /** Interrupt the active turn without creating a replacement turn. */
  cancelAgent(agentId: string): Promise<void>;
  respondToAgentPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void>;
  listAgents(): Promise<AgentSnapshot[]>;
  setTimelineSubscription(agentIds: readonly string[]): Promise<void>;
  /** Stop the socket. In-flight RPCs reject; streams stop. */
  stop(): void;
}

/**
 * Open one trusted-client connection to a daemon. The `url` option serves the
 * relay-paired team/remote leg; otherwise the loopback target is discovered from
 * the pid lock / default port.
 */
export function connectChannelDaemon(
  options: ChannelDaemonClientOptions = {},
): DaemonConnection {
  const discovery: DaemonDiscoveryResult =
    options.url !== undefined
      ? { url: options.url, source: "env" }
      : discoverLocalDaemon({ host: options.host, home: options.home });
  const socket = new TrustedDaemonClient({
    url: discovery.url,
    ...(options.password !== undefined ? { password: options.password } : {}),
    ...(options.clientId !== undefined ? { clientId: options.clientId } : {}),
    ...(options.rpcTimeoutMs !== undefined
      ? { rpcTimeoutMs: options.rpcTimeoutMs }
      : {}),
    ...(options.onStream !== undefined ? { onStream: options.onStream } : {}),
    ...(options.onAgentUpdate !== undefined
      ? { onAgentUpdate: options.onAgentUpdate }
      : {}),
    ...(options.onSubagentUpdate !== undefined
      ? { onSubagentUpdate: options.onSubagentUpdate }
      : {}),
    ...(options.onStateChange !== undefined
      ? { onStateChange: options.onStateChange }
      : {}),
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
        .call("create_agent_request", {
          config: withTitle(config, options?.title),
        })
        .then(mapCreatedAgent),
    sendAgentMessage: (agentId, text, options) =>
      socket
        .call("send_agent_message_request", {
          agentId,
          text,
          activeTurnBehavior: options?.steer === false ? "interrupt" : "steer",
        })
        .then((payload) => {
          const p = asRecord(payload);
          if (p !== undefined && p["accepted"] === false) {
            throw new Error(
              (p["error"] as string | undefined) ?? "agent message rejected",
            );
          }
          return undefined;
        }),
    cancelAgent: (agentId) =>
      socket.call("cancel_agent_request", { agentId }).then((payload) => {
        const p = asRecord(payload);
        if (
          p !== undefined &&
          typeof p["error"] === "string" &&
          p["error"] !== ""
        ) {
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
          .map((entry) => (entry as { agent?: unknown })?.agent)
          .filter((agent): agent is AgentSnapshot => isAgentSnapshot(agent));
      }),
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
  const agent = isAgentSnapshot(p?.["agent"]) ? p["agent"] : undefined;
  if (agent === undefined) {
    throw new Error("daemon did not report the created agent");
  }
  return { agentId: agent.id, agent };
}

function withTitle(
  config: CreateAgentConfig,
  title?: string,
): CreateAgentConfig {
  if (title === undefined) return config;
  return { ...config, title };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function isAgentSnapshot(value: unknown): value is AgentSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AgentSnapshot).id === "string"
  );
}
