import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { isLatencyDebugEnabled, logLatencyDebug } from "../src/control/runtime/latency-debug.ts";

describe("latency debug", () => {
  const originalEnv = process.env.CLISBOT_DEBUG_LATENCY;

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.CLISBOT_DEBUG_LATENCY;
    } else {
      process.env.CLISBOT_DEBUG_LATENCY = originalEnv;
    }
    mock.restore();
  });

  test("stays disabled unless the env flag is enabled", () => {
    delete process.env.CLISBOT_DEBUG_LATENCY;
    expect(isLatencyDebugEnabled()).toBe(false);

    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    logLatencyDebug("stage", { platform: "slack" }, { elapsedMs: 10 });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  test("logs structured latency events when enabled", () => {
    process.env.CLISBOT_DEBUG_LATENCY = "1";
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    logLatencyDebug(
      "tmux-first-meaningful-delta",
      { platform: "slack", eventId: "evt-1", sessionKey: "main" },
      { elapsedMs: 4123 },
    );

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const message = consoleSpy.mock.calls[0]?.[0];
    expect(typeof message).toBe("string");
    expect(message).toContain("clisbot latency ");
    expect(message).toContain("\"stage\":\"tmux-first-meaningful-delta\"");
    expect(message).toContain("\"eventId\":\"evt-1\"");
    expect(message).toContain("\"sessionKey\":\"main\"");
    expect(message).toContain("\"elapsedMs\":4123");
  });
});
