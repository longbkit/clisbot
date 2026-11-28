/**
 * Retention for the durable ingress queue.
 *
 * Upstream sweeps its SQLite queue from the ingress monitor on an hourly timer
 * (`src/channels/message/ingress-monitor.ts`,
 * `CHANNEL_INGRESS_RETENTION_DEFAULTS`). Fusion's queue is a Hub table, so the
 * sweep belongs to the Hub, not to a channel: one timer per supervisor, over
 * every organization that owns queued rows. The TTLs are upstream's.
 *
 * A sweep deletes in batches (`ChannelStore.pruneChannelIngress`) within a time
 * budget, and when expired rows are left it comes back after
 * `catchUpDelayMs` instead of an hour later. One unbounded DELETE per status
 * hit the pool's 3 s query deadline once a few hundred thousand rows had
 * expired, failed every hour from then on, and the table grew without bound
 * until queries on it timed out too.
 *
 * Deviation from upstream: upstream also caps `completed`/`failed` at 20 000
 * entries per queue. Here that cap would cost more than it saves. Completed
 * rows are the event-id replay guard, and they are also the binding inbox:
 * kept context waiting for the next mention, and the rows a replayed prompt
 * re-reads (`sent_in`) to render the same request — all documented for the
 * 30-day window (docs/features/channels/conversation-flow.md). A count cap
 * would shorten that window to hours on a busy account, silently. With the
 * sweep keeping up, the table holds 30 days of traffic, which is the bound.
 */
import type { ChannelStore } from "../../db/channels.js";

/** Upstream `CHANNEL_INGRESS_RETENTION_DEFAULTS`, minus the entry caps. */
export const CHANNEL_INGRESS_RETENTION_DEFAULTS = Object.freeze({
  pruneIntervalMs: 60 * 60 * 1_000,
  completedTtlMs: 30 * 24 * 60 * 60 * 1_000,
  /** Upstream's terminal status is `failed`; Fusion's is `dead_letter`. */
  deadLetteredTtlMs: 30 * 24 * 60 * 60 * 1_000,
  /**
   * The floor under non-terminal rows. The release budget
   * (`CHANNEL_INGRESS_RELEASE_BUDGET`) already ends anything a drain can still
   * claim, so what is left here is a row no drain reaches at all: an account
   * deleted with a backlog behind it, or a lane whose head was lost. Held at
   * the terminal TTL so a month-old message is never quietly re-delivered.
   */
  unreachablePendingTtlMs: 30 * 24 * 60 * 60 * 1_000,
  /** Rows one DELETE removes: well inside the pool's 3 s query deadline. */
  batchRows: 2_000,
  /** How long one sweep keeps deleting before it gives the database back. */
  sweepBudgetMs: 60_000,
  /** The next sweep, when the last one ran out of budget with expired rows left. */
  catchUpDelayMs: 60_000,
});

export type ChannelIngressRetention = Record<
  keyof typeof CHANNEL_INGRESS_RETENTION_DEFAULTS,
  number
>;

export interface ChannelIngressSweepResult {
  deleted: number;
  /** False when the budget ran out with expired rows left. */
  caughtUp: boolean;
}

export interface ChannelIngressRetentionLog {
  swept?: (detail: { organizationId: string; deleted: number; caughtUp: boolean }) => void;
  faulted?: (error: unknown) => void;
}

type RetentionStore = Pick<ChannelStore, "listChannelIngressOrganizations" | "pruneChannelIngress">;

export interface ChannelIngressRetentionSweepOptions {
  store: RetentionStore;
  retention?: Partial<ChannelIngressRetention>;
  now?: () => number;
  /** One-shot timer seam; the default unrefs so a test never keeps the loop alive. */
  schedule?: (tick: () => void, delayMs: number) => () => void;
  log?: ChannelIngressRetentionLog;
}

export interface ChannelIngressRetentionSweep {
  /** Arm the timer. Idempotent; nothing is pruned until the first tick. */
  start(): void;
  /** One sweep, awaited. */
  sweepOnce(): Promise<ChannelIngressSweepResult>;
  /** Clear the timer and await the in-flight sweep. Safe to call twice. */
  stop(): Promise<void>;
}

const defaultSchedule = (tick: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(tick, delayMs);
  timer.unref?.();
  return () => clearTimeout(timer);
};

/**
 * Delete one organization's expired rows, batch after batch, until none is
 * left or `deadline` passes. Also what `hub.channels.ingress.prune` runs.
 */
export async function pruneExpiredIngress(input: {
  store: Pick<ChannelStore, "pruneChannelIngress">;
  organizationId: string;
  now: number;
  deadline: number;
  clock?: () => number;
  retention?: Partial<ChannelIngressRetention>;
  stopped?: () => boolean;
}): Promise<ChannelIngressSweepResult> {
  const retention = { ...CHANNEL_INGRESS_RETENTION_DEFAULTS, ...input.retention };
  const clock = input.clock ?? Date.now;
  // An infinite TTL prunes nothing of that kind.
  const cutoff = (ttlMs: number) =>
    Number.isFinite(ttlMs) ? new Date(input.now - ttlMs) : undefined;
  const completedOlderThan = cutoff(retention.completedTtlMs);
  const deadLetteredOlderThan = cutoff(retention.deadLetteredTtlMs);
  const pendingOlderThan = cutoff(retention.unreachablePendingTtlMs);
  const step = {
    organizationId: input.organizationId,
    ...(completedOlderThan === undefined ? {} : { completedOlderThan }),
    ...(deadLetteredOlderThan === undefined ? {} : { deadLetteredOlderThan }),
    ...(pendingOlderThan === undefined ? {} : { pendingOlderThan }),
    limit: retention.batchRows,
  };
  let deleted = 0;
  while (input.stopped?.() !== true) {
    const removed = await input.store.pruneChannelIngress(step);
    deleted += removed;
    if (removed < step.limit) return { deleted, caughtUp: true };
    if (clock() >= input.deadline) break;
  }
  return { deleted, caughtUp: false };
}

export function createChannelIngressRetentionSweep(
  options: ChannelIngressRetentionSweepOptions,
): ChannelIngressRetentionSweep {
  const retention = { ...CHANNEL_INGRESS_RETENTION_DEFAULTS, ...options.retention };
  const clock = options.now ?? Date.now;
  let cancel: (() => void) | undefined;
  let running: Promise<ChannelIngressSweepResult> | undefined;
  let stopped = false;

  const sweepOnce = async (): Promise<ChannelIngressSweepResult> => {
    const now = clock();
    const deadline = now + retention.sweepBudgetMs;
    const total = { deleted: 0, caughtUp: true };
    for (const organizationId of await options.store.listChannelIngressOrganizations()) {
      if (stopped) break;
      if (clock() >= deadline) {
        total.caughtUp = false;
        break;
      }
      const result = await pruneExpiredIngress({
        store: options.store,
        organizationId,
        now,
        deadline,
        clock,
        retention,
        stopped: () => stopped,
      });
      total.deleted += result.deleted;
      total.caughtUp &&= result.caughtUp;
      if (result.deleted > 0) options.log?.swept?.({ organizationId, ...result });
    }
    return total;
  };

  const arm = (delayMs: number): void => {
    if (stopped) return;
    cancel = (options.schedule ?? defaultSchedule)(tick, delayMs);
  };

  function tick(): void {
    if (stopped || running !== undefined) return;
    // A sweep fault must not kill the timer: the next tick retries the pass.
    running = sweepOnce()
      .catch((error: unknown) => {
        options.log?.faulted?.(error);
        return { deleted: 0, caughtUp: true };
      })
      .finally(() => {
        running = undefined;
      });
    void running.then(({ caughtUp }) =>
      arm(caughtUp ? retention.pruneIntervalMs : retention.catchUpDelayMs),
    );
  }

  return {
    start: () => {
      if (stopped || cancel !== undefined) return;
      arm(retention.pruneIntervalMs);
    },
    sweepOnce,
    stop: async () => {
      stopped = true;
      cancel?.();
      cancel = undefined;
      await running?.catch(() => undefined);
    },
  };
}
