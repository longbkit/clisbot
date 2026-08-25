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
  executionId: string;
  provider: string;
  mode?: string;
  model?: string;
  thinkingOptionId?: string;
  providerOptions?: Readonly<Record<string, JsonValue>>;
  toolPolicy: ToolPolicy;
  cwd: string;
  prompt: string;
  env: Record<string, string>;
  mcpServers?: Record<string, McpHttpServerConfig>;
  worktree?: WorktreeTarget;
}

export interface McpToolRef {
  kind: "mcp";
  server: "hub";
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
