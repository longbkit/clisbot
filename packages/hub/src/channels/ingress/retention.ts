/**
 * Retention for the durable ingress queue.
 *
 * Upstream sweeps its SQLite queue from the ingress monitor on an hourly timer
 * (`src/channels/message/ingress-monitor.ts`,
 * `CHANNEL_INGRESS_RETENTION_DEFAULTS`). Fusion's queue is a Hub table, so the
 * sweep belongs to the Hub, not to a channel: one timer per supervisor, over
 * every organization that owns queued rows. The TTLs are upstream's.
 *
 * Deviation from upstream: upstream also caps `completed`/`failed` at 20 000
 * entries per queue. Fusion's store exposes TTL cutoffs only
 * (`pruneChannelIngress`), and a per-organization cap needs a windowed delete;
 * until an operator hits that shape the TTLs are the whole policy.
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
});

export type ChannelIngressRetention = typeof CHANNEL_INGRESS_RETENTION_DEFAULTS;

export interface ChannelIngressRetentionLog {
  swept?: (detail: { organizationId: string; deleted: number }) => void;
  faulted?: (error: unknown) => void;
}

export interface ChannelIngressRetentionSweepOptions {
  store: Pick<ChannelStore, "listChannelIngressOrganizations" | "pruneChannelIngress">;
  retention?: Partial<ChannelIngressRetention>;
  now?: () => number;
  /** Timer seam; the default unrefs so a test never keeps the loop alive. */
  schedule?: (tick: () => void, intervalMs: number) => () => void;
  log?: ChannelIngressRetentionLog;
}

export interface ChannelIngressRetentionSweep {
  /** Arm the timer. Idempotent; nothing is pruned until the first tick. */
  start(): void;
  /** One sweep, awaited. Returns the number of rows deleted. */
  sweepOnce(): Promise<number>;
  /** Clear the timer and await the in-flight sweep. Safe to call twice. */
  stop(): Promise<void>;
}

const defaultSchedule = (tick: () => void, intervalMs: number): (() => void) => {
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};

export function createChannelIngressRetentionSweep(
  options: ChannelIngressRetentionSweepOptions,
): ChannelIngressRetentionSweep {
  const retention = { ...CHANNEL_INGRESS_RETENTION_DEFAULTS, ...options.retention };
  let cancel: (() => void) | undefined;
  let running: Promise<number> | undefined;
  let stopped = false;

  const sweepOnce = async (): Promise<number> => {
    const now = options.now?.() ?? Date.now();
    const cutoffs = {
      completedOlderThan: new Date(now - retention.completedTtlMs),
      deadLetteredOlderThan: new Date(now - retention.deadLetteredTtlMs),
      pendingOlderThan: new Date(now - retention.unreachablePendingTtlMs),
    };
    let deleted = 0;
    for (const organizationId of await options.store.listChannelIngressOrganizations()) {
      if (stopped) break;
      const removed = await options.store.pruneChannelIngress({ organizationId, ...cutoffs });
      deleted += removed;
      if (removed > 0) options.log?.swept?.({ organizationId, deleted: removed });
    }
    return deleted;
  };

  const tick = (): void => {
    if (stopped || running !== undefined) return;
    // A sweep fault must not kill the timer: the next tick retries the pass.
    running = sweepOnce()
      .catch((error: unknown) => {
        options.log?.faulted?.(error);
        return 0;
      })
      .finally(() => {
        running = undefined;
      });
  };

  return {
    start: () => {
      if (stopped || cancel !== undefined) return;
      cancel = (options.schedule ?? defaultSchedule)(tick, retention.pruneIntervalMs);
    },
    sweepOnce,
    stop: async () => {
      stopped = true;
      cancel?.();
      cancel = undefined;
      await running?.catch(() => 0);
    },
  };
}
