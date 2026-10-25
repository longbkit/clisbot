import { describe, expect, it } from "vitest";
import {
  ConnectLimiter,
  fullJitterDelayMs,
  ReconnectBackoff,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
} from "./connection-backoff";

const policy = (random: number) => ({
  baseDelayMs: RECONNECT_BASE_DELAY_MS,
  maxDelayMs: RECONNECT_MAX_DELAY_MS,
  random: () => random,
});

describe("fullJitterDelayMs", () => {
  it("draws below a ceiling that doubles per failure and stops at the cap", () => {
    const ceilings = [0, 1, 2, 3, 4, 5, 6, 7, 20].map((failures) =>
      fullJitterDelayMs(failures, policy(0.999_999)),
    );
    expect(ceilings).toEqual([999, 1_999, 3_999, 7_999, 15_999, 31_999, 59_999, 59_999, 59_999]);
  });

  it("can retry immediately at the bottom of the range", () => {
    expect(fullJitterDelayMs(5, policy(0))).toBe(0);
  });
});

describe("ReconnectBackoff", () => {
  it("is due at once, waits out each drawn delay, and resets on success", () => {
    let now = 10_000;
    const backoff = new ReconnectBackoff(policy(0.5), () => now);
    expect(backoff.isDue()).toBe(true);

    expect(backoff.recordFailure()).toBe(500);
    expect(backoff.isDue()).toBe(false);
    now += 499;
    expect(backoff.isDue()).toBe(false);
    now += 1;
    expect(backoff.isDue()).toBe(true);

    expect(backoff.recordFailure()).toBe(1_000);
    expect(backoff.recordFailure()).toBe(2_000);
    expect(backoff.failureCount).toBe(3);

    backoff.reset();
    expect(backoff.failureCount).toBe(0);
    expect(backoff.isDue()).toBe(true);
    expect(backoff.recordFailure()).toBe(500);
  });
});

describe("ConnectLimiter", () => {
  it("never exceeds its capacity and serves waiters in arrival order", async () => {
    const limiter = new ConnectLimiter(2);
    const order: number[] = [];
    const gates = Array.from({ length: 5 }, () => Promise.withResolvers<void>());
    const occupy = (gate: PromiseWithResolvers<void>, index: number) => async () => {
      order.push(index);
      await gate.promise;
    };
    const runs = gates.map((gate, index) => limiter.run(occupy(gate, index)));
    await Promise.resolve();
    expect(limiter.stats()).toMatchObject({ active: 2, waiting: 3 });
    for (const gate of gates) {
      gate.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(runs);
    expect(order).toEqual([0, 1, 2, 3, 4]);
    expect(limiter.stats()).toEqual({ active: 0, waiting: 0, peak: 2, granted: 5 });
  });

  it("releases a slot when the operation fails, and a double release is harmless", async () => {
    const limiter = new ConnectLimiter(1);
    await expect(
      limiter.run(async () => {
        throw new Error("unreachable");
      }),
    ).rejects.toThrow("unreachable");
    const release = await limiter.acquire();
    release();
    release();
    expect(limiter.stats()).toMatchObject({ active: 0, waiting: 0 });
  });
});
