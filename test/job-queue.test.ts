import { describe, expect, test } from "bun:test";
import { AgentJobQueue } from "../src/agents/job-queue.ts";

describe("AgentJobQueue", () => {
  test("runs jobs serially per key", async () => {
    const queue = new AgentJobQueue();
    const order: string[] = [];

    const first = queue.enqueue("default", async () => {
      order.push("first:start");
      await Bun.sleep(100);
      order.push("first:end");
      return "first";
    });

    const second = queue.enqueue("default", async () => {
      order.push("second:start");
      order.push("second:end");
      return "second";
    });

    expect(first.positionAhead).toBe(0);
    expect(second.positionAhead).toBe(1);

    const results = await Promise.all([first.result, second.result]);
    expect(results).toEqual(["first", "second"]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  test("runs jobs concurrently across different keys", async () => {
    const queue = new AgentJobQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue("alpha", async () => {
      order.push("alpha:start");
      await firstGate;
      order.push("alpha:end");
      return "alpha";
    });

    const second = queue.enqueue("beta", async () => {
      order.push("beta:start");
      order.push("beta:end");
      return "beta";
    });

    await Bun.sleep(0);
    expect(order).toEqual(["alpha:start", "beta:start", "beta:end"]);

    releaseFirst();

    const results = await Promise.all([first.result, second.result]);
    expect(results).toEqual(["alpha", "beta"]);
    expect(order).toEqual(["alpha:start", "beta:start", "beta:end", "alpha:end"]);
  });
});
