// Fusion-owned inbound normalizer (D-ZL-012).
//
// Upstream's `monitor.ts` turns a Zalo update into an OpenClaw agent turn: it
// resolves the route, runs the pairing/allowlist policy, downloads the photo,
// builds the OpenClaw `ctxPayload` and calls `core.channel.inbound.dispatch`,
// which owns the agent runtime, the reply pipeline and the typing indicator.
// Fusion's Hub owns every one of those, so this module does only the part the
// Hub cannot: turn the native update into the channel-agnostic
// `ChannelInboundEvent` the shared L3 monitor admits
// (`@getpaseo/channels-shared`).
//
// Carried from upstream `monitor.ts` unchanged: the seconds-vs-milliseconds
// timestamp rule (`resolveZaloTimestampMs`), the group/direct split off
// `chat.chat_type`, the sender label preference (`display_name` before `name`)
// and the `zalo:group:<chat>` / `zalo:<sender>` addressing.
//
// NEW here, because the Bot API gives the vertical nothing to read it from:
// `wasMentioned` in a group. Zalo delivers group text with no mention
// annotation and no entity list, and upstream leans on OpenClaw core's
// name-matching for its `resolveRequireMention: () => true` group rule. The Hub
// owns mention POLICY but needs the FACT, so this module matches the bot's own
// account name (`getMe` → `account_name`, and any operator-configured aliases)
// as a leading or embedded `@name` / bare name token.

import type { ChannelInboundEvent, ChannelInboundKind } from "@getpaseo/channels-shared";
import type { ZaloMessage, ZaloUpdate } from "../api.js";

/** Upstream `monitor.ts`: a `date` this large is already milliseconds. */
const UNIX_MILLISECONDS_THRESHOLD = 1_000_000_000_000;

/** The account facts the normalizer needs; supplied by the session. */
export interface ZaloInboundParams {
  accountId: string;
  /** The bot's own Zalo id (`getMe` → `id`), for the own-message filter. */
  botId?: string;
  /** The bot's display name plus any operator aliases, for group mentions. */
  botNames?: string[];
  /** `true` when a bot-authored message may start a turn. Default false. */
  allowBots?: boolean;
}

/** Why a well-formed update produced no admissible turn. Never a fault. */
export type ZaloInboundSkip =
  | "not-a-turn-event"
  | "unsupported-event"
  | "own-message"
  | "bot-message"
  | "empty-body";

export type ZaloInboundBuild =
  | {
      admit: true;
      event: ChannelInboundEvent;
      /** The inbound photo URL, for the admission step to download. */
      mediaUrl?: string;
    }
  | { admit: false; reason: ZaloInboundSkip };

/** Upstream `monitor.ts`, unchanged. */
export function resolveZaloTimestampMs(date: number | undefined): number | undefined {
  if (!date) {
    return undefined;
  }
  return date >= UNIX_MILLISECONDS_THRESHOLD ? date : date * 1000;
}

/** A leading `/verb` line — Zalo has no native command surface, so a command is
 * exactly what the text says it is (the same rule the Google Chat vertical
 * applies, `fusion/inbound-adapter.ts` there). */
function readSlashCommand(body: string): { name: string; args: string } | undefined {
  const match = /^\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/.exec(body.trim());
  const name = match?.[1];
  if (name === undefined) return undefined;
  return { name: name.toLowerCase(), args: (match?.[2] ?? "").trim() };
}

/** True when `body` addresses one of the bot's names. `@name` wins; a bare name
 * only counts on a word boundary so "botanical" never reads as "bot". */
export function wasZaloBotMentioned(body: string, botNames: readonly string[]): boolean {
  const haystack = body.toLowerCase();
  return botNames.some((raw) => {
    const name = raw.trim().replace(/^@/, "").toLowerCase();
    if (name === "") return false;
    if (haystack.includes(`@${name}`)) return true;
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(name)}($|[^\\p{L}\\p{N}_])`, "u").test(
      haystack,
    );
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalizes one update. `message.text.received` becomes a `message` turn (or a
 * `command` when the body is a leading `/verb`); `message.image.received`
 * becomes a `message` turn carrying the photo URL for the admission step.
 *
 * `message.sticker.received` and `message.unsupported.received` are NOT
 * admitted: upstream logs them and returns without starting a turn, and this
 * port keeps that behaviour rather than inventing a body for them.
 */
export function buildZaloInboundEvent(
  update: ZaloUpdate,
  params: ZaloInboundParams,
): ZaloInboundBuild {
  const message = update.message;
  if (message === undefined) return { admit: false, reason: "not-a-turn-event" };
  if (
    update.event_name === "message.sticker.received" ||
    update.event_name === "message.unsupported.received"
  ) {
    return { admit: false, reason: "unsupported-event" };
  }
  if (update.event_name !== "message.text.received" && update.event_name !== "message.image.received") {
    return { admit: false, reason: "not-a-turn-event" };
  }
  const senderId = message.from?.id ?? "";
  if (senderId === "") return { admit: false, reason: "not-a-turn-event" };
  if (params.botId !== undefined && senderId === params.botId) {
    return { admit: false, reason: "own-message" };
  }
  if (message.from?.is_bot === true && params.allowBots !== true) {
    return { admit: false, reason: "bot-message" };
  }
  const isImage = update.event_name === "message.image.received";
  const body = ((isImage ? message.caption : message.text) ?? "").trim();
  const mediaUrl = isImage ? message.photo_url?.trim() : undefined;
  if (body === "" && (mediaUrl === undefined || mediaUrl === "")) {
    return { admit: false, reason: "empty-body" };
  }
  const event = buildEvent(message, { body, params });
  return mediaUrl === undefined || mediaUrl === ""
    ? { admit: true, event }
    : { admit: true, event, mediaUrl };
}

function buildEvent(
  message: ZaloMessage,
  args: { body: string; params: ZaloInboundParams },
): ChannelInboundEvent {
  const { body, params } = args;
  const isGroup = message.chat.chat_type === "GROUP";
  const chatId = message.chat.id;
  const senderId = message.from.id;
  const senderName = message.from.display_name ?? message.from.name;
  const timestampMs = resolveZaloTimestampMs(message.date) ?? Date.now();
  const slash = readSlashCommand(body);
  return {
    channel: "zalo",
    // The Bot API carries one id per message and no transport-level update id,
    // so the message id is both the in-flight key and the ledger key. The
    // webhook spool's admission facts use the same field (`webhook-spool.ts`).
    externalEventId: message.message_id,
    externalMessageId: message.message_id,
    externalConversationId: chatId,
    chatType: isGroup ? "group" : "direct",
    senderId,
    ...(senderName === undefined ? {} : { senderName }),
    body,
    // A DM is addressed at the bot by construction; a group message is only
    // addressed when it names the bot.
    wasMentioned: isGroup ? wasZaloBotMentioned(body, params.botNames ?? []) : true,
    timestampMs,
    replyTo: chatId,
    ...(isGroup ? { conversationLabel: `group:${chatId}` } : {}),
    ...(slash === undefined
      ? { kind: "message" as ChannelInboundKind }
      : { kind: "command" as ChannelInboundKind, facts: { command: slash } }),
  };
}
