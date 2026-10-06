// Fusion drive-surface bridge onto the ported WhatsApp send path (D-WA-028).
//
// `plugin.outbound.*` is the Hub's contract (`@clisbot/channels-shared`); this
// file is the only place that translates between it and upstream's
// `send.ts`. Every wire decision lives in the ported source: markdown →
// WhatsApp formatting, the 4000-character chunking, outbound @mentions in
// groups, media preparation (image/video/audio/document), the receipt, and the
// lookup of the account's live socket through its connection controller.
//
// WhatsApp has no threads; a reply is a quote, so `threadId` is ignored. With
// `replyToMode` on, an answer quotes the message it answers (`fusion/quotes.ts`,
// D-WA-031); an explicit `replyToId` is quoted always. The quoted key is built
// from upstream's inbound cache exactly as upstream's `outbound-base.ts`
// `resolveQuotedMessageKey` builds it.
import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { HostRuntime, SendMediaFn, SendTextFn } from "@clisbot/channels-shared";
import type { OpenClawConfig } from "@clisbot/channels-core/plugin-sdk/config-contracts";
import { resolveWhatsAppAccount } from "./accounts.js";
import { mergeAccountCarrier } from "./fusion/account-config.js";
import { takeWhatsAppQuote } from "./fusion/quotes.js";
import { whatsappTyping } from "./fusion/typing.js";
import {
  openWhatsAppCardStore,
  planReactionCard,
  reactionLegend,
  type CardButton,
} from "./fusion/reaction-cards.js";
import { accountHostRuntime } from "./runtime-store.js";
import { lookupInboundMessageMetaForTarget, type WhatsAppQuotedMessageKey } from "./quoted-message.js";
import { sendMessageWhatsApp, sendTypingWhatsApp } from "./send.js";
import { toWhatsappJid } from "./text-runtime.js";

/** Upstream `channel-outbound.ts` `textChunkLimit`. */
export const WHATSAPP_TEXT_CHUNK_LIMIT = 4000;

function driveCfg(args: Record<string, unknown>): OpenClawConfig {
  return mergeAccountCarrier(
    args["cfg"] as OpenClawConfig,
    String(args["accountId"] ?? ""),
    args["account"] as Record<string, unknown> | undefined,
  );
}

function deliveryReporter(args: { onDeliveryResult?: () => void }) {
  return args.onDeliveryResult === undefined ? {} : { onDeliveryResult: () => args.onDeliveryResult?.() };
}

/** Upstream `outbound-base.ts` `resolveQuotedMessageKey`, verbatim in body. */
function resolveQuotedMessageKey(params: {
  accountId: string;
  to: string;
  replyToId?: string | null;
}): WhatsAppQuotedMessageKey | undefined {
  const replyToId = params.replyToId?.trim();
  if (!replyToId) {
    return undefined;
  }
  const targetJid = toWhatsappJid(params.to);
  const cachedMeta = lookupInboundMessageMetaForTarget(params.accountId, targetJid, replyToId);
  return {
    id: replyToId,
    remoteJid: cachedMeta?.remoteJid ?? targetJid,
    fromMe: cachedMeta?.fromMe ?? false,
    participant: cachedMeta?.participant,
    ...(cachedMeta && cachedMeta.remoteJid !== targetJid ? { lookupTargetJid: targetJid } : {}),
    messageText: cachedMeta?.body,
    media: cachedMeta?.media,
  };
}

/**
 * The quote for this post. `replyToMode` is upstream's switch and default:
 * `off` (the default) never quotes; `first` quotes the answer's first chunk,
 * `all` every chunk, `batched` like `first` here (the Hub's batching already
 * made one prompt). The quoted message is the one being answered, or an
 * explicit `replyToId`, which upstream honours whatever the mode.
 */
function quoteFor(args: Record<string, unknown>, cfg: OpenClawConfig) {
  const accountId = String(args["accountId"] ?? "");
  const to = String(args["to"]);
  const pendingId = takeWhatsAppQuote(accountId, toWhatsappJid(to));
  const explicitId = typeof args["replyToId"] === "string" ? args["replyToId"] : undefined;
  const replyToMode = resolveWhatsAppAccount({ cfg, accountId }).replyToMode ?? "off";
  const replyToId = explicitId ?? (replyToMode === "off" ? undefined : pendingId);
  const quotedMessageKey = resolveQuotedMessageKey({ accountId, to, replyToId });
  if (!quotedMessageKey) return {};
  return {
    quotedMessageKey,
    replyToMode: replyToMode === "off" ? "first" : replyToMode,
    ...(explicitId === undefined ? {} : { replyToIdSource: "explicit" as const }),
  };
}

/**
 * `plugin.outbound.sendText` — the Hub's final-answer post. `to` is a chat jid
 * (`…@g.us`, `…@s.whatsapp.net`, `…@lid`) or an E.164 number, the forms the
 * ported `toWhatsappJid` accepts. Long answers post as several messages; the
 * returned id is the last one's, as upstream's `sendMessageWhatsApp` returns.
 */
export const sendText: SendTextFn = async (args) => {
  const cfg = driveCfg(args);
  const buttons = Array.isArray(args["cardButtons"]) ? (args["cardButtons"] as CardButton[]) : [];
  const choices = buttons.length > 0 ? planReactionCard(buttons) : undefined;
  const text = choices ? `${String(args.text)}\n\n${reactionLegend(choices)}` : String(args.text);
  const result = await sendMessageWhatsApp(String(args.to), text, {
    verbose: false,
    cfg,
    accountId: String(args.accountId ?? ""),
    ...quoteFor(args, cfg),
    ...deliveryReporter(args),
  });
  if (choices) {
    // An approval or question prompt: a reaction on it answers it (D-WA-032).
    const hostRuntime = accountHostRuntime(
      String(args.accountId ?? ""),
      args["hostRuntime"] as HostRuntime | undefined,
    );
    await openWhatsAppCardStore(hostRuntime).register(result.messageId, {
      chatJid: result.toJid,
      choices,
    });
  }
  return { messageId: result.messageId, to: result.toJid, ...(choices ? { cardPosted: true } : {}) };
};

/**
 * `plugin.outbound.sendMedia` — a native upload: images, videos and documents
 * post as WhatsApp media, audio as a voice note. The Hub stages the file under a
 * temporary name and passes the name and type the agent asked for
 * (`fileName`, `mimeType`); with a name or type the file is handed
 * to upstream as its `mediaPayload` so a document keeps its real name. Without
 * them the path is read through the ported media loader, with
 * `mediaLocalRoots` pinned to the file's own directory so nothing else on the
 * box is reachable. Audio always posts as a voice note (upstream's rule), so the
 * Hub's `asVoice` changes nothing here.
 */
export const sendMedia: SendMediaFn = async (args) => {
  const filePath = String(args.filePath);
  const fileName = typeof args["fileName"] === "string" ? args["fileName"] : undefined;
  const mimeType = typeof args["mimeType"] === "string" ? args["mimeType"] : undefined;
  const media =
    fileName !== undefined || mimeType !== undefined
      ? {
          mediaPayload: {
            buffer: await readFile(filePath),
            fileName: fileName ?? basename(filePath),
            ...(mimeType === undefined ? {} : { contentType: mimeType }),
          },
        }
      : { mediaUrl: filePath, mediaLocalRoots: [dirname(filePath)] };
  const result = await sendMessageWhatsApp(
    String(args.to),
    typeof args["text"] === "string" ? args["text"] : "",
    {
      verbose: false,
      cfg: driveCfg(args),
      accountId: String(args.accountId ?? ""),
      ...media,
      // Upstream's delivery options: an image/video as a document (no
      // recompression), a video as an animated GIF.
      ...(args["forceDocument"] === true ? { forceDocument: true } : {}),
      ...(args["gifPlayback"] === true ? { gifPlayback: true } : {}),
      ...deliveryReporter(args),
    },
  );
  return { messageId: result.messageId, mediaPosted: true, to: result.toJid };
};

/** The `sync.progress` liveness surface: "typing…" for the whole turn (`fusion/typing.ts`). */
export async function sendTyping(args: Record<string, unknown>): Promise<void> {
  const to = String(args["to"]);
  const accountId = String(args["accountId"] ?? "");
  await whatsappTyping({
    accountId,
    to,
    action: args["action"] === "stop" ? "stop" : "start",
    // An older Hub sent no `indicator`: it asked for typing by calling at all.
    indicator: args["indicator"] !== false,
    compose: () => sendTypingWhatsApp(to, { cfg: driveCfg(args), accountId }),
  });
}
