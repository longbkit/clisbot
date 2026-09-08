// The drive surface (blueprint §6.5 hard rule 2, B3-immutable): the pinned
// export name `telegramPlugin` carrying `gateway.startAccount` +
// `outbound.sendText`. The Hub loader imports this chunk and drives it.
//
// Beyond the two Hub-read members, `outbound` exposes the ported OpenClaw send
// primitives by their upstream names so the message-action runner (goal ledger
// slice 11) can dispatch every native action without re-deriving a send path.

import type { ChannelPlugin, HostRuntime } from "@getpaseo/channels-shared";
import { resolveTelegramConversation } from "./conversation-metadata.js";
import { startTelegramAccount } from "./lifecycle/start-account.js";
import { getHostRuntime } from "./runtime-store.js";
import { disposeTelegramRuntime } from "./fusion/runtime.js";
import { sendMedia, sendText, updateText } from "./outbound.js";
import { TELEGRAM_PRESENTATION_CAPABILITIES } from "./presentation-outbound.js";
import { telegramMessageActions } from "./channel-actions.js";
import { telegramTyping } from "./typing.js";
import { buildInlineKeyboard } from "./inline-keyboard.js";
import { createTelegramDraftStream } from "./draft-stream.js";
import { resolveTelegramDraftStreamingChunking } from "./draft-chunking.js";
import { createTelegramSendChatActionHandler } from "./sendchataction-401-backoff.js";
import {
  buildTelegramStatusReactionVariants,
  resolveTelegramReactionVariant,
  resolveTelegramStatusReactionEmojis,
} from "./status-reaction-variants.js";
import {
  deliverTelegramTextPage,
  planTelegramTextDeliveryPages,
  sendTelegramTextPageParts,
} from "./telegram-text-delivery.js";
import {
  createForumTopicTelegram,
  deleteMessageTelegram,
  editForumTopicTelegram,
  editMessageReplyMarkupTelegram,
  editMessageTelegram,
  getTelegramAllowedReactions,
  pinMessageTelegram,
  reactMessageTelegram,
  renameForumTopicTelegram,
  sendLocationTelegram,
  sendMessageTelegram,
  sendPollTelegram,
  sendStickerTelegram,
  sendTypingTelegram,
  unpinMessageTelegram,
} from "./send.js";

export const telegramPlugin: ChannelPlugin = {
  directory: { resolveConversation: resolveTelegramConversation },
  /** Message-tool discovery, schema contributions and target aliases (slice 11 dispatches). */
  actions: telegramMessageActions,
  gateway: {
    startAccount: (ctx) =>
      startTelegramAccount(
        ctx,
        (ctx["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime(),
      ),
  },
  /** The Hub's loader calls this when it unloads this account's vertical: it
   * releases the account's ported plugin runtime (keyed stores, log sink), which
   * the loader's own registries do not own. */
  disposeAccount: (accountId: string) => {
    disposeTelegramRuntime(accountId);
  },
  outbound: {
    // Upstream declares the vertical's presentation limits on its outbound
    // adapter and core reads them to decide who renders a portable
    // presentation. Same spelling here, so the Hub — which drives `sendText`
    // (`presentation-outbound.ts`) — stops flattening charts and tables into
    // fallback text before the vertical sees them (D-W6-01, D-TG-057). The
    // declaration is the vertical's maximum; the posting account's own limits
    // are resolved per send, where the cfg and the account id exist.
    presentationCapabilities: TELEGRAM_PRESENTATION_CAPABILITIES,
    sendText,
    // COMPAT(clisbot-control-plane): the approval card's in-place update
    // (`editMessageText`); the Hub's approval engine decides against it.
    updateText,
    // COMPAT(clisbot-control-plane): the G7–G11 native-media post.
    sendMedia,
    // COMPAT(clisbot-control-plane): the `sync.progress` liveness surface.
    typing: async (args: Record<string, unknown>) => {
      await telegramTyping(args as never);
    },
    // The ported OpenClaw send primitives, by their upstream names. The
    // message-action runner slice dispatches `message` tool actions onto these.
    sendMessageTelegram,
    editMessageTelegram,
    editMessageReplyMarkupTelegram,
    deleteMessageTelegram,
    reactMessageTelegram,
    getTelegramAllowedReactions,
    pinMessageTelegram,
    unpinMessageTelegram,
    sendTypingTelegram,
    sendPollTelegram,
    sendStickerTelegram,
    sendLocationTelegram,
    createForumTopicTelegram,
    editForumTopicTelegram,
    renameForumTopicTelegram,
    buildInlineKeyboard,
    // Slice 22 (streaming/progress): the ported OpenClaw draft/progress
    // primitives, by their upstream names. `createTelegramDraftStream` owns the
    // edit-in-place draft (throttle, chunk rotation, finalize, plain-text
    // fallback and the rate-limit/`message is not modified` ladder);
    // `resolveTelegramDraftStreamingChunking` reads the per-account preview
    // chunk policy; the `telegram-text-delivery` trio is the page planner the
    // draft and the final send share, so a streamed draft finalizes onto the
    // same chunk boundaries the non-streamed send would have produced.
    createTelegramDraftStream,
    resolveTelegramDraftStreamingChunking,
    planTelegramTextDeliveryPages,
    sendTelegramTextPageParts,
    deliverTelegramTextPage,
    // Status reactions (the progress cue that costs no message) and the
    // typing keepalive's 401 backoff handler.
    resolveTelegramStatusReactionEmojis,
    buildTelegramStatusReactionVariants,
    resolveTelegramReactionVariant,
    createTelegramSendChatActionHandler,
  },
};

export { startTelegramAccount } from "./lifecycle/start-account.js";
export { sendMedia, sendText, updateText } from "./outbound.js";
