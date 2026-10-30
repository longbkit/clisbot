export interface OpenPreloadSchedulerOptions {
  maxConcurrent: number;
  /** A finished preload is not repeated for this long; the open's own catch-up covers the gap. */
  freshMs: number;
  now: () => number;
}

export interface OpenPreloadScheduler {
  request(key: string, start: () => Promise<void>): void;
  /** Drops a preload that has not started. One already in flight runs to completion. */
  cancel(key: string): void;
  cancelQueued(): void;
}

/**
 * Starts the fetch for a row the user is about to open. Fetches cannot be aborted, so
 * cancelling only removes queued work; that is why concurrency stays small.
 */
export function createOpenPreloadScheduler(
  options: OpenPreloadSchedulerOptions,
): OpenPreloadScheduler {
  const running = new Set<string>();
  const queued = new Map<string, () => Promise<void>>();
  const finishedAt = new Map<string, number>();

  function isFresh(key: string): boolean {
    const at = finishedAt.get(key);
    return at !== undefined && options.now() - at < options.freshMs;
  }

  function run(key: string, start: () => Promise<void>): void {
    running.add(key);
    start().then(
      () => settle(key, true),
      // A failed preload is not an error the user sees: the open fetches for itself.
      () => settle(key, false),
    );
  }

  function settle(key: string, succeeded: boolean): void {
    running.delete(key);
    if (succeeded) finishedAt.set(key, options.now());
    else finishedAt.delete(key);
    const next = queued.entries().next();
    if (next.done) return;
    const [nextKey, start] = next.value;
    queued.delete(nextKey);
    run(nextKey, start);
  }

  return {
    request(key, start) {
      if (running.has(key) || queued.has(key) || isFresh(key)) return;
      if (running.size < options.maxConcurrent) run(key, start);
      else queued.set(key, start);
    },
    cancel(key) {
      queued.delete(key);
    },
    cancelQueued() {
      queued.clear();
    },
  };
}
