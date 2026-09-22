// Final answers are retried; progress is not
// (docs/features/channels/conversation-flow.md#outbound). A final answer whose
// post failed in a way that certainly left nothing in the conversation stays on
// its ledger row with the message and a next-attempt time. The account's
// retrier claims due rows, posts them again, and gives up after
// `MAX_FINAL_ANSWER_ATTEMPTS`, recording the loss in Activity. Rows outlive the
// process, so a Hub restart resumes the schedule. A post that may have landed
// (a timeout, a dropped connection) is never posted again: the ledger's rule is
// never to double-post.
import type { ChannelStore } from "../../db/channels.js";
import type {
  ClaimedDeliveryRetry,
  DeliveryLedgerKey,
  DeliveryRetryScope,
} from "../../db/channel-delivery-retries.js";
import type { DeliveryRetryPayload } from "../../db/schema.js";
import { isSafeToRepost } from "../plane/outbound-failure.js";
import type { OutboundPostResult, PlaneLogger, PostFn } from "../plane/types.js";

/**
 * Attempts per final answer, the first post included. With the backoff below
 * the last attempt goes about 7.5 minutes after the first: long enough to ride
 * out a platform incident or a Hub restart, short enough that the answer still
 * belongs to the conversation it answers. The Slack client has already retried
 * each attempt's 429s by then.
 */
export const MAX_FINAL_ANSWER_ATTEMPTS = 5;
/** The wait after the first failed attempt; it doubles per attempt (30s, 1m, 2m, 4m). */
export const FINAL_ANSWER_RETRY_BASE_MS = 30_000;
/** How often an account looks for due retries; a restart looks at once. */
export const FINAL_ANSWER_RETRY_POLL_MS = 15_000;

/** The wait before the attempt after `attempts` failed ones. */
export function finalAnswerRetryDelayMs(attempts: number): number {
  return FINAL_ANSWER_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
}

/** One failed final-answer post, as its ledger row knows it. */
export interface FailedFinalAnswer {
  store: ChannelStore;
  scope: DeliveryRetryScope;
  key: DeliveryLedgerKey;
  /** Attempts made so far, the failed one included. */
  attempts: number;
  payload: DeliveryRetryPayload;
  result: OutboundPostResult;
  now: number;
}

/** Schedule the next attempt, or give up and record the lost answer in Activity. */
export async function settleFailedFinalAnswer(
  failed: FailedFinalAnswer,
): Promise<"retry-scheduled" | "given-up"> {
  const { store, key, attempts, payload, result } = failed;
  const failureReason = result.error ?? "channel post failed";
  if (isSafeToRepost(result.failure) && attempts < MAX_FINAL_ANSWER_ATTEMPTS) {
    const nextAttemptAt = new Date(failed.now + finalAnswerRetryDelayMs(attempts));
    await store.failDelivery({ ...key, failureReason, retry: { payload, nextAttemptAt } });
    return "retry-scheduled";
  }
  await closeUnretriedDelivery(store, key, result);
  await store.deliveryRetries.recordOutboundFailure({
    scope: failed.scope,
    externalConversationId: key.externalConversationId,
    externalThreadId: key.externalThreadId,
    payload,
    outcomeDetail: givenUpDetail(attempts, result),
  });
  return "given-up";
}

/**
 * Close a failed post that will not be retried. One that may have landed stays
 * `recorded`, which a replay never re-arms; one that certainly did not is
 * `failed`, which a replay of the same stream event may post again.
 */
export async function closeUnretriedDelivery(
  store: ChannelStore,
  key: DeliveryLedgerKey,
  result: OutboundPostResult,
): Promise<void> {
  const failureReason = result.error ?? "channel post failed";
  if (result.failure?.mayHavePosted === true) {
    await store.recordUncertainDelivery({ ...key, failureReason });
    return;
  }
  await store.failDelivery({ ...key, failureReason });
}

function givenUpDetail(attempts: number, result: OutboundPostResult): string {
  const reason = result.error ?? "channel post failed";
  if (result.failure?.mayHavePosted === true) {
    return `The answer may not have been posted (${reason}); it was not sent again, to avoid a duplicate.`;
  }
  const tries = attempts === 1 ? "1 attempt" : `${attempts} attempts`;
  return `The answer was not posted after ${tries}: ${reason}`;
}

interface FinalAnswerRetrierDeps {
  store: ChannelStore;
  scope: DeliveryRetryScope;
  /** The account's paced post: a retry waits its turn like any answer. */
  post: PostFn;
  logger: PlaneLogger;
  abortSignal: AbortSignal;
  now?: () => number;
  intervalMs?: number;
}

/** One account's retrier: claims its due final answers and posts them again. */
export class FinalAnswerRetrier {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<number> | undefined;

  constructor(private readonly deps: FinalAnswerRetrierDeps) {}

  /** Retry what is due now (a restart's backlog), then on the interval. */
  start(): void {
    if (this.timer !== undefined || this.deps.abortSignal.aborted) return;
    this.timer = setInterval(() => this.tick(), this.deps.intervalMs ?? FINAL_ANSWER_RETRY_POLL_MS);
    this.timer.unref?.();
    this.deps.abortSignal.addEventListener("abort", () => void this.stop(), { once: true });
    this.tick();
  }

  /** Stop the timer and wait for the attempt in flight to settle its ledger row. */
  async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /** Post every due retry once, one at a time. Returns how many were attempted. */
  async runDue(): Promise<number> {
    let attempted = 0;
    while (!this.deps.abortSignal.aborted) {
      const claimed = await this.deps.store.deliveryRetries.claimDue(
        this.deps.scope,
        new Date(this.now()),
      );
      if (claimed === undefined) break;
      await this.attempt(claimed);
      attempted += 1;
    }
    return attempted;
  }

  private tick(): void {
    if (this.running !== undefined) return;
    this.running = this.runDue()
      .catch((error: unknown) => {
        this.deps.logger.warn("final answer retry pass failed", {
          ...this.deps.scope,
          error: error instanceof Error ? error.message : String(error),
        });
        return 0;
      })
      .finally(() => {
        this.running = undefined;
      });
  }

  private async attempt(claimed: ClaimedDeliveryRetry): Promise<void> {
    const { key, payload } = claimed;
    const result = await this.deps.post({
      channel: this.deps.scope.channel,
      accountId: this.deps.scope.accountId,
      to: payload.to,
      ...(payload.threadId === null ? {} : { threadId: payload.threadId }),
      text: payload.text,
    });
    if (result.ok) {
      await this.deps.store.confirmDelivery({
        ...key,
        externalMessageId: result.externalMessageId ?? "",
        postedAt: new Date(this.now()),
      });
      this.deps.logger.info?.("final answer retry posted", { ...key, attempts: claimed.attempts });
      return;
    }
    const next = await settleFailedFinalAnswer({
      store: this.deps.store,
      scope: this.deps.scope,
      key,
      attempts: claimed.attempts,
      payload,
      result,
      now: this.now(),
    });
    this.deps.logger.warn("final answer retry failed", {
      ...key,
      attempts: claimed.attempts,
      error: result.error,
      failure: result.failure?.kind,
      next,
    });
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}
