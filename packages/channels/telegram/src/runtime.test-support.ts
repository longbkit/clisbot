// upstream: extensions/telegram/src/runtime.test-support.ts@5d8067a4483
// Telegram test support owns cleanup for process-global plugin state.
//
// Adapted at one line: upstream clears the plugin runtime through OpenClaw's
// `createPluginRuntimeStore` slot; Fusion's runtime is the per-account map in
// `./runtime.ts` (D-TG-028), so `clearTelegramRuntimeForTest` clears that slot.
// The global-state resets below are upstream's, over the same `Symbol.for` keys
// the ported caches use. Only the resets Fusion's ported modules can produce are
// carried; upstream's polling-lease / reply-fence / ingress resets have no local
// producer yet.
import { setTelegramRuntime } from "./runtime.js";

const TELEGRAM_ACCOUNT_THROTTLERS_KEY = Symbol.for("openclaw.telegram.accountThrottlers");
const TELEGRAM_SENT_MESSAGES_STATE_KEY = Symbol.for("openclaw.telegramSentMessagesState");
const TELEGRAM_TOPIC_NAME_CACHE_STATE_KEY = Symbol.for("openclaw.telegramTopicNameCacheState");

function clearMapState(key: symbol): void {
  const globalRecord = globalThis as Record<PropertyKey, unknown>;
  const value = globalRecord[key];
  if (value instanceof Map) {
    value.clear();
  }
}

export function clearTelegramRuntimeForTest(accountId = ""): void {
  setTelegramRuntime(undefined, accountId);
}

export function resetTelegramAccountThrottlersForTest(): void {
  clearMapState(TELEGRAM_ACCOUNT_THROTTLERS_KEY);
}

export function resetTelegramSentMessageCacheForTest(): void {
  const globalRecord = globalThis as Record<PropertyKey, unknown>;
  delete globalRecord[TELEGRAM_SENT_MESSAGES_STATE_KEY];
}

export function resetTelegramTopicNameCacheForTest(): void {
  const globalRecord = globalThis as Record<PropertyKey, unknown>;
  delete globalRecord[TELEGRAM_TOPIC_NAME_CACHE_STATE_KEY];
}
