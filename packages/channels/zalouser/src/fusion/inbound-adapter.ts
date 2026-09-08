// Fusion-owned inbound normalizer (D-ZU-013).
//
// Upstream's `monitor.ts` turns a `zca-js` message into an OpenClaw agent turn:
// it resolves the route, runs the pairing/allowlist/group policy, builds the
// history window, assembles the OpenClaw `ctxPayload` and calls
// `core.channel.inbound.dispatch`, which owns the agent runtime, the reply
// pipeline, the typing indicator and the delivered/seen acks. The Hub owns
// every one of those, so this module does only the part the Hub cannot: turn
// the ALREADY-NORMALIZED `ZaloInboundMessage` (upstream's own
// `normalizeZaloInboundMessage`, carried verbatim in `zalo-js.ts`) into the
// channel-agnostic `ChannelInboundEvent` the shared L3 monitor admits.
//
// Everything that decides WHAT the message is stays upstream's:
// `normalizeZaloInboundMessage` owns the group/direct split, the
// seconds-vs-milliseconds timestamp rule, the mention extraction
// (`wasExplicitlyMentioned` / `implicitMention` / `canResolveExplicitMention`),
// the mention-stripped `commandContent` and the quote metadata. This module
// only maps those facts onto the shared event.
//
// Two mapping decisions are Fusion's and are stated here because the Hub reads
// them:
//
//   * `wasMentioned` — a DM is addressed by construction. In a group it is
//     upstream's explicit mention, OR the implicit mention (a reply/quote of
//     one of the account's own messages, upstream's `implicitMention`), OR —
//     when the account's own user id could not be resolved and the message
//     carries some `@` mention — upstream's conservative
//     "cannot resolve, assume addressed" fallback, which is exactly what its
//     `commandContent` stripping already assumes.
//   * `kind` — Zalo Personal has no native command surface, so a command is a
//     leading `/verb` line in the MENTION-STRIPPED body, which is what makes
//     "@bot /status" work in a group.

import type { ChannelInboundEvent, ChannelInboundKind } from "@getpaseo/channels-shared";
import { formatZalouserMessageSidFull } from "../message-sid.js";
import type { ZaloInboundMessage } from "../types.js";

/** The account facts the normalizer needs; supplied by the listener session. */
export interface ZalouserInboundParams {
  accountId: string;
  /** The linked account's own Zalo user id (`resolveZaloOwnUserId`). */
  ownUserId?: string;
}

/** Why a well-formed message produced no admissible turn. Never a fault. */
export type ZalouserInboundSkip = "own-message" | "empty-body" | "no-message-id";

export type ZalouserInboundBuild =
  | { admit: true; event: ChannelInboundEvent }
  | { admit: false; reason: ZalouserInboundSkip };

/** A leading `/verb` line. Zalo Personal has no native command surface, so a
 * command is exactly what the text says it is (the same rule the Google Chat
 * and Zalo Official Bot verticals apply). */
function readSlashCommand(body: string): { name: string; args: string } | undefined {
  const match = /^\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/.exec(body.trim());
  const name = match?.[1];
  if (name === undefined) return undefined;
  return { name: name.toLowerCase(), args: (match?.[2] ?? "").trim() };
}

/** Upstream's mention facts, folded into the single boolean the Hub reads. */
export function wasZalouserAddressed(message: ZaloInboundMessage): boolean {
  if (!message.isGroup) return true;
  if (message.wasExplicitlyMentioned === true) return true;
  if (message.implicitMention === true) return true;
  // Upstream cannot match `@name` without the account's own user id; when it
  // could not resolve one it still strips a leading `@mention` for the command
  // body, so treat a mention it cannot attribute as addressed rather than
  // silently dropping the only signal the platform gave.
  return message.hasAnyMention === true && message.canResolveExplicitMention !== true;
}

/**
 * Normalizes one already-parsed inbound message. The `msgId:cliMsgId` pair is
 * the external message id: `addReaction` needs BOTH, so collapsing to `msgId`
 * would make an inbound message un-reactable
 * (`message-sid.ts` `formatZalouserMessageSidFull` owns the spelling and
 * `resolveZalouserReactionMessageIds` parses it back).
 */
export function buildZalouserInboundEvent(
  message: ZaloInboundMessage,
  params: ZalouserInboundParams,
): ZalouserInboundBuild {
  const ownUserId = params.ownUserId?.trim();
  if (ownUserId !== undefined && ownUserId !== "" && message.senderId === ownUserId) {
    return { admit: false, reason: "own-message" };
  }
  const messageId = formatZalouserMessageSidFull({
    msgId: message.msgId,
    cliMsgId: message.cliMsgId,
  });
  if (messageId === undefined) return { admit: false, reason: "no-message-id" };
  const body = (message.commandContent ?? message.content ?? "").trim();
  if (body === "") return { admit: false, reason: "empty-body" };
  const slash = readSlashCommand(body);
  const event: ChannelInboundEvent = {
    channel: "zalouser",
    // zca-js carries no transport-level envelope id, so the message id is both
    // the in-flight key and the ledger key — the same identity upstream's
    // `ingress.ts` keys its durable row on (`data.msgId`).
    externalEventId: messageId,
    externalMessageId: messageId,
    externalConversationId: message.threadId,
    chatType: message.isGroup ? "group" : "direct",
    senderId: message.senderId,
    ...(message.senderName === undefined ? {} : { senderName: message.senderName }),
    body,
    wasMentioned: wasZalouserAddressed(message),
    timestampMs: message.timestampMs,
    replyTo: message.isGroup ? `group:${message.threadId}` : `user:${message.threadId}`,
    ...(message.isGroup && message.groupName !== undefined
      ? { conversationLabel: message.groupName }
      : {}),
    ...(slash === undefined
      ? { kind: "message" as ChannelInboundKind }
      : { kind: "command" as ChannelInboundKind, facts: { command: slash } }),
  };
  return { admit: true, event };
}
