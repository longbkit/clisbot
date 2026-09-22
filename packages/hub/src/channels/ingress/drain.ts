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
 * Lifecycle: `start()` drains at once (the restart drain), then wakes on a
 * timer; `requestDrain()` wakes it when an event is admitted; `stop()` clears
 * every timer and awaits the workers still settling a claim, so a test can end
 * with no handles left behind.
 *
 * One claim's trouble stays one claim's trouble: a lost lease or a lost fencing
 * race abandons that row, and a slow dispatch holds only its own worker — the
 * others keep claiming the rest of the backlog.
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
/** Claims one `drainOnce` pass starts before it returns. */
export const DEFAULT_INGRESS_DRAIN_BATCH = 32;
/**
 * Claims one account dispatches at once. The claim statement already keeps a
 * lane to one live claim, so this is how many conversations move in parallel.
 * A dispatch that starts a session holds its worker for the whole create, and a
 * Host runs at most `MAX_CONCURRENT_CREATES_PER_HOST` (8) of those — a message
 * past that is handed back, not held. Staying above that number is what keeps
 * workers free for follow-ups and commands while a Host is starting sessions.
 */
export const DEFAULT_INGRESS_DRAIN_CONCURRENCY = 12;

/**
 * One account's worker cap under a database pool of `connectionLimit`: half
 * the pool, at most the default. A worker's dispatch holds at most one
 * connection at a time, and only for its short queries (a daemon wait holds
 * none), so a busy account keeps at most half the pool and every other account
 * (and the rest of the Hub) still gets a connection. PGlite has a single
 * in-process connection that queues its callers, so there is no pool to share
 * (`undefined`) and the default stands.
 */
export function accountDrainConcurrency(connectionLimit: number | undefined): number {
  if (connectionLimit === undefined) return DEFAULT_INGRESS_DRAIN_CONCURRENCY;
  const share = Math.floor(connectionLimit / 2);
  return Math.max(1, Math.min(DEFAULT_INGRESS_DRAIN_CONCURRENCY, share));
}

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
  concurrency?: number;
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
  /** One bounded pass, awaited, apart from the running pool. The test seam. */
  drainOnce(): Promise<ChannelIngressDrainPass>;
  /** Clear the timers and await the workers still settling. Safe to call twice. */
  stop(): Promise<void>;
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

/** The drain's options plus the one thing a settle tells the loop. */
type DrainRun = ChannelIngressDrainOptions & {
  /** A row went back to the queue and comes due again at `retryAt`. */
  handedBack?: (retryAt: Date) => void;
};

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
  options: DrainRun,
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
  options.handedBack?.(retryAt);
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
  options: DrainRun,
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
  options.handedBack?.(retryAt);
  pass.retried += 1;
  options.log?.retried?.(claim, { message: disposition.message, retryAt });
}

/** Dispatch one claim under a live lease and settle it exactly once. */
async function processClaim(
  options: DrainRun,
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

/** The scope every queue call of one account's drain is pinned to. */
function queueScope(options: ChannelIngressDrainOptions) {
  return {
    organizationId: options.organizationId,
    channel: options.channel,
    accountId: options.accountId,
  };
}

/**
 * Recover first: a claim whose owner died holds its lane until its lease
 * expires, and only recovery makes it claimable again.
 */
async function recoverStaleClaims(options: ChannelIngressDrainOptions): Promise<void> {
  await options.queue.recover?.(queueScope(options));
}

/** The oldest claimable row whose lane is free, or nothing. */
function claimNext(options: ChannelIngressDrainOptions): Promise<InboundQueueClaim | undefined> {
  return options.queue.claim({
    ...queueScope(options),
    workerId: options.workerId,
    leaseMs: options.leaseMs ?? DEFAULT_INGRESS_CLAIM_LEASE_MS,
  });
}

function workerCount(options: ChannelIngressDrainOptions): number {
  return Math.max(1, options.concurrency ?? DEFAULT_INGRESS_DRAIN_CONCURRENCY);
}

/**
 * One bounded pass (`drainOnce`): recover, then let `concurrency` workers claim
 * and dispatch until the queue has nothing claimable or the batch is spent.
 */
async function runDrainPass(
  options: DrainRun,
  batchLimit: number,
  isStopped: () => boolean,
): Promise<ChannelIngressDrainPass> {
  const pass = emptyPass();
  await recoverStaleClaims(options);
  // Workers may overshoot the batch by one claim each; an empty claim must not
  // count, or a pass over a full backlog would never look full.
  const work = async (): Promise<void> => {
    while (pass.claimed < batchLimit && !isStopped()) {
      const claim = await claimNext(options);
      if (claim === undefined) return;
      pass.claimed += 1;
      await processClaim(options, claim, pass);
    }
  };
  // A queue fault in one worker ends the pass only after the others settle: a
  // claim in flight is never left without its settle write.
  const settled = await Promise.allSettled(Array.from({ length: workerCount(options) }, work));
  const fault = settled.find((entry) => entry.status === "rejected");
  if (fault !== undefined) throw fault.reason;
  return pass;
}

/**
 * The account-scoped drain: a pool of up to `concurrency` workers, each of
 * which claims, dispatches and settles one row at a time and goes straight on
 * to the next. Nothing waits for the slowest dispatch: a worker that finishes
 * takes whatever is claimable now, and a wake starts an idle worker at once.
 *
 * A worker leaves when a claim comes back empty and no wake arrived while it
 * was looking; `active` drops in the same synchronous step as that decision.
 * Counting workers by their promises instead would leave a microtask-wide
 * window in which a wake sees a full pool that is in fact draining away, and
 * the wake would be lost until the interval timer came round.
 */
class IngressDrain implements ChannelIngressDrain {
  private timer: ReturnType<typeof setInterval> | undefined;
  /** One-shot wake for the earliest handed-back row, ahead of the interval. */
  private dueTimer: ReturnType<typeof setTimeout> | undefined;
  /** When `dueTimer` fires; a later due time never replaces an earlier one. */
  private dueAt: number | undefined;
  private readonly workers = new Set<Promise<void>>();
  private active = 0;
  /** Bumped by every wake, so a worker can tell a wake landed while it looked. */
  private wakes = 0;
  /** A wake asked for recovery; the next claim runs it, once for the pool. */
  private recoveryDue = false;
  private recovering: Promise<void> | undefined;
  private stopped = false;
  private readonly batchSize: number;
  private readonly run: DrainRun;
  /** Lifetime counts of the pool's settles; the per-pass counts are `drainOnce`'s. */
  private readonly settled = emptyPass();

  constructor(private readonly options: ChannelIngressDrainOptions) {
    this.batchSize = options.batchLimit ?? DEFAULT_INGRESS_DRAIN_BATCH;
    this.run = { ...options, handedBack: (retryAt) => this.armDueTimer(retryAt.getTime()) };
  }

  start(): void {
    if (this.isStopped() || this.timer !== undefined) return;
    const timer = setInterval(
      this.requestDrain,
      this.options.intervalMs ?? DEFAULT_INGRESS_DRAIN_INTERVAL_MS,
    );
    timer.unref?.();
    this.timer = timer;
    this.requestDrain();
  }

  readonly requestDrain = (): void => {
    if (this.isStopped()) return;
    this.wakes += 1;
    this.recoveryDue = true;
    this.spawnWorker();
  };

  readonly drainOnce = (): Promise<ChannelIngressDrainPass> =>
    runDrainPass(this.run, this.batchSize, this.isStopped);

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.dueTimer !== undefined) clearTimeout(this.dueTimer);
    this.timer = undefined;
    this.dueTimer = undefined;
    // Workers stop claiming at once; each one still in a dispatch writes its
    // settle before it ends.
    await Promise.allSettled(this.workers);
  }

  private readonly isStopped = (): boolean => this.stopped || this.options.abortSignal.aborted;

  private spawnWorker(): void {
    if (this.isStopped() || this.active >= workerCount(this.options)) return;
    this.active += 1;
    const worker: Promise<void> = this.work().finally(() => this.workers.delete(worker));
    this.workers.add(worker);
  }

  private async work(): Promise<void> {
    try {
      while (!this.isStopped()) {
        const wakesSeen = this.wakes;
        await this.recoverIfDue();
        const claim = await claimNext(this.run);
        if (claim === undefined) {
          if (this.wakes === wakesSeen) return;
          continue;
        }
        // There may be more behind this one: bring up a sibling, up to the cap.
        this.spawnWorker();
        await processClaim(this.run, claim, this.settled);
      }
    } catch (error) {
      // A queue fault ends this worker, not the pool: the timer brings one back.
      this.options.log?.faulted?.(error);
    } finally {
      this.active -= 1;
    }
  }

  private recoverIfDue(): Promise<void> {
    if (this.recovering === undefined && this.recoveryDue) {
      this.recoveryDue = false;
      this.recovering = recoverStaleClaims(this.run).finally(() => {
        this.recovering = undefined;
      });
    }
    return this.recovering ?? Promise.resolve();
  }

  /** Wake for the earliest row handed back, instead of the next tick. A
   * `drainOnce` without `start()` arms nothing: no pool runs behind it. */
  private armDueTimer(dueAt: number): void {
    if (this.isStopped() || this.timer === undefined) return;
    if (this.dueAt !== undefined && this.dueAt <= dueAt) return;
    if (this.dueTimer !== undefined) clearTimeout(this.dueTimer);
    this.dueAt = dueAt;
    const timer = setTimeout(
      () => {
        this.dueTimer = undefined;
        this.dueAt = undefined;
        this.requestDrain();
      },
      Math.max(0, dueAt - (this.options.now?.() ?? Date.now())),
    );
    timer.unref?.();
    this.dueTimer = timer;
  }
}

/** Build the account-scoped drain. Nothing runs until `start()`/`drainOnce()`. */
export function createChannelIngressDrain(
  options: ChannelIngressDrainOptions,
): ChannelIngressDrain {
  return new IngressDrain(options);
}
