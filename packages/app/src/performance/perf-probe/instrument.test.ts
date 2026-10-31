import { describe, expect, it } from "vitest";
import { create } from "zustand";
import { createPerfCollector } from "./collector";
import { instrumentStore, instrumentTimers, type TimerHost } from "./instrument";

function createTimerHost() {
  const intervals: (() => void)[] = [];
  const timeouts: (() => void)[] = [];
  const host: TimerHost = {
    setInterval: (callback: (...args: never[]) => void, _ms, ...args) =>
      intervals.push(() => Reflect.apply(callback, undefined, args)),
    setTimeout: (callback: (...args: never[]) => void, _ms, ...args) =>
      timeouts.push(() => Reflect.apply(callback, undefined, args)),
  };
  return { host, intervals, timeouts };
}

describe("instrumentTimers", () => {
  it("counts interval callbacks by period and timeouts together, with their run time", () => {
    let now = 0;
    const collector = createPerfCollector({ now: () => now });
    const { host, intervals, timeouts } = createTimerHost();
    instrumentTimers(host, collector, () => now);

    const calls: string[] = [];
    host.setInterval(() => {
      calls.push("tick");
      now += 3;
    }, 5_000);
    host.setTimeout(
      (value: string) => {
        calls.push(value);
        now += 1;
      },
      0,
      "arg",
    );
    intervals[0]!();
    intervals[0]!();
    timeouts[0]!();

    expect(calls).toEqual(["tick", "tick", "arg"]);
    expect(collector.flush().timers).toEqual({
      "interval:5000ms": { count: 2, ms: 6 },
      timeout: { count: 1, ms: 1 },
    });
  });
});

describe("instrumentStore", () => {
  it("attributes each commit to the action that made it", () => {
    const collector = createPerfCollector({ now: () => 0 });
    const store = create<{ count: number; bump: () => void; bumpTwice: () => void }>()(
      (set, get) => ({
        count: 0,
        bump: () => set({ count: get().count + 1 }),
        bumpTwice: () => {
          get().bump();
          set({ count: get().count + 1 });
        },
      }),
    );
    instrumentStore(collector, "counter", store);

    store.getState().bump();
    store.getState().bumpTwice();
    store.setState({ count: 0 });

    expect(store.getState().count).toBe(0);
    expect(collector.flush().stores).toEqual({
      "counter.bump": 2,
      "counter.bumpTwice": 1,
      "counter.set": 1,
    });
  });
});
