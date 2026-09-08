// upstream: src/plugin-sdk/text-utility-runtime.ts@5d8067a4483
// Focused low-level text/runtime helpers used by bundled plugins.

export { sliceUtf16Safe, truncateUtf16Safe } from "../normalization-core/utf16-slice.js";
// D-CORE-214: the upstream barrel also re-exports `runChannelProbe`, the
// tool-result text budget helpers, the CJK char estimator and the whole
// `src/utils.ts` surface (config dir/home resolution, fs helpers, timers).
// Those reach OpenClaw's host filesystem and agent runtime; the UTF-16 slice
// helpers the ported Slack truncation/presentation files read come from the
// same `normalization-core` source upstream re-exports. See upstream-sync.json.

import type { BaseProbeResult } from "../channels/plugins/channel-contract.host-adapter.js";

// Slice 10b addition (Slack probe port): upstream declares `runChannelProbe` in
// this barrel; it is carried with its body. `withTimeout` is the local timeout
// wrapper (upstream imports it from `src/utils/timeout.ts`).
type ChannelProbeResult = BaseProbeResult & { elapsedMs?: number };


async function withProbeTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return await promise;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runChannelProbe<
  TResult extends ChannelProbeResult,
  TErrorResult extends ChannelProbeResult = never,
>(
  timeoutMs: number | undefined,
  run: (context: { startedAt: number; elapsedMs: () => number }) => Promise<TResult>,
  onError?: (error: unknown) => TErrorResult,
): Promise<(TResult | TErrorResult) & { elapsedMs: number }> {
  const startedAt = Date.now();
  const elapsedMs = () => Date.now() - startedAt;
  const finish = <T extends ChannelProbeResult>(result: T) => ({
    ...result,
    elapsedMs: result.elapsedMs ?? elapsedMs(),
  });
  try {
    return finish(await withProbeTimeout(run({ startedAt, elapsedMs }), timeoutMs ?? 0));
  } catch (error) {
    if (!onError) {
      throw error;
    }
    return finish(onError(error));
  }
}

// Slice 13 addition (Discord vertical port): the ported Discord probe bounds its
// token/intents lookups with the shared fetch timeout helper.
export { fetchWithTimeout } from "../utils/fetch-timeout.js";

// Slice 14 addition (Google Chat vertical port): upstream's barrel exports
// `resolveUserPath` from `src/utils.ts`; the ported Google Chat credential-file
// readers call it by that name.
export { resolveUserPath } from "../utils.host-adapter.js";


// Slice 15 addition (Feishu vertical port): the ported Feishu message-content
// builder escapes user text before it lands in a Lark post/card node. Same
// upstream barrel, same source module (`src/shared/html-escape.ts`).
export { escapeHtml } from "../shared/html-escape.js";

// Slice 17 addition (Zalo Personal vertical port): the ported `zalo-js.ts` QR
// poll loop sleeps between status checks. Same upstream barrel, same source
// module (`src/utils/sleep.ts`).
export { sleep } from "../utils/sleep.js";
