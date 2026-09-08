// Fusion-owned long-poll session (D-ZL-015).
//
// Upstream's loop is `monitor.ts`'s `startPollingLoop`, which calls
// `getUpdates` and hands the result straight to `processUpdate` (the OpenClaw
// inbound pipeline). Carried here unchanged: the 30-second long-poll window,
// the 408-means-no-updates rule, the auth-error terminal stop, the
// `5s · 2^(n-1)` capped-at-60s error backoff with its consecutive-error
// counter, the ready/recovering status patches, and the pre-start webhook
// cleanup (`getWebhookInfo` → `deleteWebhook`, tolerating a 404 from an
// environment that does not expose webhook inspection for polling bots).
//
// THE ONE ADDED RULE — durable admission before the next call.
//
// Zalo's `getUpdates` has NO offset and NO ack: it returns at most one update
// and the server does not re-serve it. There is no watermark to hold back, so
// the Telegram invariant ("admit, then advance the offset") becomes "admit,
// then poll again". The loop therefore awaits admission before it issues the
// next request, and a failed admission is retried in place with backoff up to
// `ZALO_UPDATE_MAX_ATTEMPTS` — after which the update is dropped LOUDLY (the
// poison-pill escape), because a Zalo update that cannot be admitted cannot be
// recovered from the provider either. This is the honest limit of the
// transport and it is why webhook mode, which can answer 500 and be
// redelivered, is the durable one.

import { formatErrorMessage } from "@getpaseo/channels-core/plugin-sdk/error-runtime";
import { sleepWithAbort } from "@getpaseo/channels-core/plugin-sdk/runtime-env";
import type { HostChildLogger } from "@getpaseo/channels-shared";
import {
  deleteWebhook,
  getUpdates,
  getWebhookInfo,
  ZaloApiError,
  type ZaloFetch,
  type ZaloUpdate,
} from "../api.js";
import type { ZaloAdmission } from "./admission.js";

/** Upstream `monitor.ts`: the long-poll window, seconds. */
export const ZALO_POLL_TIMEOUT_SECONDS = 30;
/** The floor between two polls when the provider answers "timeout" early.
 *
 * The 408 rule is upstream's ("no updates in the window, poll again"), and it
 * assumes the server actually held the request for `timeout` seconds. A gateway
 * or a proxy that answers 408 immediately turns that into a hot loop that
 * burns a core and hammers the API. The floor is the long-poll window's own
 * lower bound, not a backoff: a real long poll never reaches it. */
export const ZALO_POLL_MIN_INTERVAL_MS = 1_000;
/** Admission attempts one update gets before the loop drops it. */
export const ZALO_UPDATE_MAX_ATTEMPTS = 5;
/** Backoff between admission attempts for the same update. */
export const ZALO_ADMISSION_RETRY_DELAY_MS = 500;

export interface ZaloPollingSessionOptions {
  token: string;
  accountId: string;
  admission: ZaloAdmission;
  abortSignal: AbortSignal;
  fetcher?: ZaloFetch;
  logger?: HostChildLogger;
  setStatus?: (patch: Record<string, unknown>) => void;
  /** Test seam: skip the `getWebhookInfo` / `deleteWebhook` pre-flight. */
  skipWebhookCleanup?: boolean;
  /** Test seam: stop the loop after this many `getUpdates` calls. */
  maxPolls?: number;
}

/** Runs until `abortSignal` fires (or `maxPolls` is reached in tests). */
export async function startZaloPollingSession(options: ZaloPollingSessionOptions): Promise<void> {
  const { abortSignal, logger, accountId } = options;
  if (options.skipWebhookCleanup !== true) {
    await clearWebhookBeforeStart(options);
  }
  let consecutiveErrors = 0;
  let polls = 0;
  let warnedFastTimeout = false;
  while (!abortSignal.aborted && (options.maxPolls === undefined || polls < options.maxPolls)) {
    polls += 1;
    const pollStartedAt = Date.now();
    try {
      const response = await getUpdates(
        options.token,
        { timeout: ZALO_POLL_TIMEOUT_SECONDS },
        options.fetcher,
      );
      if (abortSignal.aborted) return;
      if (response.ok) {
        consecutiveErrors = 0;
        options.setStatus?.({ connected: true, lifecycle: "ready", lastConnectedAt: Date.now() });
      }
      if (response.ok && response.result) {
        options.setStatus?.({ lastInboundAt: Date.now() });
        // Durable admission happens HERE, before the loop asks for the next
        // update. Nothing else in this iteration may run first.
        await admitWithRetry(options, response.result);
      }
    } catch (error) {
      if (error instanceof ZaloApiError && error.isPollingTimeout) {
        // No updates in the window; upstream treats this as a healthy poll.
        consecutiveErrors = 0;
        const idleMs = Date.now() - pollStartedAt;
        if (idleMs < ZALO_POLL_MIN_INTERVAL_MS) {
          if (!warnedFastTimeout) {
            warnedFastTimeout = true;
            logger?.warn?.(
              `[${accountId}] Zalo long poll returned a timeout after ${idleMs}ms (window is ${ZALO_POLL_TIMEOUT_SECONDS}s); pacing polls at ${ZALO_POLL_MIN_INTERVAL_MS}ms`,
            );
          }
          await sleepWithAbort(ZALO_POLL_MIN_INTERVAL_MS - idleMs, abortSignal).catch(
            () => undefined,
          );
        }
        continue;
      }
      if (error instanceof ZaloApiError && error.isAuthError) {
        const message = formatErrorMessage(error);
        logger?.error?.(`[${accountId}] Zalo auth error, stopping polling: ${message}`);
        options.setStatus?.({ connected: false, terminalDisconnect: true, lastError: message });
        return;
      }
      if (abortSignal.aborted) return;
      consecutiveErrors += 1;
      const backoffMs = Math.min(5000 * 2 ** (consecutiveErrors - 1), 60_000);
      const message = formatErrorMessage(error);
      logger?.error?.(
        `[${accountId}] Zalo polling error (attempt ${consecutiveErrors}, backoff ${backoffMs}ms): ${message}`,
      );
      options.setStatus?.({ connected: false, lifecycle: "recovering", lastError: message });
      await sleepWithAbort(backoffMs, abortSignal).catch(() => undefined);
    }
  }
}

/** Retries admission in place; the update is only dropped once the budget is
 * spent, and that drop is an error-level line because the update is gone. */
async function admitWithRetry(
  options: ZaloPollingSessionOptions,
  update: ZaloUpdate,
): Promise<void> {
  for (let attempt = 1; attempt <= ZALO_UPDATE_MAX_ATTEMPTS; attempt += 1) {
    try {
      await options.admission.receiveUpdate(update);
      return;
    } catch (error) {
      const message = formatErrorMessage(error);
      if (attempt === ZALO_UPDATE_MAX_ATTEMPTS || options.abortSignal.aborted) {
        options.logger?.error?.(
          `[${options.accountId}] Zalo update dropped after ${attempt} admission attempts (the Bot API cannot re-serve it): ${message}`,
        );
        return;
      }
      options.logger?.warn?.(
        `[${options.accountId}] Zalo admission failed (attempt ${attempt}), retrying: ${message}`,
      );
      await sleepWithAbort(ZALO_ADMISSION_RETRY_DELAY_MS * attempt, options.abortSignal).catch(
        () => undefined,
      );
    }
  }
}

/** Upstream `monitor.ts`: polling mode clears a stale webhook first. */
async function clearWebhookBeforeStart(options: ZaloPollingSessionOptions): Promise<void> {
  try {
    const current = (await getWebhookInfo(options.token, options.fetcher)).result?.url?.trim();
    if (!current) return;
    await deleteWebhook(options.token, options.fetcher);
    options.logger?.info?.(`[${options.accountId}] Zalo polling mode ready (webhook disabled)`);
  } catch (error) {
    if (error instanceof ZaloApiError && error.errorCode === 404) {
      // Some Zalo environments do not expose webhook inspection for polling bots.
      options.logger?.info?.(
        `[${options.accountId}] Zalo polling mode webhook inspection unavailable; continuing`,
      );
      return;
    }
    options.logger?.warn?.(
      `[${options.accountId}] Zalo polling startup could not clear webhook: ${formatErrorMessage(error)}`,
    );
  }
}
