// Slack plugin module implements system event normalization.
//
// D-040: upstream splits these across `monitor/events/reactions.ts`,
// `members.ts`, `channels.ts`, `pins.ts` and
// `monitor/events/message-subtype-handlers.ts`. Each of those registers a Bolt
// listener on the OpenClaw `SlackMonitorContext`, resolves the OpenClaw route
// through `authorizeAndResolveSlackSystemEventContext`, and hands the result to
// `enqueueRoutedSystemEvent` — the OpenClaw system-event bus, which Fusion does
// not have (the Hub owns routing and authorization). What survives verbatim is
// the part that is protocol truth: the notification TEXT and the dedupe
// CONTEXT KEY. Those strings are reproduced here character for character, and
// the Fusion cut is the last step only: instead of `enqueueRoutedSystemEvent`
// the normalized fact becomes a `ChannelInboundEvent` that the shared monitor
// admits, so the Hub can route or ignore it.
//
// `message_changed` / `message_deleted` reuse the ported
// `message-subtype-handlers.ts` registry (verbatim upstream) for their sender,
// thread and context-key resolution; only the `describe()` text is rendered
// here.

import type {
  ChannelInboundEvent,
  ChannelInboundFacts,
  ChannelInboundKind,
} from "@getpaseo/channels-shared";
import type { SlackMessageEvent } from "../../types.js";
import type { SlackMessageEvent as SlackWireMessageEvent } from "../../transport/socket-event-filter.js";
import { resolveSlackMessageSubtypeHandler } from "./message-subtype-handlers.js";
import {
  normalizeSlackChannelType,
  resolveSlackChatType,
  resolveSlackTimestampMs,
} from "../../transport/socket-event-filter.js";

/** The Slack system-event families this vertical normalizes. */
export type SlackSystemEventKind =
  | "reaction"
  | "member"
  | "channel"
  | "pin"
  | "message_changed"
  | "message_deleted";

/** The pure result of a normalizer: the upstream text plus the dedupe key. */
export type SlackSystemEventFacts = {
  kind: SlackSystemEventKind;
  text: string;
  contextKey: string;
  channelId: string;
  senderId: string;
  threadTs?: string;
  /** The shared inbound facts this family carries, when it carries any. The
   * Hub routes on them; the text stays the human-readable rendering. */
  facts?: ChannelInboundFacts;
};

/** The shared inbound family each Slack system event belongs to. */
const SLACK_SYSTEM_INBOUND_KIND: Record<SlackSystemEventKind, ChannelInboundKind> = {
  reaction: "reaction",
  member: "member",
  channel: "channel",
  pin: "pin",
  message_changed: "edit",
  message_deleted: "delete",
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Upstream renders the channel as a resolved `#name` label through
 * `ctx.resolveChannelName`. Fusion has no name cache at the transport, so the
 * label falls back to the raw id; a resolved name may be supplied by the
 * caller. */
function channelLabel(channelId: string, resolvedName?: string): string {
  return resolvedName !== undefined && resolvedName !== "" ? `#${resolvedName}` : channelId;
}

const teamPrefix = (teamId: string | undefined): string => (teamId ? `${teamId}:` : "");

/** `monitor/events/reactions.ts`: the `Slack reaction …` notification. */
export function buildSlackReactionFacts(params: {
  event: Record<string, unknown>;
  action: "added" | "removed";
  eventId: string;
  teamId?: string;
  actorName?: string;
  authorName?: string;
  channelName?: string;
}): SlackSystemEventFacts | undefined {
  const item = asRecord(params.event["item"]);
  if (item === undefined || item["type"] !== "message") return undefined;
  const channelId = asString(item["channel"]);
  const ts = asString(item["ts"]);
  if (channelId === undefined || ts === undefined) return undefined;
  const user = asString(params.event["user"]) ?? "";
  const itemUser = asString(params.event["item_user"]);
  const actorLabel = params.actorName ?? user;
  const emojiLabel = asString(params.event["reaction"]) ?? "emoji";
  const authorLabel = params.authorName ?? itemUser;
  const baseText = `Slack reaction ${params.action}: :${emojiLabel}: by ${actorLabel} in ${channelLabel(channelId, params.channelName)} msg ${ts}`;
  return {
    kind: "reaction",
    text: authorLabel ? `${baseText} from ${authorLabel}` : baseText,
    contextKey: `slack:reaction:${teamPrefix(params.teamId)}${params.action}:${channelId}:${ts}:${user}:${emojiLabel}:${params.eventId}`,
    channelId,
    senderId: user,
    facts: {
      reaction: {
        emoji: emojiLabel,
        added: params.action === "added",
        messageId: ts,
        actorId: user,
      },
    },
  };
}

/** `monitor/events/members.ts`: the `Slack: <user> joined|left <channel>.` line. */
export function buildSlackMemberFacts(params: {
  event: Record<string, unknown>;
  verb: "joined" | "left";
  eventId: string;
  teamId?: string;
  userName?: string;
  channelName?: string;
}): SlackSystemEventFacts | undefined {
  const channelId = asString(params.event["channel"]);
  if (channelId === undefined) return undefined;
  const user = asString(params.event["user"]);
  const userLabel = params.userName ?? user ?? "someone";
  return {
    kind: "member",
    text: `Slack: ${userLabel} ${params.verb} ${channelLabel(channelId, params.channelName)}.`,
    contextKey: `slack:member:${teamPrefix(params.teamId)}${params.verb}:${channelId}:${user ?? "unknown"}:${params.eventId}`,
    channelId,
    senderId: user ?? "",
    facts: { member: { userId: user ?? "", joined: params.verb === "joined" } },
  };
}

/** `monitor/events/channels.ts`: the `Slack channel created|renamed: <label>.` line. */
export function buildSlackChannelFacts(params: {
  event: Record<string, unknown>;
  kind: "created" | "renamed";
  eventId: string;
  teamId?: string;
}): SlackSystemEventFacts | undefined {
  const channel = asRecord(params.event["channel"]) ?? params.event;
  const channelId = asString(channel["id"]) ?? asString(params.event["channel"]);
  const channelName = asString(channel["name"]);
  if (channelId === undefined && channelName === undefined) return undefined;
  const label = channelLabel(channelId ?? "unknown", channelName);
  return {
    kind: "channel",
    text: `Slack channel ${params.kind}: ${label}.`,
    contextKey: `slack:channel:${teamPrefix(params.teamId)}${params.kind}:${channelId ?? channelName ?? "unknown"}:${params.eventId}`,
    channelId: channelId ?? "",
    senderId: "",
  };
}

/** `monitor/events/pins.ts`: the `Slack: <user> pinned|unpinned a <item> in <channel>.` line. */
export function buildSlackPinFacts(params: {
  event: Record<string, unknown>;
  action: "pinned" | "unpinned";
  contextKeySuffix: "added" | "removed";
  eventId: string;
  teamId?: string;
  userName?: string;
  channelName?: string;
}): SlackSystemEventFacts | undefined {
  const channelId = asString(params.event["channel_id"]) ?? asString(params.event["channel"]);
  if (channelId === undefined) return undefined;
  const user = asString(params.event["user"]);
  const userLabel = params.userName ?? user ?? "someone";
  const item = asRecord(params.event["item"]);
  const itemType = asString(item?.["type"]) ?? "item";
  const messageId =
    asString(asRecord(item?.["message"])?.["ts"]) ?? asString(params.event["event_ts"]);
  return {
    kind: "pin",
    text: `Slack: ${userLabel} ${params.action} a ${itemType} in ${channelLabel(channelId, params.channelName)}.`,
    contextKey: `slack:pin:${teamPrefix(params.teamId)}${params.contextKeySuffix}:${channelId}:${messageId ?? "unknown"}:${params.eventId}`,
    channelId,
    senderId: user ?? "",
    ...(messageId === undefined ? {} : { facts: { target: { messageId } } }),
  };
}

/** `monitor/events/message-subtype-handlers.ts`: the edit / delete notification. */
export function buildSlackMessageSubtypeFacts(params: {
  event: SlackWireMessageEvent;
  channelName?: string;
}): SlackSystemEventFacts | undefined {
  // The registry is upstream's, typed against upstream's `SlackMessageEvent`
  // (a closed `type: "message"`); the transport's wire shape is the open
  // record Socket Mode actually delivers.
  const event = params.event as unknown as SlackMessageEvent;
  const handler = resolveSlackMessageSubtypeHandler(event);
  if (handler === undefined) return undefined;
  const channelId = asString(event.channel);
  if (channelId === undefined) return undefined;
  const threadTs = handler.resolveThreadTs(event);
  // The SUBJECT message: the edited/deleted message's own ts, which the
  // envelope carries on the nested payload, not on the notification.
  const wire = params.event;
  const subject =
    asString(asRecord(wire["message"])?.["ts"]) ??
    asString(asRecord(wire["previous_message"])?.["ts"]) ??
    asString(wire["deleted_ts"]) ??
    asString(wire["ts"]);
  return {
    kind: handler.eventKind,
    text: handler.describe(channelLabel(channelId, params.channelName)),
    contextKey: handler.contextKey(event),
    channelId,
    senderId: handler.resolveSenderId(event) ?? "",
    ...(threadTs !== undefined ? { threadTs } : {}),
    ...(subject === undefined ? {} : { facts: { target: { messageId: subject } } }),
  };
}

/**
 * The Fusion cut: one normalized system fact becomes the inbound event the
 * shared monitor admits. `wasMentioned` is false — a reaction, a join or an
 * edit never addresses the bot — so a mention-gated conversation ignores it
 * and an always-reply conversation sees it, which is the upstream
 * `enqueueRoutedSystemEvent` behaviour once its route is resolved.
 */
export function buildSlackSystemInboundEvent(
  facts: SlackSystemEventFacts,
  params: { eventId: string; channelType?: string; timestampMs?: number },
): ChannelInboundEvent {
  const channelType = normalizeSlackChannelType(params.channelType, facts.channelId);
  return {
    channel: "slack",
    externalEventId: params.eventId,
    // The context key is upstream's dedupe identity for the notification; it
    // is stable per (kind, conversation, message, actor) and therefore the
    // honest durable-ledger key for a system event that has no message ts.
    externalMessageId: facts.contextKey,
    externalConversationId: facts.channelId,
    chatType: resolveSlackChatType(channelType),
    messageThreadId: facts.threadTs ?? null,
    senderId: facts.senderId,
    body: facts.text,
    wasMentioned: false,
    timestampMs: params.timestampMs ?? Date.now(),
    kind: SLACK_SYSTEM_INBOUND_KIND[facts.kind],
    ...(facts.facts === undefined ? {} : { facts: facts.facts }),
  };
}

export { resolveSlackTimestampMs };
