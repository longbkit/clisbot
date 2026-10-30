/**
 * One immediate retry of every offline Host when there is reason to think they can connect
 * again: the device network came back, the app returned to the foreground, or a Host that had
 * failed connected (the only network signal native has without NetInfo). Each Host's backoff is
 * dropped, but starts are spaced so 14 or 100 Hosts do not fire on one tick; the shared connect
 * limit still caps attempts in flight. See docs/features/offline/connection-resilience.md.
 */

export const RECONNECT_SWEEP_STAGGER_MS = 100;
/** A recovered Host sweeps the others at most this often, so a fleet coming back sweeps once. */
export const RECOVERY_SWEEP_MIN_INTERVAL_MS = 10_000;

export type ReconnectSweepReason = "network" | "foreground" | "host-recovered";

export interface ReconnectSweepTarget {
  /** Staggered when true; a socket check or a self-retrying client goes at once. */
  takesConnectSlot(): boolean;
  /** Online: verify the socket. Otherwise: drop the remaining backoff and attempt now. */
  retryNow(): void;
}

export class ReconnectSweep {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private lastSweepAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly staggerMs: number = RECONNECT_SWEEP_STAGGER_MS) {}

  run(targets: readonly ReconnectSweepTarget[]): void {
    this.cancel();
    this.lastSweepAt = Date.now();
    const connecting: ReconnectSweepTarget[] = [];
    for (const target of targets) {
      if (target.takesConnectSlot()) connecting.push(target);
      else target.retryNow();
    }
    connecting.forEach((target, index) => {
      if (index === 0) {
        target.retryNow();
        return;
      }
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        target.retryNow();
      }, index * this.staggerMs);
      this.timers.add(timer);
    });
  }

  /** A failed Host connected; sweep the rest unless a sweep ran moments ago. */
  shouldSweepAfterRecovery(): boolean {
    return Date.now() - this.lastSweepAt >= RECOVERY_SWEEP_MIN_INTERVAL_MS;
  }

  cancel(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
