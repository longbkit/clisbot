// upstream: extensions/telegram/src/fetch.ts@5d8067a4483
// D-TG-013: the transport is a Fusion boundary. Upstream's `fetch.ts` is ~860
// lines wired to `openclaw/plugin-sdk/fetch-runtime` — the SSRF guard, the
// pinned dispatcher pool, `proxy-env`, the undici global dispatcher and the
// proxy-capture debug harness (~11k lines under `src/infra/net/`). Fusion owns
// its own fetch stack, so this module keeps upstream's `TelegramTransport`
// shape and `resolveTelegramTransport` signature over a plain undici/global
// fetch: DNS ordering and IPv4 fallback are host concerns here. Callers'
// lifecycle contract is unchanged — `close()` is idempotent and a
// caller-supplied `proxyFetch` owns its own dispatcher.
import type { TelegramNetworkConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import {
  resolveTelegramAutoSelectFamilyDecision,
  resolveTelegramDnsResultOrderDecision,
} from "./network-config.js";

export type TelegramDispatcherAttempt = {
  label: string;
  error?: unknown;
};

export type TelegramTransport = {
  fetch: typeof fetch;
  sourceFetch: typeof fetch;
  dispatcherAttempts?: TelegramDispatcherAttempt[];
  /**
   * Promote this transport to its next fallback dispatcher before the next
   * request. Fusion has a single dispatcher, so there is no fallback path.
   */
  forceFallback?: (reason: string, err?: unknown) => boolean;
  /**
   * Release the dispatchers owned by this transport. Safe to call repeatedly;
   * a caller-supplied `proxyFetch` owns its own dispatcher, so this is a no-op
   * for that case.
   */
  close: () => Promise<void>;
};

/** Builds the transport a Telegram Bot API client sends through. */
export function resolveTelegramTransport(
  proxyFetch?: typeof fetch,
  options?: { network?: TelegramNetworkConfig },
): TelegramTransport {
  // The decisions are still resolved so the account's network config keeps its
  // documented meaning and shows up in diagnostics.
  void resolveTelegramAutoSelectFamilyDecision({ network: options?.network });
  void resolveTelegramDnsResultOrderDecision({ network: options?.network });
  const sourceFetch = proxyFetch ?? globalThis.fetch;
  let closed = false;
  return {
    fetch: sourceFetch,
    sourceFetch,
    dispatcherAttempts: [],
    forceFallback: () => false,
    close: async () => {
      closed = true;
      void closed;
    },
  };
}
