// Normalized run-event model shared by every runner backend.
//
// Channels render run events (or text accumulated from them), never backend
// artifacts. Structured backends (ACP, CLI JSON) map their native updates onto
// this model; the tmux backend emits coarse snapshot-diff events. The model
// grows additively: consumers must ignore event types they do not know.

export type RunEventRole = "assistant" | "thought" | "user";

export type ToolCallStatus = "pending" | "in-progress" | "completed" | "failed";

export type PlanEntryStatus = "pending" | "in-progress" | "completed";

export type PermissionOptionKind =
  | "allow-once"
  | "allow-always"
  | "reject-once"
  | "reject-always";

export type PermissionOption = {
  optionId: string;
  label: string;
  kind: PermissionOptionKind;
};

export type RunLifecycleState =
  | "starting"
  | "ready"
  | "running"
  | "idle"
  | "cancelled"
  | "exited";

export type RunEvent =
  | { type: "message-delta"; role: RunEventRole; text: string }
  | {
      type: "tool-call";
      callId: string;
      title: string;
      status: ToolCallStatus;
      detail?: string;
    }
  | { type: "plan"; entries: Array<{ title: string; status: PlanEntryStatus }> }
  | {
      type: "permission-request";
      requestId: string;
      title: string;
      options: PermissionOption[];
    }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      costUsd?: number;
    }
  | { type: "lifecycle"; state: RunLifecycleState; detail?: string }
  | { type: "backend-error"; message: string };
