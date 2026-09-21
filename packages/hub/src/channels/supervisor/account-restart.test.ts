import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import {
  ACCOUNT_RESTART_HEALTHY_MS,
  ACCOUNT_RESTART_INITIAL_MS,
  AccountRestartScheduler,
} from "./account-restart.js";

describe("account restart scheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function scheduler(results: boolean[]) {
    const restarts: string[] = [];
    const delays: number[] = [];
    const instance = new AccountRestartScheduler({
      restart: async (channel, accountId) => {
        restarts.push(`${channel}:${accountId}`);
        return results.shift() ?? true;
      },
      log: (_message, detail) => delays.push(detail["delayMs"] as number),
    });
    return { instance, restarts, delays };
  }

  it("restarts a dead transport and backs off while the start keeps failing", async () => {
    const { instance, restarts, delays } = scheduler([false, false, true]);
    instance.schedule("slack:work", "slack", "work");
    await vi.advanceTimersByTimeAsync(ACCOUNT_RESTART_INITIAL_MS * 8);
    assert.deepEqual(restarts, ["slack:work", "slack:work", "slack:work"]);
    assert.deepEqual(delays, [
      ACCOUNT_RESTART_INITIAL_MS,
      ACCOUNT_RESTART_INITIAL_MS * 2,
      ACCOUNT_RESTART_INITIAL_MS * 4,
    ]);
  });

  it("starts the backoff over after the transport lived long enough", async () => {
    const { instance, delays } = scheduler([true]);
    instance.schedule("slack:work", "slack", "work");
    await vi.advanceTimersByTimeAsync(ACCOUNT_RESTART_INITIAL_MS);
    instance.noteStarted("slack:work");
    await vi.advanceTimersByTimeAsync(ACCOUNT_RESTART_HEALTHY_MS);
    instance.schedule("slack:work", "slack", "work");
    assert.deepEqual(delays, [ACCOUNT_RESTART_INITIAL_MS, ACCOUNT_RESTART_INITIAL_MS]);
  });

  it("does not restart an account that was stopped on purpose", async () => {
    const { instance, restarts } = scheduler([]);
    instance.schedule("slack:work", "slack", "work");
    instance.cancel("slack:work");
    await vi.advanceTimersByTimeAsync(ACCOUNT_RESTART_INITIAL_MS * 2);
    assert.deepEqual(restarts, []);
  });
});
