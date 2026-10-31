/**
 * Reconnect pacing shared by every Host. A Hub can front a hundred sandboxes; after a VPN or
 * network flip they must not all retry on the same tick, and one unreachable sandbox must not
 * retry every two seconds forever. See docs/features/offline/connection-resilience.md.
 */

export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 60_000;
/**
 * Connect attempts (probe sockets and admission sessions) in flight across every Host. An attempt
 * mostly waits on round trips, so a company fleet behind a VPN (14 Hosts, 400 ms) connects in one
 * wave; a hundred sandboxes still start in waves, and retries are paced by the backoff.
 */
export const MAX_CONCURRENT_HOST_CONNECTS = 16;
/** Directory pages (agents, workspaces, projects) in flight across every Host. */
export const MAX_CONCURRENT_DIRECTORY_PAGES = 3;

export interface BackoffPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  /** Uniform in [0, 1); injectable so tests are deterministic. */
  random: () => number;
}

export const DEFAULT_BACKOFF_POLICY: BackoffPolicy = {
  baseDelayMs: RECONNECT_BASE_DELAY_MS,
  maxDelayMs: RECONNECT_MAX_DELAY_MS,
  random: Math.random,
};

/** "Full jitter": uniform in [0, min(max, base·2^failures)). */
export function fullJitterDelayMs(failures: number, policy: BackoffPolicy): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, failures));
  return Math.floor(policy.random() * ceiling);
}

/** Failure count and next due time for one source; success resets it. */
export class ReconnectBackoff {
  private failures = 0;
  private dueAt = 0;

  constructor(
    private readonly policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY,
    private readonly now: () => number = Date.now,
  ) {}

  isDue(): boolean {
    return this.now() >= this.dueAt;
  }

  /** Records one failed attempt and returns the delay before the next one. */
  recordFailure(): number {
    const delay = fullJitterDelayMs(this.failures, this.policy);
    this.failures += 1;
    this.dueAt = this.now() + delay;
    return delay;
  }

  reset(): void {
    this.failures = 0;
    this.dueAt = 0;
  }

  get failureCount(): number {
    return this.failures;
  }

  get nextAttemptAt(): number {
    return this.dueAt;
  }
}

export type ReleaseConnectSlot = () => void;

/** FIFO semaphore; a waiter is served in arrival order, so no Host starves. */
export class ConnectLimiter {
  private active = 0;
  private peak = 0;
  private granted = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(readonly capacity: number) {}

  acquire(): Promise<ReleaseConnectSlot> {
    return new Promise((resolve) => {
      const grant = () => {
        this.active += 1;
        this.granted += 1;
        this.peak = Math.max(this.peak, this.active);
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active -= 1;
          this.waiters.shift()?.();
        });
      };
      if (this.active < this.capacity) grant();
      else this.waiters.push(grant);
    });
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  stats(): { active: number; waiting: number; peak: number; granted: number } {
    return {
      active: this.active,
      waiting: this.waiters.length,
      peak: this.peak,
      granted: this.granted,
    };
  }
}

const LIMITER_GLOBAL_KEY = "__clisbotHostConnectLimiter";

/** One limiter per app process, shared across Fast Refresh like the runtime store. */
export function getHostConnectLimiter(): ConnectLimiter {
  const existing = Reflect.get(globalThis, LIMITER_GLOBAL_KEY);
  if (existing instanceof ConnectLimiter) return existing;
  const created = new ConnectLimiter(MAX_CONCURRENT_HOST_CONNECTS);
  Reflect.set(globalThis, LIMITER_GLOBAL_KEY, created);
  return created;
}
