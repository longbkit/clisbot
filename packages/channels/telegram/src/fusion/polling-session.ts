// Fusion-owned grammY long-poll session (goal slice 20, D-TG-053).
//
// Replaces the hand-rolled `transport/poll.ts` (a direct `getUpdates` fetch that
// bypassed the SDK). The Bot API call, the retry-after parse and the error
// shapes `network-errors.ts` classifies now come from grammY 1.46.0 — the same
// SDK at the same version upstream uses.
//
// Deviation from upstream's `polling-session.ts`: upstream runs the poll in a
// worker thread (`telegram-ingress-worker.ts`) that writes each update into a
// file-backed spool (`telegram-ingress-spool.ts`) and only then lets the parent
// advance the offset; a separate drain (`telegram-ingress-drain.ts`) replays the
// spool into `bot.handleUpdate`. Fusion already owns exactly that durability at
// the Hub: `channel_ingress_queue` persists the normalized event before the
// provider ACK, with lease/fencing, per-lane ordering, retry, dead-letter and
// restart drain (goal slices 1 and 8). Running upstream's spool as well would be
// a second durable store for the same rows, so this session keeps upstream's
// FLOW — admit durably, then advance the watermark; never the reverse — and
// hands the queue the admission step the worker's spool performs upstream.
//
// The parts of upstream's session that carry no OpenClaw coupling ARE ported and
// used here: `update-offset-store.ts` and `update-offset-persistence.ts` (the
// monotonic, retried, rotation-aware watermark), `allowed-updates.ts`,
// `polling-liveness.ts`, `polling-status.ts`, `polling-session-restart-policy.ts`
// and `network-errors.ts`.

import { formatErrorMessage } from "@getpaseo/channels-core/plugin-sdk/error-runtime";
import { sleepWithAbort } from "@getpaseo/channels-core/plugin-sdk/runtime-env";
import type { ChannelAccountSnapshot } from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import type { HostChildLogger } from "@getpaseo/channels-shared";
import type { CallbackQuery, Message, Update } from "grammy/types";
import { resolveTelegramAllowedUpdates } from "../allowed-updates.js";
import { MEDIA_GROUP_TIMEOUT_MS } from "../bot-updates.js";
import type { TelegramApi } from "../client/bot-api.js";
import {
  isTelegramAuthenticationError,
  isTelegramRateLimitError,
  readTelegramRetryAfterMs,
} from "../network-errors.js";
import { TelegramPollingLivenessTracker } from "../polling-liveness.js";
import {
  createTelegramRestartBackoffState,
  resetTelegramRestartBackoffState,
  resolveTelegramRestartDelayMs,
} from "../polling-session-restart-policy.js";
import { createTelegramPollingStatusPublisher } from "../polling-status.js";
import {
  createTelegramUpdateOffsetPersistence,
  normalizeTelegramUpdateId,
} from "../update-offset-persistence.js";
import {
  deleteTelegramUpdateOffset,
  readTelegramUpdateOffset,
  writeTelegramUpdateOffset,
} from "../update-offset-store.js";
import { resolveTelegramLongPollTimeoutSeconds } from "../request-timeouts.js";
import {
  createTelegramApprovalDispatcher,
  type TelegramApprovalDispatcher,
} from "./approval-dispatch.js";
import {
  buildTelegramInboundEvent,
  buildTelegramMessageEvent,
  type TelegramInboundBuild,
  type TelegramInboundParams,
} from "./inbound-adapter.js";

/** Long-poll window, seconds. Upstream's `resolveTelegramLongPollTimeoutSeconds`
 * owns this: 30 by default, clamped to (getUpdates request timeout − 5s margin)
 * so the client never aborts a poll Telegram is still holding open. The port
 * originally hard-coded 50 here — longer than both the 45s getUpdates fetch cap
 * and grammY's client timeout — so on a quiet chat EVERY poll aborted with
 * "Network request for 'getUpdates' failed!" and the restart backoff walked up
 * to its 600s max (live 2026-09-07). */
export const TELEGRAM_POLL_TIMEOUT_SECONDS = resolveTelegramLongPollTimeoutSeconds(undefined);
/** Max updates per `getUpdates` call. */
export const TELEGRAM_POLL_LIMIT = 100;
/** Admission attempts one update gets before the poll skips it. Durable
 * admission is retried on every attempt; only after the budget is spent does the
 * watermark advance past the update — the poison-pill escape (R1). */
export const TELEGRAM_UPDATE_MAX_ATTEMPTS = 5;
/** Backoff after a recoverable poll fault or a batch that left the watermark
 * where it was (the same updates are re-served, so the loop must not hot-poll). */
export const TELEGRAM_POLL_RETRY_DELAY_MS = 1_000;
/** Cap on the transport redelivery guard; the Hub queue is the durable dedupe. */
const SEEN_UPDATE_IDS_CAP = 8192;

export interface TelegramPollingSessionOptions extends TelegramInboundParams {
  botToken: string;
  api: TelegramApi;
  abortSignal: AbortSignal;
  /** Durable admission. Throws when the event was NOT durably admitted — the
   * caller then leaves the watermark alone and the Bot API re-serves. */
  admit: (build: TelegramInboundBuild) => Promise<void>;
  /** COMPAT(clisbot-control-plane): the approval card's button-click seam. The
   * ack fires before this runs, so a faulty callback cannot wedge the poll. */
  onApprovalCallback?: (callbackQuery: CallbackQuery) => Promise<void>;
  logger?: HostChildLogger;
  setStatus?: (patch: Omit<ChannelAccountSnapshot, "accountId">) => void;
  /** Test seam: skip the `deleteWebhook` pre-flight. */
  skipWebhookCleanup?: boolean;
  /** Test seam: observe/shorten the backoff between polls. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

interface DispatchState {
  seenUpdateIds: Set<number>;
  failedAttempts: Map<number, number>;
}

function createDispatchState(): DispatchState {
  return { seenUpdateIds: new Set<number>(), failedAttempts: new Map<number, number>() };
}

function pruneDispatchState(state: DispatchState): void {
  if (state.seenUpdateIds.size <= SEEN_UPDATE_IDS_CAP) return;
  state.seenUpdateIds.clear();
  state.failedAttempts.clear();
}

/** The message an update carries, when it carries one. */
function messageOf(update: Update): Message | undefined {
  return (
    update.message ?? update.channel_post ?? update.edited_message ?? update.edited_channel_post
  );
}

/** A run of consecutive updates that share one `media_group_id`, or a single
 * update. Telegram emits the whole album in one `getUpdates` response, so the
 * run is resolved inside the batch; a group split across two batches becomes
 * two events, which is the same outcome upstream's 500 ms buffer degrades to
 * when the second half misses the window (`MEDIA_GROUP_TIMEOUT_MS`). */
export interface TelegramUpdateRun {
  updates: Update[];
  messages: Message[];
  mediaGroupId?: string;
}

export function groupTelegramUpdateRuns(updates: readonly Update[]): TelegramUpdateRun[] {
  const runs: TelegramUpdateRun[] = [];
  for (const update of updates) {
    const message = messageOf(update);
    const groupId = message?.media_group_id;
    const previous = runs[runs.length - 1];
    if (
      groupId !== undefined &&
      previous !== undefined &&
      previous.mediaGroupId === groupId &&
      message !== undefined
    ) {
      previous.updates.push(update);
      previous.messages.push(message);
      continue;
    }
    runs.push({
      updates: [update],
      messages: message === undefined ? [] : [message],
      ...(groupId === undefined ? {} : { mediaGroupId: groupId }),
    });
  }
  return runs;
}

/** Build the inbound event for one run. A media-group run collapses into one
 * event carrying every message's text and media. */
function buildRun(
  run: TelegramUpdateRun,
  params: TelegramInboundParams,
): TelegramInboundBuild | null {
  const last = run.updates[run.updates.length - 1];
  if (last === undefined) return null;
  if (run.mediaGroupId !== undefined && run.messages.length > 1) {
    const edited = last.edited_message !== undefined || last.edited_channel_post !== undefined;
    return buildTelegramMessageEvent(run.messages, last.update_id, params, { edited });
  }
  return buildTelegramInboundEvent(last, params);
}

export class TelegramPollingSession {
  readonly #opts: TelegramPollingSessionOptions;
  readonly #state = createDispatchState();
  readonly #liveness = new TelegramPollingLivenessTracker();
  readonly #restart = createTelegramRestartBackoffState();
  readonly #status: ReturnType<typeof createTelegramPollingStatusPublisher>;
  readonly #approvals: TelegramApprovalDispatcher;
  #webhookCleared = false;

  constructor(options: TelegramPollingSessionOptions) {
    this.#opts = options;
    this.#status = createTelegramPollingStatusPublisher(options.setStatus);
    this.#approvals = createTelegramApprovalDispatcher({
      accountId: options.accountId,
      seam: options.onApprovalCallback,
      logger: options.logger,
    });
  }

  async #sleep(ms: number): Promise<void> {
    const sleep = this.#opts.sleep;
    if (sleep !== undefined) {
      await sleep(ms, this.#opts.abortSignal);
      return;
    }
    await sleepWithAbort(ms, this.#opts.abortSignal).catch(() => undefined);
  }

  /** Runs until `abortSignal` fires. Throws only on a terminal fault (401). */
  async runUntilAbort(): Promise<void> {
    const opts = this.#opts;
    this.#status.notePollingStart();
    const persistedOffset = await readTelegramUpdateOffset({
      accountId: opts.accountId,
      botToken: opts.botToken,
      onRotationDetected: async (info) => {
        opts.logger?.warn("telegram update offset dropped after rotation", {
          accountId: opts.accountId,
          reason: info.reason,
          previousBotId: info.previousBotId,
          currentBotId: info.currentBotId,
          staleLastUpdateId: info.staleLastUpdateId,
        });
        await deleteTelegramUpdateOffset({ accountId: opts.accountId }).catch(() => undefined);
      },
    });
    const persistence = createTelegramUpdateOffsetPersistence({
      initialUpdateId: normalizeTelegramUpdateId(persistedOffset),
      writeUpdateId: async (updateId) => {
        await writeTelegramUpdateOffset({
          accountId: opts.accountId,
          updateId,
          botToken: opts.botToken,
        });
      },
      onInvalidUpdateId: (updateId) => {
        opts.logger?.warn("telegram ignoring invalid update_id", {
          accountId: opts.accountId,
          updateId,
        });
      },
      onRetry: ({ attempt, delayMs, error, updateId }) => {
        opts.logger?.warn("telegram update offset persist failed (retrying)", {
          accountId: opts.accountId,
          attempt,
          delayMs,
          updateId,
          error: formatErrorMessage(error),
        });
      },
      abortSignal: opts.abortSignal,
    });
    try {
      await this.#loop(persistence);
    } finally {
      await persistence.stop();
      this.#status.notePollingStop();
    }
  }

  async #loop(
    persistence: ReturnType<typeof createTelegramUpdateOffsetPersistence>,
  ): Promise<void> {
    const opts = this.#opts;
    for (;;) {
      if (opts.abortSignal.aborted) return;
      if (!(await this.#ensureWebhookCleared())) continue;
      // The ACCEPTED watermark drives the next poll: an update is accepted the
      // moment durable admission returned, which is this transport's ACK
      // boundary. The COMMITTED watermark (the persisted row) is only the
      // crash-restart floor, and its write is retried in the background — the
      // loop must not wait on it, or one slow store write re-serves the batch.
      const accepted = persistence.getAcceptedUpdateId();
      const offset = accepted === null ? 0 : accepted + 1;
      const batch = await this.#fetchBatch(offset);
      if (batch === null) continue;
      const maxUpdateId = await this.#dispatchBatch(batch);
      pruneDispatchState(this.#state);
      if (maxUpdateId !== null && (accepted === null || maxUpdateId > accepted)) {
        persistence.persistUpdateId(maxUpdateId);
        resetTelegramRestartBackoffState(this.#restart);
        continue;
      }
      // A non-empty batch that left the watermark where it was (a stuck update)
      // is re-served verbatim by the next getUpdates: back off.
      if (batch.length > 0) await this.#sleep(TELEGRAM_POLL_RETRY_DELAY_MS);
    }
  }

  /** Upstream's `#ensureWebhookCleanup`: polling and a registered webhook are
   * mutually exclusive (`getUpdates` answers 409 while one is set). */
  async #ensureWebhookCleared(): Promise<boolean> {
    if (this.#webhookCleared || this.#opts.skipWebhookCleanup === true) {
      this.#webhookCleared = true;
      return true;
    }
    try {
      await this.#opts.api.deleteWebhook({ drop_pending_updates: false });
      this.#webhookCleared = true;
      return true;
    } catch (error) {
      if (isTelegramAuthenticationError(error)) throw error;
      this.#opts.logger?.warn("telegram deleteWebhook failed (continuing to polling)", {
        accountId: this.#opts.accountId,
        error: formatErrorMessage(error),
      });
      // Upstream continues to polling and lets getUpdates confirm webhook state.
      this.#webhookCleared = true;
      return true;
    }
  }

  /** One `getUpdates` through grammY. `null` after a handled fault + backoff.
   * 401 is terminal (rethrown), 429 honours `retry_after`, 409 and every other
   * recoverable fault take the restart backoff. */
  async #fetchBatch(offset: number): Promise<Update[] | null> {
    const opts = this.#opts;
    this.#liveness.noteGetUpdatesStarted({ offset });
    try {
      const raw = await opts.api.getUpdates({
        offset,
        limit: TELEGRAM_POLL_LIMIT,
        timeout: TELEGRAM_POLL_TIMEOUT_SECONDS,
        allowed_updates: resolveTelegramAllowedUpdates(),
      });
      const updates = raw as Update[];
      this.#liveness.noteGetUpdatesSuccessCount(updates.length);
      this.#status.notePollSuccess();
      // A completed long poll clears the fault backoff, empty batch included.
      // Resetting only when the watermark advances (the branch in the loop)
      // leaves an idle account accumulating attempts across occasional network
      // faults until the delay saturates at the 600s policy max — a live
      // 10-minute inbound stall on a bot nobody had messaged yet.
      resetTelegramRestartBackoffState(this.#restart);
      return updates;
    } catch (error) {
      if (opts.abortSignal.aborted) return [];
      if (isTelegramAuthenticationError(error)) {
        // 401: the token is revoked or wrong. Nothing retries into a fix, so the
        // account fails fast and the Hub surfaces it.
        this.#status.notePollingError(formatErrorMessage(error), "blocked");
        this.#liveness.noteGetUpdatesError(error);
        throw error;
      }
      const retryAfterMs = isTelegramRateLimitError(error)
        ? readTelegramRetryAfterMs(error)
        : undefined;
      this.#liveness.noteGetUpdatesError(error, Date.now(), retryAfterMs);
      this.#status.notePollingError(formatErrorMessage(error), "recovering");
      const delayMs = retryAfterMs ?? resolveTelegramRestartDelayMs(this.#restart).delayMs;
      opts.logger?.warn("telegram poll fault (kept polling)", {
        accountId: opts.accountId,
        delayMs,
        error: formatErrorMessage(error),
      });
      await this.#sleep(delayMs);
      return null;
    } finally {
      this.#liveness.noteGetUpdatesFinished();
    }
  }

  /** Hand a batch's runs to the admission seam and report the highest update id
   * the watermark may move to. `null` when nothing may advance. */
  async #dispatchBatch(updates: readonly Update[]): Promise<number | null> {
    let maxUpdateId: number | null = null;
    for (const run of groupTelegramUpdateRuns(updates)) {
      const last = run.updates[run.updates.length - 1];
      if (last === undefined) continue;
      if (!(await this.#dispatchRun(run))) return maxUpdateId;
      for (const update of run.updates) {
        if (maxUpdateId === null || update.update_id > maxUpdateId) {
          maxUpdateId = update.update_id;
        }
      }
    }
    return maxUpdateId;
  }

  /** Admit one run. False when the batch must stop here (the run stays out of
   * the watermark for the next poll to re-serve). */
  async #dispatchRun(run: TelegramUpdateRun): Promise<boolean> {
    const last = run.updates[run.updates.length - 1];
    if (last === undefined) return true;
    const updateId = last.update_id;
    if (this.#state.seenUpdateIds.has(updateId)) return true;
    this.#state.seenUpdateIds.add(updateId);
    try {
      await this.#admitRun(run);
      this.#state.failedAttempts.delete(updateId);
      return true;
    } catch (error) {
      return this.#recordFailedAdmission(updateId, error);
    }
  }

  async #admitRun(run: TelegramUpdateRun): Promise<void> {
    const opts = this.#opts;
    for (const update of run.updates) {
      // A card click is acked FIRST: an unacked callback_query is redelivered.
      if (update.callback_query !== undefined) {
        await this.#answerCallbackQuery(update.callback_query.id);
      }
    }
    const build = buildRun(run, {
      accountId: opts.accountId,
      botId: opts.botId,
      ...(opts.botUsername === undefined ? {} : { botUsername: opts.botUsername }),
    });
    // Durable admission FIRST: a throw here re-serves the whole run, and an
    // approval seam that already ran would answer the same approval again on
    // every retry (up to TELEGRAM_UPDATE_MAX_ATTEMPTS).
    if (build !== null) await opts.admit(build);
    // The approval seam runs for every callback_query, whether or not the click
    // also produced an inbound event (a native-command button does, an approval
    // card click does not — its value is opaque to the vertical). The
    // dispatcher keeps it at most once per click id.
    for (const update of run.updates) {
      if (update.callback_query !== undefined) {
        await this.#approvals.dispatch(update.callback_query);
      }
    }
  }

  async #answerCallbackQuery(callbackQueryId: string): Promise<void> {
    try {
      await this.#opts.api.answerCallbackQuery({ callback_query_id: callbackQueryId });
    } catch (error) {
      this.#opts.logger?.warn("telegram answerCallbackQuery failed (click still dispatched)", {
        accountId: this.#opts.accountId,
        error: formatErrorMessage(error),
      });
    }
  }

  /** Count one failed admission. True when the budget is spent and the poll must
   * skip the update (advance past the poison pill); false to re-serve it. */
  #recordFailedAdmission(updateId: number, error: unknown): boolean {
    const attempts = (this.#state.failedAttempts.get(updateId) ?? 0) + 1;
    const meta = {
      accountId: this.#opts.accountId,
      updateId,
      attempts,
      error: formatErrorMessage(error),
    };
    if (attempts < TELEGRAM_UPDATE_MAX_ATTEMPTS) {
      this.#state.failedAttempts.set(updateId, attempts);
      // Durable admission is the ACK boundary: leave this update out of the
      // watermark and retry it on the next poll.
      this.#state.seenUpdateIds.delete(updateId);
      this.#opts.logger?.warn("telegram update admission failed (will retry)", meta);
      return false;
    }
    this.#state.failedAttempts.delete(updateId);
    const line = "telegram update skipped after repeated admission failures";
    if (this.#opts.logger?.error !== undefined) this.#opts.logger.error(line, meta);
    else this.#opts.logger?.warn(line, meta);
    return true;
  }
}

export { MEDIA_GROUP_TIMEOUT_MS };
