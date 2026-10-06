// Fusion-owned inbound normalizer (D-WA-022).
//
// Upstream hands an admitted message to its own dispatcher
// (`inbound/message-delivery.ts` → `auto-reply/monitor/*`), which runs mention
// gating, history, the agent and the reply pipeline. The Hub owns all of that,
// so this module only maps the facts upstream's own readers already produced —
// the normalizer's identity/group facts (`inbound/message-normalization.ts`) and
// the enrichment's text, media and mentions (`inbound/message-enrichment.ts`) —
// onto the channel-agnostic `ChannelInboundEvent` the shared L3 monitor admits.
//
// Mapping decisions the Hub reads:
//
//  * Conversation — the chat jid exactly as WhatsApp addressed it
//    (`…@g.us` for a group; `…@s.whatsapp.net` or `…@lid` for a DM). The reply
//    goes back to the same jid, which the ported send path accepts as is.
//  * Sender — the E.164 number when WhatsApp exposes one (stable, and what a
//    person recognizes when linking an identity), else the participant jid.
//  * `wasMentioned` — a DM is addressed by construction. In a group it is
//    upstream's identity rule: a mentioned jid, or the author of the quoted
//    message, overlaps the linked account's own identity (jid, LID or E.164).
//    Upstream's agent-name regexes are mention POLICY and stay with the Hub.
//  * Media — a downloaded attachment is listed in the shared `[Attached files]`
//    manifest folded into the body, the same agent reference every vertical uses.
//    A quoted message's file is downloaded the same way (upstream enrichment).
//  * Reply context — a message that quotes another starts with
//    `[Reply to <sender>] <quoted text>`, the label the Telegram vertical uses
//    (`TELEGRAM_BODY_LABELS.replyTo`), so the agent reads what is being answered.
//    The quoted text is upstream's own reading (`describeReplyContext`).
//  * Structured objects — a shared location's name/address/caption, shared
//    contacts and ad-reply context follow the text as upstream's labelled,
//    fence-neutralized JSON blocks (`formatContextJsonBlock`, the shape
//    upstream's `inbound-meta.ts` gives the agent); the coordinates stay in the
//    text, as upstream renders them.
//  * `kind` — a leading `/verb` (after any leading @mentions) is a command.
import path from "node:path";
import type { WAMessage } from "baileys";
import {
  formatContextJsonBlock,
  markInboundContextLabel,
} from "@clisbot/channels-core/plugin-sdk/channel-inbound";
import {
  buildAttachedFilesManifest,
  foldAttachedFilesIntoBody,
  readSlashCommand,
  type ChannelInboundEvent,
  type InboundAttachedFile,
} from "@clisbot/channels-shared";
import {
  identitiesOverlap,
  resolveComparableIdentity,
  type WhatsAppSelfIdentity,
} from "../identity.js";
import type { WhatsAppEnrichedInboundMessage } from "../inbound/message-enrichment.js";
import type { WhatsAppNormalizedInboundMessage } from "../inbound/message-normalization.js";

export type WhatsAppInboundSkip = "no-message-id" | "empty-body";

/** Body labels shared with the Telegram vertical (`TELEGRAM_BODY_LABELS`). */
export const WHATSAPP_BODY_LABELS = {
  replyTo: "[Reply to",
  pollAnswer: "[Poll answer]",
} as const;

const REPLY_SNIPPET_CHARS = 200;

export type WhatsAppInboundBuild =
  | { admit: true; event: ChannelInboundEvent }
  | { admit: false; reason: WhatsAppInboundSkip };

/** Upstream's identity rule for "this message addresses the linked account". */
export function wasWhatsAppAddressed(params: {
  group: boolean;
  self: WhatsAppSelfIdentity;
  mentionedJids?: readonly string[];
  replySender?: { jid?: string | null; lid?: string | null; e164?: string | null } | null;
}): boolean {
  if (!params.group) return true;
  const self = resolveComparableIdentity(params.self);
  for (const jid of params.mentionedJids ?? []) {
    if (identitiesOverlap(self, resolveComparableIdentity({ jid }))) return true;
  }
  return params.replySender ? identitiesOverlap(self, params.replySender) : false;
}

/** Who wrote the quoted message, as the agent should read it. */
function replySenderLabel(
  sender: { jid?: string | null; lid?: string | null; e164?: string | null; label?: string | null } | null | undefined,
  self: WhatsAppSelfIdentity,
): string {
  if (!sender) return "message";
  if (identitiesOverlap(resolveComparableIdentity(self), sender)) return "you";
  return sender.label ?? sender.e164 ?? sender.jid ?? sender.lid ?? "someone";
}

/** `[Reply to <sender>] <snippet>` for a message that quotes another. */
export function replyContextLine(
  reply: WhatsAppEnrichedInboundMessage["replyContext"],
  self: WhatsAppSelfIdentity,
): string | undefined {
  if (!reply) return undefined;
  const text = reply.body.trim();
  const snippet = text.length > REPLY_SNIPPET_CHARS ? `${text.slice(0, REPLY_SNIPPET_CHARS)}…` : text;
  return `${WHATSAPP_BODY_LABELS.replyTo} ${replySenderLabel(reply.sender, self)}] ${snippet}`.trimEnd();
}

/** Upstream `inbound-meta.ts` `buildLocationContextPayload`, from the enriched location. */
function locationContextPayload(
  location: WhatsAppEnrichedInboundMessage["location"],
): Record<string, unknown> | undefined {
  if (!location) return undefined;
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy_m: Number.isFinite(location.accuracy) ? location.accuracy : undefined,
    source: location.source,
    is_live: location.isLive === true ? true : undefined,
    name: location.name,
    address: location.address,
    caption: location.caption,
  };
}

/** The structured objects upstream hands the agent as labelled JSON blocks. */
export function structuredContextBlocks(enriched: WhatsAppEnrichedInboundMessage): string[] {
  const blocks: string[] = [];
  const location = locationContextPayload(enriched.location);
  if (location) blocks.push(formatContextJsonBlock(markInboundContextLabel("Location:"), location));
  const entries = [
    enriched.contactContext
      ? { label: "WhatsApp contact", type: enriched.contactContext.kind, payload: enriched.contactContext }
      : undefined,
    enriched.externalAdReplyContext
      ? { label: "WhatsApp external ad reply", type: "external_ad_reply", payload: enriched.externalAdReplyContext }
      : undefined,
  ];
  for (const entry of entries) {
    if (!entry) continue;
    blocks.push(
      formatContextJsonBlock(markInboundContextLabel(`${entry.label}:`), {
        source: "whatsapp",
        type: entry.type,
        payload: entry.payload,
      }),
    );
  }
  return blocks;
}

/** The body a command is read from: leading `@mention` tokens dropped. */
function commandCandidate(body: string): string {
  return body.replace(/^(?:@\S+\s+)+/u, "").trim();
}

function attachedFile(enriched: WhatsAppEnrichedInboundMessage): InboundAttachedFile[] {
  if (!enriched.mediaPath) return [];
  return [
    {
      name: enriched.mediaFileName ?? path.basename(enriched.mediaPath),
      kind: enriched.mediaKind ?? "document",
      bytes: 0,
      path: enriched.mediaPath,
    },
  ];
}

export function buildWhatsAppInboundEvent(params: {
  msg: WAMessage;
  inbound: WhatsAppNormalizedInboundMessage;
  enriched: WhatsAppEnrichedInboundMessage;
  self: WhatsAppSelfIdentity;
  /** Sizes of the saved media files, keyed by path (the manifest shows them). */
  mediaBytes?: (filePath: string) => number;
}): WhatsAppInboundBuild {
  const { msg, inbound, enriched } = params;
  const messageId = msg.key?.id?.trim();
  if (!messageId) return { admit: false, reason: "no-message-id" };
  const files = attachedFile(enriched).map((file) => ({
    ...file,
    bytes: params.mediaBytes?.(file.path) ?? file.bytes,
  }));
  const text = enriched.body.trim();
  const withFiles =
    files.length > 0 ? foldAttachedFilesIntoBody(text, buildAttachedFilesManifest(files)) : text;
  if (withFiles.trim() === "") return { admit: false, reason: "empty-body" };
  const replyLine = replyContextLine(enriched.replyContext, params.self);
  const blocks = structuredContextBlocks(enriched);
  const withContext = blocks.length === 0 ? withFiles : `${withFiles}\n\n${blocks.join("\n\n")}`;
  const body = replyLine === undefined ? withContext : `${replyLine}\n${withContext}`;
  const senderId = inbound.senderE164 ?? inbound.participantJid ?? inbound.from;
  const slash = readSlashCommand(commandCandidate(enriched.commandBody));
  const event: ChannelInboundEvent = {
    channel: "whatsapp",
    // A message id is unique per chat, not globally, so the chat jid is part of
    // the in-flight key (upstream's durable id hashes the same pair).
    externalEventId: `${inbound.remoteJid}/${messageId}`,
    externalMessageId: messageId,
    externalConversationId: inbound.remoteJid,
    chatType: inbound.group ? "group" : "direct",
    senderId,
    ...(msg.pushName ? { senderName: msg.pushName } : {}),
    body,
    wasMentioned: wasWhatsAppAddressed({
      group: inbound.group,
      self: params.self,
      ...(enriched.mentionedJids ? { mentionedJids: enriched.mentionedJids } : {}),
      replySender: enriched.replyContext?.sender ?? null,
    }),
    timestampMs: inbound.messageTimestampMs ?? Date.now(),
    replyTo: inbound.remoteJid,
    ...(inbound.group && inbound.groupSubject ? { conversationLabel: inbound.groupSubject } : {}),
    isOwnMessage: Boolean(msg.key?.fromMe) && inbound.group,
    ...(slash === undefined
      ? { kind: "message" as const }
      : { kind: "command" as const, facts: { command: slash } }),
  };
  return { admit: true, event };
}

/** A decoded vote → `poll_answer` event (recorded by the Hub, never a turn). */
export function buildWhatsAppPollAnswerEvent(params: {
  msg: WAMessage;
  vote: { pollId: string; chatJid: string; question: string; optionIds: number[]; optionNames: string[] };
  voterId: string;
  group: boolean;
}): WhatsAppInboundBuild {
  const messageId = params.msg.key?.id?.trim();
  if (!messageId) return { admit: false, reason: "no-message-id" };
  const chosen = params.vote.optionNames.length > 0 ? params.vote.optionNames.join(", ") : "(vote removed)";
  return {
    admit: true,
    event: {
      channel: "whatsapp",
      externalEventId: `${params.vote.chatJid}/${messageId}`,
      externalMessageId: messageId,
      externalConversationId: params.vote.chatJid,
      chatType: params.group ? "group" : "direct",
      senderId: params.voterId,
      ...(params.msg.pushName ? { senderName: params.msg.pushName } : {}),
      body: `${WHATSAPP_BODY_LABELS.pollAnswer} ${params.vote.question}: ${chosen}`,
      wasMentioned: false,
      timestampMs: Date.now(),
      replyTo: params.vote.chatJid,
      kind: "poll_answer",
      facts: {
        pollAnswer: { pollId: params.vote.pollId, optionIds: params.vote.optionIds, voterId: params.voterId },
      },
    },
  };
}

/** A reaction on an approval/question card → the button's `callback` (D-WA-032). */
export function buildWhatsAppCardCallbackEvent(params: {
  msg: WAMessage;
  cardMessageId: string;
  chatJid: string;
  choice: { label: string; value: string };
  actorId: string;
}): WhatsAppInboundBuild {
  const messageId = params.msg.key?.id?.trim();
  if (!messageId) return { admit: false, reason: "no-message-id" };
  return {
    admit: true,
    event: {
      channel: "whatsapp",
      externalEventId: `${params.chatJid}/${messageId}`,
      externalMessageId: messageId,
      externalConversationId: params.chatJid,
      chatType: params.chatJid.endsWith("@g.us") ? "group" : "direct",
      senderId: params.actorId,
      ...(params.msg.pushName ? { senderName: params.msg.pushName } : {}),
      body: `[Button] ${params.choice.label}`,
      wasMentioned: true,
      timestampMs: Date.now(),
      replyTo: params.chatJid,
      kind: "callback",
      facts: {
        callback: {
          actionId: "whatsapp-reaction",
          value: params.choice.value,
          actorId: params.actorId,
          messageId: params.cardMessageId,
        },
      },
    },
  };
}
