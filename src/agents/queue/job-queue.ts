import { sleep } from "../../infra/process.ts";

type QueueTask<T> = () => Promise<T>;
type QueueCanStart = () => Promise<boolean> | boolean;
type QueueLifecycle<T> = {
  onStart?: () => Promise<void> | void;
  onComplete?: (value: T) => Promise<void> | void;
  onFailure?: (error: unknown) => Promise<void> | void;
  onClear?: () => Promise<void> | void;
};

const QUEUE_PENDING_POLL_INTERVAL_MS = 25;

export type PendingQueueItem = {
  id: string;
  text: string;
  createdAt: number;
};

type QueueEntry<T> = {
  id: string;
  text?: string;
  createdAt: number;
  sequence: number;
  status: "pending" | "running";
  canStart?: QueueCanStart;
  task: QueueTask<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  result: Promise<T>;
  lifecycle?: QueueLifecycle<T>;
};

type QueueState = {
  running: boolean;
  entries: QueueEntry<unknown>[];
};

export class ClearedQueuedTaskError extends Error {
  constructor() {
    super("Queued task was cleared before execution.");
    this.name = "ClearedQueuedTaskError";
  }
}

export class AgentJobQueue {
  private states = new Map<string, QueueState>();
  private nextId = 1;
  private nextSequence = 1;

  enqueue<T>(
    key: string,
    task: QueueTask<T>,
    options: { id?: string; text?: string; createdAt?: number; canStart?: QueueCanStart } & QueueLifecycle<T> = {},
  ) {
    const state = this.getOrCreateState(key);
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const result = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    void result.catch(() => undefined);
    const entry: QueueEntry<T> = {
      id: options.id ?? String(this.nextId++),
      text: options.text,
      createdAt: options.createdAt ?? Date.now(),
      sequence: this.nextSequence++,
      status: "pending",
      canStart: options.canStart,
      task,
      resolve,
      reject,
      result,
      lifecycle: {
        onStart: options.onStart,
        onComplete: options.onComplete,
        onFailure: options.onFailure,
        onClear: options.onClear,
      },
    };
    state.entries.push(entry as QueueEntry<unknown>);
    this.sortEntries(state);
    const positionAhead = state.entries.indexOf(entry as QueueEntry<unknown>);
    void this.drain(key, state);

    return { positionAhead, result };
  }

  isBusy(sessionKey: string) {
    for (const [key, state] of this.states.entries()) {
      if ((key === sessionKey || key.startsWith(`${sessionKey}:`)) && state.entries.length > 0) {
        return true;
      }
    }

    return false;
  }

  listPending(key: string): PendingQueueItem[] {
    const state = this.states.get(key);
    if (!state) {
      return [];
    }

    return state.entries
      .filter((entry) => entry.status === "pending" && entry.text)
      .map((entry) => ({
        id: entry.id,
        text: entry.text!,
        createdAt: entry.createdAt,
      }));
  }

  clearPending(key: string) {
    const state = this.states.get(key);
    if (!state) {
      return 0;
    }

    return this.clearPendingEntriesForState(key, state, () => true);
  }

  clearPendingByIdsForKey(key: string, ids: Iterable<string>) {
    const state = this.states.get(key);
    if (!state) {
      return 0;
    }

    const idSet = new Set(ids);
    return this.clearPendingEntriesForState(key, state, (entry) => idSet.has(entry.id));
  }

  private getOrCreateState(key: string) {
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }

    const state: QueueState = {
      running: false,
      entries: [],
    };
    this.states.set(key, state);
    return state;
  }

  private sortEntries(state: QueueState) {
    state.entries.sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === "running" ? -1 : 1;
      }
      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
      }
      return left.sequence - right.sequence;
    });
  }

  private clearPendingEntriesForState(
    key: string,
    state: QueueState,
    shouldClear: (entry: QueueEntry<unknown>) => boolean,
  ) {
    const keptEntries = state.entries.filter((entry) =>
      entry.status === "running" || !shouldClear(entry)
    );
    const removedEntries = state.entries.filter((entry) =>
      entry.status === "pending" && shouldClear(entry)
    );
    state.entries = keptEntries;
    for (const entry of removedEntries) {
      void Promise.resolve(entry.lifecycle?.onClear?.()).catch(() => undefined);
      entry.reject(new ClearedQueuedTaskError());
    }
    if (state.entries.length === 0 && !state.running) {
      this.states.delete(key);
    }
    return removedEntries.length;
  }

  private async drain(key: string, state: QueueState) {
    if (state.running) {
      return;
    }

    state.running = true;
    try {
      while (true) {
        const nextEntry = state.entries.find((entry) => entry.status === "pending");
        if (!nextEntry) {
          break;
        }

        if (nextEntry.canStart && !(await nextEntry.canStart())) {
          await sleep(QUEUE_PENDING_POLL_INTERVAL_MS);
          continue;
        }
        this.sortEntries(state);
        if (state.entries.find((entry) => entry.status === "pending") !== nextEntry) {
          continue;
        }

        nextEntry.status = "running";
        try {
          await Promise.resolve(nextEntry.lifecycle?.onStart?.()).catch(() => undefined);
          const value = await nextEntry.task();
          await Promise.resolve(nextEntry.lifecycle?.onComplete?.(value)).catch(() => undefined);
          nextEntry.resolve(value);
        } catch (error) {
          await Promise.resolve(nextEntry.lifecycle?.onFailure?.(error)).catch(() => undefined);
          nextEntry.reject(error);
        } finally {
          state.entries = state.entries.filter((entry) => entry !== nextEntry);
        }
      }
    } finally {
      state.running = false;
      if (state.entries.length === 0) {
        this.states.delete(key);
      }
    }
  }
}
