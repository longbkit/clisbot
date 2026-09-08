/**
 * The supervisor-owned drain for one channel account's durable ingress queue.
 *
 * Fusion's queue lives in Postgres and serializes lanes inside the claim
 * statement (advisory lock + fencing token), so upstream's
 * `src/channels/message/ingress-drain.ts` — which reads the whole pending set
 * out of SQLite and computes `blockedLaneKeys` in the process — is not portable
 * here. What is portable is the policy it applies, and that is imported
 * verbatim from `@getpaseo/channels-core`
 * (`channels/message/ingress-retry-policy.ts`): backoff schedule, attempt
 * ceiling, dead-letter minimum age and the non-retryable hook. This module owns
 * only the loop: recover, claim, keep the lease alive, dispatch, settle.
 *
 * Lifecycle: `start()` drains once immediately (the restart drain), then on a
 * timer; `requestDrain()` wakes it when an event is admitted; `stop()` clears
 * every timer and awaits the in-flight pump, so a test can end with no handles
 * left behind.
 *
 * One claim's trouble stays one claim's trouble: a lost lease or a lost fencing
 * race abandons that row and the pass moves on to the rest of the backlog.
 */
import type { InboundQueueClaim, InboundQueueSink } from "@getpaseo/channels-shared";
import {
  resolveIngressFailureDisposition,
  resolveIngressRetryDelayMs,
  type IngressNonRetryableFailure,
  type IngressRetryPolicyConfig,
} from "@getpaseo/channels-core/channels/message/ingress-retry-policy";
import { ChannelIngressQueueClaimConflictError } from "../../db/channels.js";

/** Claim lease. Refreshed at a third of it while a dispatch is in flight. */
export const DEFAULT_INGRESS_CLAIM_LEASE_MS = 30_000;
/** Timer wake. Picks up retry-due rows and claims another process abandoned. */
export const DEFAULT_INGRESS_DRAIN_INTERVAL_MS = 15_000;
/** Claims one pass will start before yielding, so one lane cannot hog a pump. */
export const DEFAULT_INGRESS_DRAIN_BATCH = 32;

/**
 * The plane refused this event for now — a route concurrency or rate ceiling,
 * not a decision about the message. The row goes back to the queue unattempted
 * and comes due again after `retryAfterMs`; completing it would drop a message
 * the sender is still waiting on.
 */
export interface ChannelIngressDeferral {
  kind: "deferred";
  reason: string;
  retryAfterMs: number;
}

export interface ChannelIngressDrainOptions {
  queue: InboundQueueSink;
  organizationId: string;
  channel: string;
  accountId: string;
  workerId: string;
  /**
   * Hand the stored payload to the plane. A throw drives the retry policy; a
   * returned deferral releases the row as back-pressure; anything else
   * completes it. `signal` aborts when the account stops or when this claim's
   * lease is lost — a dispatch that keeps running past it writes on behalf of a
   * claim another worker now owns.
   */
  dispatch: (
    payload: unknown,
    claim: InboundQueueClaim,
    signal: AbortSignal,
  ) => Promise<ChannelIngressDeferral | void>;
  abortSignal: AbortSignal;
  log?: ChannelIngressDrainLog;
  retryPolicy?: IngressRetryPolicyConfig;
  resolveNonRetryableFailure?: (error: unknown) => IngressNonRetryableFailure | null;
  leaseMs?: number;
  intervalMs?: number;
  batchLimit?: number;
  now?: () => number;
}

export interface ChannelIngressDrainLog {
  drained?: (claim: InboundQueueClaim) => void;
  retried?: (claim: InboundQueueClaim, detail: { message: string; retryAt: Date }) => void;
  deferred?: (claim: InboundQueueClaim, detail: { reason: string; retryAt: Date }) => void;
  deadLettered?: (claim: InboundQueueClaim, detail: { reason: string; message: string }) => void;
  abandoned?: (claim: InboundQueueClaim, detail: { reason: string }) => void;
  faulted?: (error: unknown) => void;
}

export interface ChannelIngressDrainPass {
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
  /** Released unattempted because the plane deferred them (back-pressure). */
  deferred: number;
  /** Left to the next pass: this worker no longer owns the claim. */
  abandoned: number;
}

export interface ChannelIngressDrain {
  /** Drain once now, then on the interval timer. */
  start(): void;
  /** Wake the loop (called right after a durable admission). */
  requestDrain(): void;
  /** One pass, awaited. The seam tests and `start()` share it. */
  drainOnce(): Promise<ChannelIngressDrainPass>;
  /** Clear the timer and await the in-flight pass. Safe to call twice. */
  stop(): Promise<void>;
}

interface DrainState {
  timer: ReturnType<typeof setInterval> | undefined;
  pump: Promise<void> | undefined;
  running: boolean;
  requested: boolean;
  stopped: boolean;
}

/** One claim's lease keeper: the refresh timer plus the dispatch's abort. */
interface ClaimLease {
  /** Aborts when the account stops or when this claim's lease is lost. */
  signal: AbortSignal;
  /** True once a refresh reported the row is no longer this worker's. */
  lost: boolean;
  release(): void;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyPass(): ChannelIngressDrainPass {
  return { claimed: 0, completed: 0, retried: 0, deadLettered: 0, deferred: 0, abandoned: 0 };
}

/**
 * Keep the claim's lease alive for as long as the dispatch runs, and cut the
 * dispatch loose the moment the lease is gone. `refresh` returning false means
 * the row was recovered and re-claimed elsewhere: every further write this
 * worker makes would be rejected, and the work itself is now a duplicate.
 */
function armLeaseRefresh(
  options: ChannelIngressDrainOptions,
  claim: InboundQueueClaim,
): ClaimLease {
  const leaseMs = options.leaseMs ?? DEFAULT_INGRESS_CLAIM_LEASE_MS;
  const controller = new AbortController();
  const stopWithAccount = () => controller.abort();
  options.abortSignal.addEventListener("abort", stopWithAccount, { once: true });
  const lease: ClaimLease = {
    signal: controller.signal,
    lost: false,
    release: () => options.abortSignal.removeEventListener("abort", stopWithAccount),
  };
  const refresh = options.queue.refresh;
  if (refresh === undefined) return lease;
  const timer = setInterval(
    () => {
      const held = refresh.call(options.queue, {
        id: claim.id,
        workerId: options.workerId,
        claimToken: claim.claimToken,
        leaseMs,
      });
      void held
        .then((stillOurs) => {
          if (!stillOurs) {
            lease.lost = true;
            controller.abort();
          }
          return undefined;
        })
        // A refresh that throws is a transient store fault, not a lost lease:
        // the next tick retries, and the lease outlives one failed refresh.
        .catch(() => undefined);
    },
    Math.max(1, Math.floor(leaseMs / 3)),
  );
  timer.unref?.();
  lease.release = () => {
    clearInterval(timer);
    options.abortSignal.removeEventListener("abort", stopWithAccount);
  };
  return lease;
}

/** Give up on one claim without touching the row: someone else owns it now. */
function abandonClaim(
  options: ChannelIngressDrainOptions,
  claim: InboundQueueClaim,
  pass: ChannelIngressDrainPass,
  reason: string,
): void {
  pass.abandoned += 1;
  options.log?.abandoned?.(claim, { reason });
}

/**
 * Run one fenced settle write. Losing the fence (the lease expired and another
 * worker recovered the row) is this claim's problem: the pass keeps its
 * remaining backlog instead of unwinding into the pump's fault handler.
 */
async function settleFenced(
  options: ChannelIngressDrainOptions,
  claim: InboundQueueClaim,
  pass: ChannelIngressDrainPass,
  write: () => Promise<void>,
): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (error) {
    if (!(error instanceof ChannelIngressQueueClaimConflictError)) throw error;
    abandonClaim(options, claim, pass, formatError(error));
    return false;
  }
}

async function settleCompleted(
  options: ChannelIngressDrainOptions,
  claim: InboundQueueClaim,
  pass: ChannelIngressDrainPass,
): Promise<void> {
  const settled = await settleFenced(options, claim, pass, () =>
    options.queue.complete({
      id: claim.id,
      workerId: options.workerId,
      claimToken: claim.claimToken,
    }),
  );
  if (!settled) return;
  pass.completed += 1;
  options.log?.drained?.(claim);
}

/** Back-pressure: hand the row back with its attempt, due again shortly. */
async function settleDeferral(
  options: ChannelIngressDrainOptions,
  claim: InboundQueueClaim,
  deferral: ChannelIngressDeferral,
  pass: ChannelIngressDrainPass,
): Promise<void> {
  const now = options.now?.() ?? Date.now();
  const retryAt = new Date(now + Math.max(0, deferral.retryAfterMs));
  const settled = await settleFenced(options, claim, pass, () =>
    options.queue.fail({
      id: claim.id,
      workerId: options.workerId,
      claimToken: claim.claimToken,
      error: deferral.reason,
      disposition: "release",
      retryAt,
    }),
  );
  if (!settled) return;
  pass.deferred += 1;
  options.log?.deferred?.(claim, { reason: deferral.reason, retryAt });
}

/**
 * Apply the ported policy to a dispatch failure. Upstream counts `attempts` as
 * attempts finished *before* this one and adds one; a Fusion claim already
 * consumed its attempt at claim time, so the stored count is shifted back to
 * upstream's meaning before the policy reads it.
 */
async function settleFailure(
  options: ChannelIngressDrainOptions,
  claim: InboundQueueClaim,
  error: unknown,
  pass: ChannelIngressDrainPass,
): Promise<void> {
  const now = options.now?.() ?? Date.now();
  const event = {
    receivedAt: claim.receivedAt.getTime(),
    attempts: Math.max(0, claim.attempts - 1),
    lastAttemptAt: now,
    lastError: formatError(error),
  };
  const disposition = resolveIngressFailureDisposition({
    err: error,
    event,
    formatError,
    ...(options.resolveNonRetryableFailure === undefined
      ? {}
      : { resolveNonRetryableFailure: options.resolveNonRetryableFailure }),
    ...(options.retryPolicy === undefined ? {} : { config: options.retryPolicy }),
    now,
  });
  const settle = { id: claim.id, workerId: options.workerId, claimToken: claim.claimToken };
  if (disposition.kind === "fail") {
    const settled = await settleFenced(options, claim, pass, () =>
      options.queue.fail({
        ...settle,
        error: disposition.message,
        disposition: "dead-letter",
        reason: disposition.reason,
      }),
    );
    if (!settled) return;
    pass.deadLettered += 1;
    options.log?.deadLettered?.(claim, disposition);
    return;
  }
  const delayMs = resolveIngressRetryDelayMs(
    { ...event, attempts: disposition.attempt },
    options.retryPolicy,
    now,
  );
  const retryAt = new Date(now + delayMs);
  const settled = await settleFenced(options, claim, pass, () =>
    options.queue.fail({ ...settle, error: disposition.message, disposition: "retry", retryAt }),
  );
  if (!settled) return;
  pass.retried += 1;
  options.log?.retried?.(claim, { message: disposition.message, retryAt });
}

/** Dispatch one claim under a live lease and settle it exactly once. */
async function processClaim(
  options: ChannelIngressDrainOptions,
  claim: InboundQueueClaim,
  pass: ChannelIngressDrainPass,
): Promise<void> {
  const lease = armLeaseRefresh(options, claim);
  let deferral: ChannelIngressDeferral | void;
  try {
    deferral = await options.dispatch(claim.payload, claim, lease.signal);
  } catch (error) {
    lease.release();
    if (lease.lost) abandonClaim(options, claim, pass, "claim lease lost");
    else await settleFailure(options, claim, error, pass);
    return;
  }
  lease.release();
  // The lease went before the dispatch finished: the row is another worker's
  // now, so neither the completion nor a failure of this run may be written.
  if (lease.lost) {
    abandonClaim(options, claim, pass, "claim lease lost");
    return;
  }
  if (deferral !== undefined) {
    await settleDeferral(options, claim, deferral, pass);
    return;
  }
  await settleCompleted(options, claim, pass);
}

/** Build the account-scoped drain. Nothing runs until `start()`/`drainOnce()`. */
export function createChannelIngressDrain(
  options: ChannelIngressDrainOptions,
): ChannelIngressDrain {
  const state: DrainState = {
    timer: undefined,
    pump: undefined,
    running: false,
    requested: false,
    stopped: false,
  };
  const isStopped = () => state.stopped || options.abortSignal.aborted;

  const drainOnce = async (): Promise<ChannelIngressDrainPass> => {
    const pass = emptyPass();
    const scope = {
      organizationId: options.organizationId,
      channel: options.channel,
      accountId: options.accountId,
    };
    // Recover first: a claim whose owner died holds its lane until its lease
    // expires, and only recovery makes it claimable again.
    await options.queue.recover?.(scope);
    const batchLimit = options.batchLimit ?? DEFAULT_INGRESS_DRAIN_BATCH;
    while (pass.claimed < batchLimit && !isStopped()) {
      const claim = await options.queue.claim({
        ...scope,
        workerId: options.workerId,
        leaseMs: options.leaseMs ?? DEFAULT_INGRESS_CLAIM_LEASE_MS,
      });
      if (claim === undefined) break;
      pass.claimed += 1;
      await processClaim(options, claim, pass);
    }
    return pass;
  };

  // `running` is cleared in the same synchronous step as the last `requested`
  // read. Clearing it from a `.finally()` on the pump promise would leave a
  // microtask-wide window in which `requestDrain()` sets `requested` on a pump
  // that has already stopped reading it, and the wake would be lost until the
  // interval timer came round.
  const pump = async (): Promise<void> => {
    try {
      do {
        state.requested = false;
        if (isStopped()) return;
        try {
          await drainOnce();
        } catch (error) {
          // A queue fault must not kill the loop: the timer retries the pass.
          options.log?.faulted?.(error);
          return;
        }
      } while (state.requested);
    } finally {
      state.running = false;
    }
  };

  const requestDrain = (): void => {
    if (isStopped()) return;
    if (state.running) {
      state.requested = true;
      return;
    }
    state.running = true;
    state.pump = pump();
  };

  return {
    start: () => {
      if (isStopped() || state.timer !== undefined) return;
      const timer = setInterval(
        requestDrain,
        options.intervalMs ?? DEFAULT_INGRESS_DRAIN_INTERVAL_MS,
      );
      timer.unref?.();
      state.timer = timer;
      requestDrain();
    },
    requestDrain,
    drainOnce,
    stop: async () => {
      state.stopped = true;
      state.requested = false;
      if (state.timer !== undefined) {
        clearInterval(state.timer);
        state.timer = undefined;
      }
      await state.pump?.catch(() => undefined);
    },
  };
}
