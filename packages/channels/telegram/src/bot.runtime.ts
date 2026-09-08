// upstream: extensions/telegram/src/bot.runtime.ts@5d8067a4483
// Telegram plugin module implements bot behavior.
import { apiThrottler as apiThrottlerRaw } from "@grammyjs/transformer-throttler";
import type { Transformer } from "grammy";

export { sequentialize } from "@grammyjs/runner";
export { Bot } from "grammy";
export type { ApiClientOptions } from "grammy";

// D-TG-023: `@grammyjs/transformer-throttler` declares `grammy: ^1.0.0`, so npm
// resolves it against the hoisted grammy while this package pins 1.46.0. The two
// `Transformer` declarations are structurally identical but nominally distinct,
// so the factory is re-typed against the pinned grammy here. Runtime behavior is
// the upstream throttler, unchanged.
export const apiThrottler = apiThrottlerRaw as unknown as (
  options?: Parameters<typeof apiThrottlerRaw>[0],
) => Transformer;
