// Maps ACP session/update notifications onto the normalized RunEvent model
// and renders the running turn into chat-ready transcript text. Unknown
// update types are ignored so newer adapters stay compatible.

import type { SessionUpdate, StopReason } from "@agentclientprotocol/sdk";
import type {
  PermissionOptionKind,
  RunEvent,
  ToolCallStatus,
} from "../contract/run-event.ts";

// One prompt turn accumulates ordered segments: assistant text interleaved
// with tool activity lines that update in place as tool calls progress.
export type TurnSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; callId: string; title: string; status: ToolCallStatus };

export function mapSessionUpdateToRunEvent(update: SessionUpdate): RunEvent | null {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return update.content.type === "text"
        ? { type: "message-delta", role: "assistant", text: update.content.text }
        : null;
    case "agent_thought_chunk":
      return update.content.type === "text"
        ? { type: "message-delta", role: "thought", text: update.content.text }
        : null;
    case "user_message_chunk":
      return update.content.type === "text"
        ? { type: "message-delta", role: "user", text: update.content.text }
        : null;
    case "tool_call":
      return {
        type: "tool-call",
        callId: update.toolCallId,
        title: update.title,
        status: mapToolCallStatus(update.status),
      };
    case "tool_call_update":
      return {
        type: "tool-call",
        callId: update.toolCallId,
        title: update.title ?? "",
        status: mapToolCallStatus(update.status),
      };
    case "plan":
      return {
        type: "plan",
        entries: update.entries.map((entry) => ({
          title: entry.content,
          status: entry.status === "completed"
            ? "completed"
            : entry.status === "in_progress"
              ? "in-progress"
              : "pending",
        })),
      };
    case "usage_update":
      return {
        type: "usage",
        totalTokens: update.used,
        costUsd: numberOrUndefined(
          (update.cost as { amount?: unknown } | null | undefined)?.amount,
        ),
      };
    default:
      return null;
  }
}

export function mapToolCallStatus(status: string | null | undefined): ToolCallStatus {
  switch (status) {
    case "in_progress":
      return "in-progress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

export function mapPermissionOptionKind(kind: string): PermissionOptionKind {
  switch (kind) {
    case "allow_always":
      return "allow-always";
    case "reject_once":
      return "reject-once";
    case "reject_always":
      return "reject-always";
    default:
      return "allow-once";
  }
}

export function applyRunEventToTurn(segments: TurnSegment[], event: RunEvent) {
  if (event.type === "message-delta") {
    if (event.role !== "assistant") {
      return;
    }
    const last = segments[segments.length - 1];
    if (last?.kind === "text") {
      last.text += event.text;
      return;
    }
    segments.push({ kind: "text", text: event.text });
    return;
  }

  if (event.type === "tool-call") {
    const existing = segments.find(
      (segment): segment is TurnSegment & { kind: "tool" } =>
        segment.kind === "tool" && segment.callId === event.callId,
    );
    if (existing) {
      existing.status = event.status;
      if (event.title) {
        existing.title = event.title;
      }
      return;
    }
    segments.push({
      kind: "tool",
      callId: event.callId,
      title: event.title || "tool call",
      status: event.status,
    });
  }
}

const TOOL_STATUS_MARKS: Record<ToolCallStatus, string> = {
  "pending": "…",
  "in-progress": "…",
  "completed": "✓",
  "failed": "✗",
};

export function renderTurnText(segments: TurnSegment[]) {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "text") {
      const text = segment.text.trim();
      if (text) {
        parts.push(text);
      }
      continue;
    }
    parts.push(`⏺ ${segment.title} [${TOOL_STATUS_MARKS[segment.status]}]`);
  }
  return parts.join("\n\n");
}

export function describeStopReason(stopReason: StopReason) {
  switch (stopReason) {
    case "end_turn":
      return null;
    case "cancelled":
      return "The run was cancelled.";
    case "max_tokens":
      return "The run stopped because the model hit its token limit.";
    case "max_turn_requests":
      return "The run stopped because the agent hit its per-turn request limit.";
    case "refusal":
      return "The agent declined to continue this request.";
    default:
      return `The run stopped early (${stopReason satisfies never}).`;
  }
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
