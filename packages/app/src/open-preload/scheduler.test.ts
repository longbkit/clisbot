import { describe, expect, it } from "vitest";
import { createOpenPreloadScheduler } from "./scheduler";

function createHarness() {
  let now = 0;
  const started: string[] = [];
  const finish = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  const scheduler = createOpenPreloadScheduler({
    maxConcurrent: 2,
    freshMs: 30_000,
    now: () => now,
  });
  function request(key: string) {
    scheduler.request(
      key,
      () =>
        new Promise<void>((resolve, reject) => {
          started.push(key);
          finish.set(key, { resolve, reject });
        }),
    );
  }
  async function settle(key: string, ok = true) {
    const pending = finish.get(key);
    if (ok) pending?.resolve();
    else pending?.reject(new Error("offline"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  return {
    scheduler,
    started,
    request,
    settle,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("open preload scheduler", () => {
  it("starts a preload on intent and runs at most two at once", () => {
    const harness = createHarness();
    harness.request("a");
    harness.request("b");
    harness.request("c");
    expect(harness.started).toEqual(["a", "b"]);
  });

  it("starts the next queued preload when a slot frees", async () => {
    const harness = createHarness();
    harness.request("a");
    harness.request("b");
    harness.request("c");
    await harness.settle("a");
    expect(harness.started).toEqual(["a", "b", "c"]);
  });

  it("drops a queued preload cancelled by scrolling away", async () => {
    const harness = createHarness();
    harness.request("a");
    harness.request("b");
    harness.request("c");
    harness.scheduler.cancel("c");
    await harness.settle("a");
    expect(harness.started).toEqual(["a", "b"]);
  });

  it("cancels every queued preload at once when the list scrolls", async () => {
    const harness = createHarness();
    for (const key of ["a", "b", "c", "d"]) harness.request(key);
    harness.scheduler.cancelQueued();
    await harness.settle("a");
    await harness.settle("b");
    expect(harness.started).toEqual(["a", "b"]);
  });

  it("does not preload the same row again while its result is fresh", async () => {
    const harness = createHarness();
    harness.request("a");
    harness.request("a");
    await harness.settle("a");
    harness.advance(29_999);
    harness.request("a");
    expect(harness.started).toEqual(["a"]);
    harness.advance(1);
    harness.request("a");
    expect(harness.started).toEqual(["a", "a"]);
  });

  it("lets the next intent retry a preload that failed", async () => {
    const harness = createHarness();
    harness.request("a");
    await harness.settle("a", false);
    harness.request("a");
    expect(harness.started).toEqual(["a", "a"]);
  });
});
