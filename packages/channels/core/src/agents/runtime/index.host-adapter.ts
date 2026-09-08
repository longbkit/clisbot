// Fusion-owned host adapter for `src/agents/runtime/index.ts` (D-CORE-019).
//
// Upstream's runtime barrel re-exports the whole `@openclaw/agent-core` agent
// (Agent, compaction, session trees, streaming). The ported message-action layer
// reads one contract from it: the tool result shape a channel action returns.
// The definitions below are copied from `packages/agent-core/src/types.ts`.

/** Text content returned to the model. */
export type TextContent = { type: "text"; text: string };
/** Image content returned to the model. */
export type ImageContent = { type: "image"; data: string; mimeType: string };

/** Channel-safe progress text emitted by a running tool. */
export interface AgentToolProgress {
  /** Public text suitable for user-facing progress surfaces. */
  text: string;
  /** Tool progress is rendered by channel progress UIs. */
  visibility: "channel";
  /** Progress text must not contain secrets, private args, or fetched content. */
  privacy: "public";
  /** Optional stable id for progress line replacement. */
  id?: string;
}

/** Final or partial result produced by a tool. */
export interface AgentToolResult<T> {
  /** Text or image content returned to the model. */
  content: (TextContent | ImageContent)[];
  /** Arbitrary structured details for logs or UI rendering. */
  details: T;
  /** Optional public progress hint for partial tool updates; never model content. */
  progress?: AgentToolProgress;
  /**
   * Hint that the agent should stop after the current tool batch.
   * Early termination only happens when every finalized tool result in the batch sets this to true.
   */
  terminate?: boolean;
}

/** Callback used by tools to stream partial execution updates. */
export type AgentToolUpdateCallback<T = unknown> = (partialResult: AgentToolResult<T>) => void;

/** Origin class for tool output that can taint later model-authored content in the same turn. */
export type ToolResultContentSource = "network";
