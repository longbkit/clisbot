// Fusion-owned inbound normalizer (D-GC-013).
//
// Upstream's `monitor.ts` turns a verified Google Chat webhook event into an
// OpenClaw agent turn: it resolves the route, applies the access policy, builds
// the OpenClaw `ctxPayload` and calls `core.channel.inbound.run`, which owns the
// agent runtime, the reply pipeline and the typing indicator. Fusion's Hub owns
// every one of those, so this module does only the part the Hub cannot: turn the
// native event into the channel-agnostic `ChannelInboundEvent` the shared L3
// monitor admits (`@getpaseo/channels-shared`).
//
// `extractMentionInfo` below is upstream's function from `monitor-access.ts`,
// carried unchanged: the rest of that file is the OpenClaw pairing controller,
// group-policy resolver and ingress-identity allowlist, all Hub-owned.

import type { ChannelInboundEvent, ChannelInboundKind } from "@getpaseo/channels-shared";
import { parseDateStringTimestampMs } from "@getpaseo/channels-core/plugin-sdk/number-runtime";
import { normalizeGoogleChatUserId } from "../ingress-identity.js";
import { isGoogleChatGroupSpace } from "../targets.js";
import type { GoogleChatEvent } from "../types.js";

/** The account facts the normalizer needs; supplied by the webhook session. */
export interface GoogleChatInboundParams {
  accountId: string;
  /** The app's own `users/<id>` resource name, when the operator configured it. */
  botUser?: string;
  /** `true` when a bot-authored message may start a turn (`allowBots`). */
  allowBots?: boolean;
}

/** Upstream `monitor-access.ts`: which USER_MENTION annotations name the app. */
export function extractMentionInfo(
  annotations: NonNullable<GoogleChatEvent["message"]>["annotations"] = [],
  botUser?: string | null,
): { hasAnyMention: boolean; wasMentioned: boolean } {
  const mentionAnnotations = annotations.filter((entry) => entry.type === "USER_MENTION");
  const hasAnyMention = mentionAnnotations.length > 0;
  const botTargets = new Set(["users/app", botUser?.trim()].filter(Boolean) as string[]);
  const wasMentioned = mentionAnnotations.some((entry) => {
    const userName = entry.userMention?.user?.name;
    if (!userName) {
      return false;
    }
    if (botTargets.has(userName)) {
      return true;
    }
    return normalizeGoogleChatUserId(userName) === "app";
  });
  return { hasAnyMention, wasMentioned };
}

/** Why a verified event produced no admissible turn. Never a fault. */
export type GoogleChatInboundSkip =
  | "not-a-turn-event"
  | "own-message"
  | "bot-message"
  | "empty-body";

export type GoogleChatInboundBuild =
  | { admit: true; event: ChannelInboundEvent }
  | { admit: false; reason: GoogleChatInboundSkip };

/**
 * Normalizes one verified event. `MESSAGE` becomes a `message` turn;
 * `CARD_CLICKED` becomes a `callback` event carrying the button's action id and
 * the clicking user, so the Hub's inbound-kind policy can route it without the
 * vertical deciding anything (`hub/src/channels/plane/inbound-kinds.ts`);
 * `ADDED_TO_SPACE` / `REMOVED_FROM_SPACE` become `member` events.
 */
export function buildGoogleChatInboundEvent(
  event: GoogleChatEvent,
  params: GoogleChatInboundParams,
): GoogleChatInboundBuild {
  const eventType = event.type ?? event.eventType;
  if (eventType === "CARD_CLICKED") return buildCardClick(event, params);
  if (eventType === "ADDED_TO_SPACE" || eventType === "REMOVED_FROM_SPACE") {
    return buildRoomEvent(event, eventType);
  }
  if (eventType !== "MESSAGE") return { admit: false, reason: "not-a-turn-event" };
  return buildMessage(event, params);
}

function baseFacts(event: GoogleChatEvent): {
  spaceId: string;
  isGroup: boolean;
  timestampMs: number;
} {
  const space = event.space ?? {};
  return {
    spaceId: space.name ?? "",
    isGroup: isGoogleChatGroupSpace(space),
    timestampMs: parseDateStringTimestampMs(event.eventTime) ?? Date.now(),
  };
}

function buildMessage(
  event: GoogleChatEvent,
  params: GoogleChatInboundParams,
): GoogleChatInboundBuild {
  const message = event.message;
  const space = event.space;
  if (message === undefined || space === undefined) {
    return { admit: false, reason: "not-a-turn-event" };
  }
  const { spaceId, isGroup, timestampMs } = baseFacts(event);
  if (spaceId === "") return { admit: false, reason: "not-a-turn-event" };
  const sender = message.sender ?? event.user;
  const senderId = sender?.name ?? "";
  const isBotSender = sender?.type?.toUpperCase() === "BOT";
  // Upstream's own-message guard: the app posts as `users/app` unless the
  // operator named a bot user, and a bot author only passes with `allowBots`.
  const appUserId = params.botUser?.trim() || "users/app";
  if (params.allowBots !== true && (isBotSender || senderId === "users/app")) {
    return { admit: false, reason: isBotSender ? "bot-message" : "own-message" };
  }
  if (senderId !== "" && senderId === appUserId) {
    return { admit: false, reason: "own-message" };
  }
  // `argumentText` is the text with the leading app mention removed; upstream
  // prefers it so a mention-addressed turn does not carry the mention twice.
  const body = (message.argumentText ?? message.text ?? "").trim();
  if (body === "") return { admit: false, reason: "empty-body" };
  const { wasMentioned } = extractMentionInfo(message.annotations ?? [], params.botUser);
  const threadName = isGroup ? message.thread?.name : undefined;
  const slash = readSlashCommand(body);
  return {
    admit: true,
    event: {
      channel: "googlechat",
      // A Chat message resource name is unique per space and is the only id the
      // envelope carries, so it is both the transport event id and the message id.
      externalEventId: message.name ?? `${spaceId}:${timestampMs}`,
      externalMessageId: message.name ?? "",
      externalConversationId: spaceId,
      chatType: isGroup ? "channel" : "direct",
      ...(threadName === undefined ? {} : { messageThreadId: threadName }),
      senderId,
      ...(sender?.displayName ? { senderName: sender.displayName } : {}),
      ...(sender?.email ? { senderUsername: sender.email } : {}),
      body,
      wasMentioned,
      timestampMs,
      ...(space.displayName ? { conversationLabel: space.displayName } : {}),
      ...(isBotSender ? { isOwnMessage: false } : {}),
      ...(slash === undefined
        ? { kind: "message" as ChannelInboundKind }
        : { kind: "command" as ChannelInboundKind, facts: { command: slash } }),
    },
  };
}

/** A leading `/verb` line — Google Chat delivers native slash commands as text
 * plus a `SLASH_COMMAND` annotation, and a plain `/verb` is indistinguishable. */
function readSlashCommand(body: string): { name: string; args: string } | undefined {
  const match = /^\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/.exec(body.trim());
  const name = match?.[1];
  if (name === undefined) return undefined;
  return { name: name.toLowerCase(), args: (match?.[2] ?? "").trim() };
}

function buildCardClick(
  event: GoogleChatEvent,
  params: GoogleChatInboundParams,
): GoogleChatInboundBuild {
  const { spaceId, isGroup, timestampMs } = baseFacts(event);
  const actorId = event.user?.name ?? "";
  if (spaceId === "" || actorId === "") return { admit: false, reason: "not-a-turn-event" };
  const actionId =
    event.action?.actionMethodName ??
    event.common?.invokedFunction ??
    event.commonEventObject?.invokedFunction ??
    "";
  const value = readActionParameterValue(event);
  const cardMessageId = event.message?.name;
  void params;
  return {
    admit: true,
    event: {
      channel: "googlechat",
      externalEventId: `${spaceId}:card:${cardMessageId ?? actionId}:${timestampMs}`,
      externalMessageId: cardMessageId ?? "",
      externalConversationId: spaceId,
      chatType: isGroup ? "channel" : "direct",
      ...(event.message?.thread?.name === undefined
        ? {}
        : { messageThreadId: event.message.thread.name }),
      senderId: actorId,
      ...(event.user?.displayName ? { senderName: event.user.displayName } : {}),
      body: actionId === "" ? "card click" : `card click: ${actionId}`,
      // A button click is always addressed at the app that rendered the card.
      wasMentioned: true,
      timestampMs,
      kind: "callback",
      facts: {
        callback: {
          actionId,
          ...(value === undefined ? {} : { value }),
          actorId,
          ...(cardMessageId === undefined ? {} : { messageId: cardMessageId }),
        },
      },
    },
  };
}

function readActionParameterValue(event: GoogleChatEvent): string | undefined {
  const first = event.action?.parameters?.find((entry) => typeof entry.value === "string");
  if (first?.value !== undefined) return first.value;
  const parameters = event.common?.parameters ?? event.commonEventObject?.parameters;
  const firstValue = parameters === undefined ? undefined : Object.values(parameters)[0];
  return typeof firstValue === "string" ? firstValue : undefined;
}

function buildRoomEvent(
  event: GoogleChatEvent,
  eventType: "ADDED_TO_SPACE" | "REMOVED_FROM_SPACE",
): GoogleChatInboundBuild {
  const { spaceId, isGroup, timestampMs } = baseFacts(event);
  if (spaceId === "") return { admit: false, reason: "not-a-turn-event" };
  const joined = eventType === "ADDED_TO_SPACE";
  const actorId = event.user?.name ?? "";
  return {
    admit: true,
    event: {
      channel: "googlechat",
      externalEventId: `${spaceId}:${eventType.toLowerCase()}:${timestampMs}`,
      externalMessageId: `${spaceId}:${eventType.toLowerCase()}`,
      externalConversationId: spaceId,
      chatType: isGroup ? "channel" : "direct",
      senderId: actorId,
      ...(event.user?.displayName ? { senderName: event.user.displayName } : {}),
      body: joined ? "added to space" : "removed from space",
      wasMentioned: false,
      timestampMs,
      ...(event.space?.displayName ? { conversationLabel: event.space.displayName } : {}),
      kind: "member",
      facts: { member: { userId: actorId, joined } },
    },
  };
}
