import type { StoreApi } from "zustand";
import type { PerfCollector } from "./collector";

type TimerCallback = (...args: never[]) => void;
type ScheduleTimer = (callback: TimerCallback, ms?: number, ...args: unknown[]) => unknown;

export interface TimerHost {
  setInterval: ScheduleTimer;
  setTimeout: ScheduleTimer;
}

/**
 * Times every timer callback. Release bundles mangle function names, so intervals are named by
 * their period, which is enough to tell the 2 s probe tick from a 5 s or a minute ticker.
 */
export function instrumentTimers(host: TimerHost, collector: PerfCollector, now: () => number) {
  const originalInterval = host.setInterval;
  const originalTimeout = host.setTimeout;
  function timed(source: string, callback: TimerCallback): TimerCallback {
    return (...args) => {
      const start = now();
      try {
        callback(...args);
      } finally {
        collector.timer(source, now() - start);
      }
    };
  }
  Object.assign(host, {
    setInterval: (callback: TimerCallback, ms?: number, ...args: unknown[]) =>
      originalInterval(timed(`interval:${ms ?? 0}ms`, callback), ms, ...args),
    setTimeout: (callback: TimerCallback, ms?: number, ...args: unknown[]) =>
      originalTimeout(timed("timeout", callback), ms, ...args),
  });
}

/**
 * Counts commits of one zustand store under the action that made them. Actions are wrapped once,
 * at install; a commit outside any action (`store.setState`) counts as `set`.
 */
export function instrumentStore<State extends object>(
  collector: PerfCollector,
  name: string,
  store: StoreApi<State>,
) {
  let action: string | null = null;
  const wrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(store.getState())) {
    if (typeof value !== "function") continue;
    wrapped[key] = (...args: unknown[]) => {
      const outer = action;
      action = key;
      try {
        return Reflect.apply(value, undefined, args);
      } finally {
        action = outer;
      }
    };
  }
  store.setState((state) => Object.assign({}, state, wrapped));
  store.subscribe(() => collector.storeCommit(name, action));
}
