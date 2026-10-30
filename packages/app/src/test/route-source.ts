import type { RouteSnapshot, RouteSource } from "@/navigation/route-source";

/** A route source a test navigates; like Expo Router's store, it notifies only on a new path. */
export function createTestRouteSource(pathname = "/") {
  const listeners = new Set<() => void>();
  let snapshot: RouteSnapshot = { pathname, params: {} };
  const source: RouteSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
  function navigate(next: string) {
    if (next === snapshot.pathname) return;
    snapshot = { pathname: next, params: {} };
    for (const notify of listeners) notify();
  }
  return { source, navigate };
}

/**
 * A route source that reads the pathname from the test on each render, keeping one snapshot per
 * pathname as Expo Router's route info cache does. It never notifies: re-render to navigate.
 */
export function createReadRouteSource(readPathname: () => string): RouteSource {
  let snapshot: RouteSnapshot = { pathname: readPathname(), params: {} };
  return {
    subscribe: () => () => undefined,
    getSnapshot() {
      const pathname = readPathname();
      if (pathname !== snapshot.pathname) snapshot = { pathname, params: {} };
      return snapshot;
    },
  };
}
