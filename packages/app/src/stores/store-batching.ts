import type { StoreApi } from "zustand";

export type StoreInitializer<T> = (
  set: StoreApi<T>["setState"],
  get: () => T,
  api: StoreApi<T>,
) => T;
type Write<T> = T | Partial<T> | ((state: T) => T | Partial<T>);

export interface StoreBatching<T> {
  /**
   * Runs `commit` with every write held back, then publishes the result as one state change.
   * Reads inside see the held writes. Nested batches publish when the outermost one ends.
   */
  batch(commit: () => void): void;
  /** Wraps the store's initializer; the store's own actions and `setState` both go through it. */
  wrap(initializer: StoreInitializer<T>): StoreInitializer<T>;
}

function isUpdater<T>(write: Write<T>): write is (state: T) => T | Partial<T> {
  return typeof write === "function";
}

/**
 * Zustand notifies on every `set`. A burst of directory updates writes a session many times;
 * subscribers only need to see where it ended. Writes merge, which is what `replace` does for a
 * whole state too, so held writes never need it.
 */
export function createStoreBatching<T>(): StoreBatching<T> {
  let depth = 0;
  let held: T | null = null;
  let publish: (state: T) => void = () => undefined;
  return {
    batch(commit) {
      depth += 1;
      try {
        commit();
      } finally {
        depth -= 1;
        if (depth === 0 && held !== null) {
          const state = held;
          held = null;
          publish(state);
        }
      }
    },
    wrap(initializer) {
      return (set, get, api) => {
        function read(): T {
          return held ?? get();
        }
        function write(partial: Write<T>): void {
          if (depth === 0) {
            set(partial);
            return;
          }
          const current = read();
          const next = isUpdater(partial) ? partial(current) : partial;
          if (!Object.is(next, current)) held = { ...current, ...next };
        }
        publish = (state) => {
          if (!Object.is(state, get())) set(state, true);
        };
        api.getState = read;
        api.setState = write;
        return initializer(write, read, api);
      };
    },
  };
}
