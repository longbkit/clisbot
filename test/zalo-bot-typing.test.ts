import { describe, expect, test } from "bun:test";
import { beginZaloBotTypingHeartbeat } from "../src/channels/zalo-bot/typing.ts";

describe("beginZaloBotTypingHeartbeat", () => {
  test("sends typing immediately and keeps heartbeating while work is active", async () => {
    let sendCount = 0;

    const stopHeartbeat = await beginZaloBotTypingHeartbeat({
      intervalMs: 10,
      sendTyping: async () => {
        sendCount += 1;
      },
    });

    await Bun.sleep(35);
    stopHeartbeat();

    expect(sendCount).toBeGreaterThanOrEqual(2);
  });

  test("stops heartbeating after cleanup", async () => {
    let sendCount = 0;

    const stopHeartbeat = await beginZaloBotTypingHeartbeat({
      intervalMs: 10,
      sendTyping: async () => {
        sendCount += 1;
      },
    });

    await Bun.sleep(12);
    stopHeartbeat();

    const settledCount = sendCount;
    await Bun.sleep(25);

    expect(settledCount).toBeGreaterThanOrEqual(1);
    expect(sendCount).toBe(settledCount);
  });
});
