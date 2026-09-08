// upstream: extensions/telegram/src/retry-after.ts@5d8067a4483
// Matches draft preview suspension: final Telegram replies should wait through routine flood windows.
export const TELEGRAM_OUTBOUND_RETRY_AFTER_CAP_MS = 60_000;
