// Fusion-owned L2 transport session (D-ZU-015).
//
// Upstream's equivalent is the `startZaloListener` call inside
// `monitor.ts`'s `monitorZalouserProvider`, plus the ingress monitor it feeds.
// `startZaloListener` itself is carried verbatim in `zalo-js.ts` — the
// self-message filter, the message/error/closed handlers, the 30s watchdog with
// its 35s max gap, the `retryOnClose: false` start, the API invalidation on
// failure and the abort-driven cleanup are all upstream's. What this module
// owns is the part upstream delegated to its own durable queue: the message →
// admission handoff, and the loop lifetime.
//
// THE ONE ADDED RULE — durable admission before the message is let go.
//
// The `zca-js` listener is a push WebSocket with no ack and no cursor: the
// server does not re-serve a message. There is no watermark to hold back, so
// the Telegram invariant ("admit, then advance the offset") becomes "admit
// before the handler returns, and retry in place while it fails". A message
// whose admission fails every attempt is dropped LOUDLY, because the transport
// cannot recover it — that is the honest limit of a QR/session channel, and it
// is why the drop is an error-level line and not a warning.
//
// Handler failures propagate: upstream's `startZaloListener` wraps the
// `onMessage` callback and calls `failListener` on a rejection, which stops the
// listener, invalidates the API session and surfaces the error to the account
// lifecycle. This module keeps that path by NOT swallowing an admission error
// once the retry budget is spent — it swallows only the individual attempt.

import { formatErrorMessage } from "@getpaseo/channels-core/plugin-sdk/error-runtime";
import { sleep } from "@getpaseo/channels-core/plugin-sdk/text-utility-runtime";
import type { HostChildLogger } from "@getpaseo/channels-shared";
import { startZaloListener } from "../zalo-js.js";
import type { Message } from "../zca-client.js";
import { isZalouserAuthenticationFailure, type ZalouserAdmission } from "./admission.js";

/** Admission attempts one message gets before the session drops it. */
export const ZALOUSER_ADMISSION_MAX_ATTEMPTS = 5;
/** Backoff between admission attempts for the same message. */
export const ZALOUSER_ADMISSION_RETRY_DELAY_MS = 500;

export interface ZalouserListenerSessionOptions {
  accountId: string;
  profile: string;
  admission: ZalouserAdmission;
  abortSignal: AbortSignal;
  logger?: HostChildLogger;
  setStatus?: (patch: Record<string, unknown>) => void;
  /** Test seam: the listener starter (defaults to the ported `startZaloListener`). */
  startListener?: typeof startZaloListener;
}

/**
 * Runs until `abortSignal` fires or the listener fails. A listener failure
 * (socket close, watchdog gap, auth loss) REJECTS, so the account lifecycle
 * sees it — upstream's `monitorZalouserProvider` does the same through its
 * `settleFailure` deferred.
 */
export async function startZalouserListenerSession(
  options: ZalouserListenerSessionOptions,
): Promise<void> {
  const { abortSignal, logger, accountId } = options;
  const start = options.startListener ?? startZaloListener;
  let settle: ((error?: Error) => void) | undefined;
  const finished = new Promise<void>((resolve, reject) => {
    settle = (error) => (error === undefined ? resolve() : reject(error));
  });
  const onAbort = () => settle?.();
  abortSignal.addEventListener("abort", onAbort, { once: true });

  let listener: { stop: () => void } | undefined;
  try {
    listener = await start({
      accountId,
      profile: options.profile,
      abortSignal,
      onMessage: async (message: Message) => {
        options.setStatus?.({ lastInboundAt: Date.now() });
        await admitWithRetry(options, message);
      },
      onError: (error: Error) => {
        options.setStatus?.({
          connected: false,
          lifecycle: "recovering",
          lastError: formatErrorMessage(error),
          ...(isZalouserAuthenticationFailure(error) ? { terminalDisconnect: true } : {}),
        });
        settle?.(error);
      },
    });
    if (abortSignal.aborted) return;
    options.setStatus?.({ connected: true, lifecycle: "ready", lastConnectedAt: Date.now() });
    logger?.info?.(`[${accountId}] Zalo Personal listener ready (profile ${options.profile})`);
    await finished;
  } finally {
    abortSignal.removeEventListener("abort", onAbort);
    listener?.stop();
  }
}

/** Retries admission in place; the message is only dropped once the budget is
 * spent, and that drop is an error-level line because the message is gone. */
async function admitWithRetry(
  options: ZalouserListenerSessionOptions,
  message: Message,
): Promise<void> {
  for (let attempt = 1; attempt <= ZALOUSER_ADMISSION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await options.admission.receive(message);
      if (result.kind === "invalid") {
        options.logger?.warn?.(
          `[${options.accountId}] Zalo Personal message refused as invalid: ${result.reason}`,
        );
      }
      return;
    } catch (error) {
      const detail = formatErrorMessage(error);
      if (attempt === ZALOUSER_ADMISSION_MAX_ATTEMPTS || options.abortSignal.aborted) {
        options.logger?.error?.(
          `[${options.accountId}] Zalo Personal message dropped after ${attempt} admission attempts (zca-js cannot re-serve it): ${detail}`,
        );
        return;
      }
      options.logger?.warn?.(
        `[${options.accountId}] Zalo Personal admission failed (attempt ${attempt}), retrying: ${detail}`,
      );
      await sleep(ZALOUSER_ADMISSION_RETRY_DELAY_MS * attempt, options.abortSignal).catch(
        () => undefined,
      );
    }
  }
}
