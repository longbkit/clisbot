import { describe, expect, test } from "bun:test";
import { AgentJobQueue, ClearedQueuedTaskError } from "../src/agents/queue/job-queue.ts";

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

  test("lists and clears pending queued items without touching the active run", async () => {
    const queue = new AgentJobQueue();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue(
      "default",
      async () => {
        await firstGate;
        return "first";
      },
      { text: "first" },
    );
    const second = queue.enqueue(
      "default",
      async () => "second",
      { text: "second" },
    );
    const third = queue.enqueue(
      "default",
      async () => "third",
      { text: "third" },
    );

    await Bun.sleep(0);

    expect(queue.listPending("default").map((item) => item.text)).toEqual([
      "second",
      "third",
    ]);

    expect(queue.clearPending("default")).toBe(2);
    expect(queue.listPending("default")).toEqual([]);

    releaseFirst();

    await expect(first.result).resolves.toBe("first");
    await expect(second.result).rejects.toBeInstanceOf(ClearedQueuedTaskError);
    await expect(third.result).rejects.toBeInstanceOf(ClearedQueuedTaskError);
  });

  test("clears pending ids only for the requested key", async () => {
    const queue = new AgentJobQueue();
    let releaseAlpha!: () => void;
    let releaseBeta!: () => void;
    const alphaGate = new Promise<void>((resolve) => {
      releaseAlpha = resolve;
    });
    const betaGate = new Promise<void>((resolve) => {
      releaseBeta = resolve;
    });

    const alphaRunning = queue.enqueue(
      "alpha",
      async () => {
        await alphaGate;
        return "alpha-running";
      },
      { text: "alpha-running" },
    );
    const alphaPending = queue.enqueue(
      "alpha",
      async () => "alpha-pending",
      { id: "shared-id", text: "alpha-pending" },
    );
    const betaRunning = queue.enqueue(
      "beta",
      async () => {
        await betaGate;
        return "beta-running";
      },
      { text: "beta-running" },
    );
    const betaPending = queue.enqueue(
      "beta",
      async () => "beta-pending",
      { id: "shared-id", text: "beta-pending" },
    );

    await Bun.sleep(0);

    expect(queue.clearPendingByIdsForKey("alpha", ["shared-id"])).toBe(1);
    expect(queue.listPending("alpha")).toEqual([]);
    expect(queue.listPending("beta").map((item) => item.text)).toEqual(["beta-pending"]);

    releaseAlpha();
    releaseBeta();

    await expect(alphaRunning.result).resolves.toBe("alpha-running");
    await expect(alphaPending.result).rejects.toBeInstanceOf(ClearedQueuedTaskError);
    await expect(betaRunning.result).resolves.toBe("beta-running");
    await expect(betaPending.result).resolves.toBe("beta-pending");
  });

  test("keeps the next job pending until canStart allows it", async () => {
    const queue = new AgentJobQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    let allowSecond = false;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue(
      "default",
      async () => {
        order.push("first:start");
        await firstGate;
        order.push("first:end");
        return "first";
      },
      { text: "first" },
    );
    const second = queue.enqueue(
      "default",
      async () => {
        order.push("second:start");
        order.push("second:end");
        return "second";
      },
      {
        text: "second",
        canStart: () => allowSecond,
      },
    );

    await Bun.sleep(20);
    releaseFirst();
    await Bun.sleep(20);

    expect(order).toEqual(["first:start", "first:end"]);
    expect(queue.listPending("default").map((item) => item.text)).toEqual(["second"]);

    allowSecond = true;

    await expect(first.result).resolves.toBe("first");
    await expect(second.result).resolves.toBe("second");
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  test("supports stable queue ids and lifecycle callbacks", async () => {
    const queue = new AgentJobQueue();
    const events: string[] = [];

    const run = queue.enqueue(
      "default",
      async () => "done",
      {
        id: "queue-1",
        createdAt: 42,
        text: "persisted",
        onStart: () => {
          events.push("start");
        },
        onComplete: () => {
          events.push("complete");
        },
      },
    );

    expect(await run.result).toBe("done");
    expect(events).toEqual(["start", "complete"]);
  });
});
