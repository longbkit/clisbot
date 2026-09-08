// Slack plugin module implements interactions behavior.
//
// D-041: upstream's `monitor/events/interactions.block-actions.ts` (1256
// lines) decodes a `block_actions` payload and then drives OpenClaw's approval
// gates, question finalization, session cards, modal metadata and its command
// runner. Fusion's Hub owns approvals and questions, so only the decode half
// lives here: the payload's callback AUTHORITY facts (who clicked, which
// action, which message, which conversation/thread) plus the inbound event
// that carries them to the Hub. The existing native approval seam
// (`transport/approval-card.ts` → `channelRuntime.approvalAction`) keeps
// working unchanged and runs from the same listener.
//
// Ack order is the documented exception to admission-before-ack: Slack closes
// an interactive component's response window after 3s, far below a durable
// write plus an agent turn, so the listener acks first and admits after. That
// matches upstream, whose ingress wrapper passes non-`event_callback` payloads
// straight through to the listener's own `ack()`.

import type { ChannelInboundEvent } from "@getpaseo/channels-shared";
import { inferSlackChannelType } from "../../transport/socket-event-filter.js";
import { resolveSlackChatType } from "../../transport/socket-event-filter.js";

/** The callback authority facts a Slack interactive payload carries. */
export interface SlackInteractiveCallback {
  /** `block_actions` (buttons/selects), `view_submission` (modal submit). */
  payloadType: "block_actions" | "view_submission";
  /** The acting user's native id (`U…`). */
  actorId: string;
  /** The clicked element's `action_id`, or the modal's `callback_id`. */
  actionId: string;
  /** The element's opaque value (button value / selected option value). */
  value?: string;
  /** The conversation the interaction happened in. */
  channelId: string;
  /** The card's own message ts (the in-place-update target). */
  messageTs?: string;
  /** The card's thread ts when it was posted in a thread. */
  threadTs?: string;
  /** Slack's per-invocation id — the honest dedupe key. */
  triggerId?: string;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readActionValue(action: Record<string, unknown>): string | undefined {
  const direct = readString(action, "value");
  if (direct !== undefined) return direct;
  const selected = asRecord(action["selected_option"]);
  if (selected !== undefined) return readString(selected, "value");
  const selectedList = action["selected_options"];
  if (Array.isArray(selectedList)) {
    const values = selectedList
      .map((entry) =>
        asRecord(entry) !== undefined ? readString(asRecord(entry)!, "value") : undefined,
      )
      .filter((entry): entry is string => entry !== undefined);
    if (values.length > 0) return values.join(",");
  }
  return readString(action, "selected_date") ?? readString(action, "selected_user");
}

/** Decode a `block_actions` / `view_submission` payload into its authority
 * facts. Null for a payload shape this vertical does not own. */
export function parseSlackInteractiveCallback(
  body: Record<string, unknown>,
): SlackInteractiveCallback | null {
  const type = body["type"];
  if (type !== "block_actions" && type !== "view_submission") return null;
  const actorId = readString(asRecord(body["user"]) ?? {}, "id");
  if (actorId === undefined) return null;
  const triggerId = readString(body, "trigger_id");
  if (type === "view_submission") {
    const view = asRecord(body["view"]);
    const callbackId = view !== undefined ? readString(view, "callback_id") : undefined;
    if (callbackId === undefined) return null;
    const metadata = view !== undefined ? readString(view, "private_metadata") : undefined;
    const channelId =
      readString(asRecord(body["channel"]) ?? {}, "id") ??
      readString(asRecord(body["container"]) ?? {}, "channel_id") ??
      "";
    return {
      payloadType: "view_submission",
      actorId,
      actionId: callbackId,
      ...(metadata !== undefined ? { value: metadata } : {}),
      channelId,
      ...(triggerId !== undefined ? { triggerId } : {}),
    };
  }
  const actions = body["actions"];
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const first = asRecord(actions[0]);
  if (first === undefined) return null;
  const actionId = readString(first, "action_id");
  if (actionId === undefined) return null;
  const container = asRecord(body["container"]);
  const channelId =
    readString(asRecord(body["channel"]) ?? {}, "id") ??
    readString(body, "channel") ??
    (container !== undefined ? readString(container, "channel_id") : undefined);
  if (channelId === undefined) return null;
  const message = asRecord(body["message"]);
  const messageTs =
    (message !== undefined ? readString(message, "ts") : undefined) ??
    (container !== undefined ? readString(container, "message_ts") : undefined);
  const threadTs = message !== undefined ? readString(message, "thread_ts") : undefined;
  const value = readActionValue(first);
  return {
    payloadType: "block_actions",
    actorId,
    actionId,
    ...(value !== undefined ? { value } : {}),
    channelId,
    ...(messageTs !== undefined ? { messageTs } : {}),
    ...(threadTs !== undefined ? { threadTs } : {}),
    ...(triggerId !== undefined ? { triggerId } : {}),
  };
}

/** The dedupe identity of one interaction: stable per (action, message, actor). */
export function slackInteractiveContextKey(callback: SlackInteractiveCallback): string {
  return `slack:interactive:${callback.payloadType}:${callback.channelId}:${callback.messageTs ?? "none"}:${callback.actionId}:${callback.actorId}`;
}

/**
 * The Fusion cut: the decoded interaction becomes the inbound event the shared
 * monitor admits, so the Hub sees the callback with its authority facts. The
 * body carries the action id and value in the same `Slack: …` shape the other
 * system events use; `wasMentioned` is true because a button click on the
 * bot's own card IS an address to the bot.
 */
export function buildSlackInteractiveInboundEvent(
  callback: SlackInteractiveCallback,
  params: { eventId?: string; timestampMs?: number },
): ChannelInboundEvent {
  const contextKey = slackInteractiveContextKey(callback);
  const nativeType = inferSlackChannelType(callback.channelId) ?? "channel";
  const detail = callback.value === undefined ? "" : ` value ${callback.value}`;
  return {
    channel: "slack",
    externalEventId: params.eventId ?? callback.triggerId ?? contextKey,
    externalMessageId: contextKey,
    externalConversationId: callback.channelId,
    chatType: resolveSlackChatType(nativeType),
    messageThreadId: callback.threadTs ?? null,
    senderId: callback.actorId,
    body: `Slack ${callback.payloadType === "view_submission" ? "modal submitted" : "action"}: ${callback.actionId}${detail} by ${callback.actorId} on msg ${callback.messageTs ?? "none"}`,
    wasMentioned: true,
    timestampMs: params.timestampMs ?? Date.now(),
    // A button/select click is a `callback`; a modal submit is `interactive`.
    // The Hub routes both through the same seam and tells them apart only when
    // it needs the modal's `private_metadata` rather than a button value.
    kind: callback.payloadType === "view_submission" ? "interactive" : "callback",
    facts: {
      callback: {
        actionId: callback.actionId,
        ...(callback.value === undefined ? {} : { value: callback.value }),
        actorId: callback.actorId,
        ...(callback.messageTs === undefined ? {} : { messageId: callback.messageTs }),
      },
    },
  };
}
