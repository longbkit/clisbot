import type { VerifiedSessionOperationIdentity } from "@getpaseo/protocol/session-operation";
import type { WorktreeTarget } from "../config/index.js";
import type { JsonValue } from "../config/compiler.js";
import type {
  HubExecutionAgentSnapshot,
  HubExecutionAgentStreamEvent,
  HubExecutionControlAction,
} from "../hub/protocol.js";

export interface DaemonAgentSnapshot {
  id: string;
  state?: HubExecutionAgentSnapshot;
}

export interface DaemonCreateAgentOptions {
  sessionIdentity?: VerifiedSessionOperationIdentity;
  executionId: string;
  reuseAgentId?: string;
  provider: string;
  mode?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Readonly<Record<string, JsonValue>>;
  providerOptions?: Readonly<Record<string, JsonValue>>;
  toolPolicy: ToolPolicy;
  cwd: string;
  projectId?: string;
  prompt: string;
  env: Record<string, string>;
  mcpServers?: Record<string, McpHttpServerConfig>;
  worktree?: WorktreeTarget;
}

export interface McpToolRef {
  kind: "mcp";
  server: "hub" | "channel_reply";
  tool: string;
}

export interface ToolPolicy {
  preapproved: readonly McpToolRef[];
}

export interface McpHttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export interface DaemonExecutionControlOptions {
  executionId: string;
  action: HubExecutionControlAction;
}

export type DaemonTimelineItem = Extract<
  HubExecutionAgentStreamEvent,
  { type: "timeline" }
>["item"];

export type DaemonAgentStreamEvent = HubExecutionAgentStreamEvent;

export interface DaemonAgentStreamDaemonEvent {
  type: "agent_stream";
  executionId: string;
  agentId: string;
  event: DaemonAgentStreamEvent;
  timestamp: string;
}

export interface DaemonAgentUpdateEvent {
  type: "agent_update";
  executionId: string;
  agentId: string;
  agent: HubExecutionAgentSnapshot;
  timestamp: string;
}

export type DaemonEvent = DaemonAgentStreamDaemonEvent | DaemonAgentUpdateEvent;

export type DaemonEventHandler = (event: DaemonEvent) => void | Promise<void>;

/**
 * The Host's own socket, driven as an ordinary daemon session.
 *
 * A Host is private: nothing dials into it, which is why the daemon opens this
 * socket to the Hub and keeps it alive. The daemon attaches that socket as a
 * full session on its side (`relationship-controller.ts` `attachSocket`), so
 * any session RPC the app can make, the Hub can make here. The channel plane
 * rides this rather than dialing back through the relay.
 */
export interface DaemonSessionChannel {
  /** The daemon's `server_info` payload, seen when the socket was accepted. */
  readonly serverInfo: Record<string, unknown> | undefined;
  /** Write one already-enveloped session frame. */
  write(frame: string): Promise<void>;
}

/** The Host sessions this Hub can drive, narrowed from the registry for the
 * consumers that only need "reach this Host and hear it back". */
export interface DaemonSessionAccess {
  channel(daemonId: string): DaemonSessionChannel | undefined;
  subscribe(daemonId: string, handler: (message: Record<string, unknown>) => void): () => void;
  /** Fires when a Host's socket becomes usable, including after a reconnect. */
  onConnected(handler: (daemonId: string) => void): () => void;
  /** Fires when a Host's socket goes: what is in flight on it will not answer. */
  onDisconnected(handler: (daemonId: string) => void): () => void;
}

export interface DaemonConnection {
  createAgent(options: DaemonCreateAgentOptions): Promise<DaemonAgentSnapshot>;
  controlExecution(options: DaemonExecutionControlOptions): Promise<void>;
  on(handler: DaemonEventHandler): () => void;
}

/** The daemon may have durably created the agent before its acknowledgement was lost. */
export class DaemonCreateResponseLostError extends Error {
  constructor() {
    super("daemon create response was lost");
    this.name = "DaemonCreateResponseLostError";
  }
}

export class DaemonCreateRejectedError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly provider?: string,
    readonly issues?: readonly {
      path: readonly (string | number)[];
      message: string;
    }[],
  ) {
    super(message);
    this.name = "DaemonCreateRejectedError";
  }
}
