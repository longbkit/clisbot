// @getpaseo/channels-telegram — the in-repo Telegram channel vertical
// (blueprint §6.5). Exports:
// - `default` — the bundled-channel entry (`id: "telegram"`);
// - `telegramPlugin` — the pinned drive-surface name (startAccount + sendText);
// - the layer modules for targeted tests.

export { default } from "./entry.js";
export { entry } from "./entry.js";
export { telegramPlugin, sendText, sendMedia, updateText, startTelegramAccount } from "./plugin.js";
export { installTelegramRuntime } from "./fusion/runtime.js";
export * from "./send.js";
export { telegramMessageActions } from "./channel-actions.js";
export { setChannelHostRuntime, getHostRuntime, registerAccountInbound } from "./runtime-store.js";
export * from "./client/bot-api.js";
export * from "./transport/media.js";
export * from "./fusion/inbound-adapter.js";
export * from "./fusion/polling-session.js";
export * from "./fusion/webhook-session.js";
export * from "./fusion/admission.js";
export { createTelegramMessageCache } from "./message-cache.js";
export {
  readBotInfoCache,
  writeBotInfoCache,
  assertNoDuplicateTelegramTokens,
  probeTelegramBotInfo,
  withTelegramStartupProbeSlot,
  telegramTokenFingerprint,
} from "./lifecycle/start-account.js";
export * from "./leaves/telegram-policy.js";
export * from "./leaves/coerce.js";
export * from "./leaves/rich-message.js";
export { createTelegramDraftStream } from "./draft-stream.js";
export { resolveTelegramDraftStreamingChunking } from "./draft-chunking.js";
export * from "./telegram-text-delivery.js";
export * from "./status-reaction-variants.js";
