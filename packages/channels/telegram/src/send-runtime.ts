// upstream: extensions/telegram/src/send-runtime.ts@5d8067a4483
import { createLazyRuntimeModule } from "@getpaseo/channels-core/plugin-sdk/lazy-runtime";
// Telegram plugin module owns the lazy send runtime import.
export type TelegramSendModule = typeof import("./send.js");

export const loadTelegramSendModule = createLazyRuntimeModule(() => import("./send.js"));
