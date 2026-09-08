// Minimal wire types for the Hub's trusted-client transport to a Paseo daemon.
// The Hub owns its own copy of the protocol shapes it drives (plan §4-S3: P0 uses
// the existing trusted-client RPCs only — no new wire, and the Hub package keeps
// zero @getpaseo imports). Only the fields the channel control plane reads are
// declared here; unknown fields are passed through untouched.

export interface AgentSnapshot {
  id: string;
  projectId?: string;
  workspaceId?: string;
  /** Raw wire value: null means the live mode has not been resolved. */
  currentModeId?: string | null;
  provider: string;
  cwd: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
  contextWindowUsedTokens?: number;
  contextWindowMaxTokens?: number;
  title: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  labels: Record<string, string>;
  activeTurn?: unknown;
  pendingPermissions?: unknown;
}

export interface AgentStreamTimelineItem {
  type: string;
  text?: string;
  messageId?: string;
  callId?: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export interface AgentPermissionDetail {
  type: string;
  [key: string]: unknown;
}

export interface AgentPermissionRequest {
  id: string;
  provider: string;
  name: string;
  kind: "tool" | "plan" | "question" | "mode" | "other";
  title?: string;
  description?: string;
  input?: Record<string, unknown>;
  detail?: AgentPermissionDetail;
}

export type AgentStreamEvent =
  | { type: "thread_started"; sessionId: string; provider: string }
  | { type: "turn_started"; provider: string; turnId?: string }
  | { type: "turn_completed"; provider: string; turnId?: string }
  | { type: "turn_failed"; provider: string; turnId?: string; error: string }
  | { type: "turn_canceled"; provider: string; turnId?: string; reason: string }
  | { type: "timeline"; provider: string; item: AgentStreamTimelineItem; turnId?: string }
  | {
      type: "permission_requested";
      provider: string;
      request: AgentPermissionRequest;
    }
  | {
      type: "permission_resolved";
      provider: string;
      requestId: string;
      resolution: unknown;
    }
  | {
      type: "attention_required";
      provider: string;
      reason: "finished" | "error" | "permission";
      timestamp: string;
      shouldNotify: boolean;
    }
  | { type: string; [key: string]: unknown };

export interface AgentStreamPayload {
  agentId: string;
  event: AgentStreamEvent;
  timestamp: string;
  seq?: number;
  epoch?: string;
}

export type AgentPermissionResponse =
  | {
      behavior: "allow";
      selectedActionId?: string;
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: Record<string, unknown>[];
    }
  | {
      behavior: "deny";
      selectedActionId?: string;
      message?: string;
      interrupt?: boolean;
    };

export interface CreateAgentConfig {
  provider: string;
  cwd: string;
  /** Stable daemon Project placement; sent beside, not inside, session config. */
  projectId?: string;
  worktree?:
    | { mode: "branch-off"; newBranch: string; base?: string }
    | { mode: "checkout-branch"; branch: string }
    | { mode: "checkout-pr"; prNumber: number };
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
  title?: string | null;
  providerOptions?: Record<string, unknown>;
  toolPolicy?: { preapproved: { kind: "mcp"; server: string; tool: string }[] };
  systemPrompt?: string;
  mcpServers?: Record<string, unknown>;
}

export interface TextAttachment {
  type: "text";
  mimeType: "text/plain";
  contextKind?: string;
  title?: string | null;
  text: string;
}
export interface AgentProfile {
  id: string;
  name: string;
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}
export interface DaemonServerInfo {
  serverId: string;
  features?: Record<string, boolean | undefined>;
}
export interface ProviderModel {
  id: string;
  provider: string;
  label: string;
  aliases?: string[];
  isSelectable?: boolean;
  isDefault?: boolean;
  thinkingOptions?: { id: string; label: string; isDefault?: boolean }[];
  defaultThinkingOptionId?: string;
}
export interface ProviderMode {
  id: string;
  label: string;
  isUnattended?: boolean;
}
export interface AgentCommand {
  name: string;
  description: string;
  argumentHint: string;
  kind?: "command" | "skill";
}
export interface AgentConfigApply {
  modelId?: string | null;
  modeId?: string;
  thinkingOptionId?: string | null;
  featureValues?: Record<string, unknown>;
}
export interface CreateAgentOptions {
  title?: string;
  initialPrompt?: string;
  attachments?: TextAttachment[];
  autoArchive?: boolean;
}
