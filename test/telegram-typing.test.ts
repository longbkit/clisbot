import { describe, expect, test } from "bun:test";
import { runWithTelegramTypingHeartbeat } from "../src/channels/telegram/typing.ts";

describe("runWithTelegramTypingHeartbeat", () => {
  test("sends typing immediately and keeps heartbeating while work is active", async () => {
    let sendCount = 0;
    let releaseRun!: () => void;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });

    const task = runWithTelegramTypingHeartbeat({
      intervalMs: 10,
      sendTyping: async () => {
        sendCount += 1;
      },
      run: async () => {
        await runGate;
      },
    });

    await Bun.sleep(35);
    releaseRun();
    await task;

    expect(sendCount).toBeGreaterThanOrEqual(3);
  });

  test("stops heartbeating after the work completes", async () => {
    let sendCount = 0;

    await runWithTelegramTypingHeartbeat({
      intervalMs: 10,
      sendTyping: async () => {
        sendCount += 1;
      },
      run: async () => {
        await Bun.sleep(12);
      },
    });

    const settledCount = sendCount;
    await Bun.sleep(25);

    expect(settledCount).toBeGreaterThanOrEqual(1);
    expect(sendCount).toBe(settledCount);
  });
});
