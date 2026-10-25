import { useSyncExternalStore } from "react";

/** One value with subscribers: the shape every piece of search-scope state needs. */
export interface ValueStore<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Read a value store in render. A standalone `use…` hook, never a `.use()` method: the React
 * Compiler reads a member named `use` as React's conditional `use()` API and may skip it on a
 * later render, which breaks hook order (seen as a crash in `useQueries` right after it).
 */
export function useValueStore<T>(store: ValueStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
