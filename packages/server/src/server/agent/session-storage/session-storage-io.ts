/**
 * Every fs call occupies a libuv threadpool thread until it returns, and an fsync on a
 * stalled disk does not return. Session storage bounds how many of those it runs at once so
 * a slow disk cannot occupy every thread that dns, crypto and other fs calls also need.
 */

/** Libuv's own default when `UV_THREADPOOL_SIZE` is unset. */
const LIBUV_DEFAULT_THREADPOOL_SIZE = 4;
/** What the supervisor gives the daemon worker unless the operator chose a size. */
export const DAEMON_UV_THREADPOOL_SIZE = 16;

/** FIFO counting semaphore. A queued caller holds no thread, only a closure. */
export class IoSemaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active += 1;
    try {
      return await operation();
    } finally {
      // Hand the slot straight to the next waiter so a new caller cannot overtake it.
      const next = this.waiters.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Concurrent session-log writes. `PASEO_SESSION_LOG_WRITE_CONCURRENCY` overrides it. With an
 * explicit `UV_THREADPOOL_SIZE` (the supervisor sets one) it is half the pool, never below 4.
 * Without one it is unbounded, as before this limit: on libuv's 4-thread default a whole-append
 * limit measured ~17% slower than letting appends interleave, and every supported entry point
 * starts the daemon through the supervisor anyway.
 */
export function resolveSessionLogWriteConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const configured = positiveInteger(env.PASEO_SESSION_LOG_WRITE_CONCURRENCY);
  if (configured) return configured;
  const threadpool = positiveInteger(env.UV_THREADPOOL_SIZE);
  if (!threadpool) return Number.POSITIVE_INFINITY;
  return Math.max(LIBUV_DEFAULT_THREADPOOL_SIZE, Math.floor(threadpool / 2));
}

const sessionLogWrites = new IoSemaphore(resolveSessionLogWriteConcurrency());

/** Runs one session-log write (append, fsync, index checkpoint) under the process-wide limit. */
export function withSessionLogWriteIo<T>(operation: () => Promise<T>): Promise<T> {
  return sessionLogWrites.run(operation);
}

/** Libuv reads the size once, before first use, so it must be in the worker's spawn env. */
export function applyDaemonThreadpoolEnv(env: NodeJS.ProcessEnv): void {
  env.UV_THREADPOOL_SIZE ??= String(DAEMON_UV_THREADPOOL_SIZE);
}
