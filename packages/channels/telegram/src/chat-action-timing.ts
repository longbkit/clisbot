// upstream: extensions/telegram/src/chat-action-timing.ts@5d8067a4483
// Telegram typing expires after five seconds; renew before that without
// fighting the account-scoped sendChatAction coalescing window.
export const TELEGRAM_CHAT_ACTION_INTERVAL_MS = 4_000;
