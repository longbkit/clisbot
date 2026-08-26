// @getpaseo/channels-telegram — the in-repo Telegram channel vertical
// (blueprint §6.5). Exports:
// - `default` — the bundled-channel entry (`id: "telegram"`);
// - `telegramPlugin` — the pinned drive-surface name (startAccount + sendText);
// - the layer modules for targeted tests.

export { default } from "./entry.js";
export { entry } from "./entry.js";
export { telegramPlugin, sendText, startTelegramAccount } from "./plugin.js";
export { setChannelHostRuntime, getHostRuntime, registerAccountInbound } from "./runtime-store.js";
export * from "./client/bot-api.js";
export * from "./client/sent-messages.js";
export * from "./transport/poll.js";
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
