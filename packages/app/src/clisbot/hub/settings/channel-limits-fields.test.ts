import { describe, expect, it } from "vitest";
import { authoredLimits } from "../channel-configuration";
import {
  channelLimitsDraft,
  channelLimitsSummary,
  parseChannelLimitsDraft,
} from "./channel-limits-fields";

describe("channel limits form", () => {
  it("round-trips numbers, off, and unset leaves", () => {
    const authored = { maxConcurrentRuns: 25, maxInputCharacters: "off" as const };
    const parsed = parseChannelLimitsDraft(channelLimitsDraft(authored));
    expect(parsed).toEqual({ valid: true, value: authored });
  });

  it("writes nothing when every leaf is left at its default", () => {
    const parsed = parseChannelLimitsDraft(channelLimitsDraft(undefined));
    expect(parsed).toEqual({ valid: true, value: {} });
    expect(authoredLimits(parsed.valid ? parsed.value : undefined)).toBeUndefined();
  });

  it("refuses a set leaf that is not a positive whole number", () => {
    const draft = channelLimitsDraft(undefined);
    for (const value of ["", "0", "-2", "1.5", "abc"]) {
      const parsed = parseChannelLimitsDraft({
        ...draft,
        messagesSentPerMinute: { mode: "custom", value },
      });
      expect(parsed.valid).toBe(false);
    }
  });

  it("summarizes only what is set", () => {
    expect(channelLimitsSummary(undefined)).toBe("Default limits");
    expect(channelLimitsSummary({ maxConcurrentRuns: 3, maxRuntimeSeconds: "off" })).toBe(
      "Concurrent runs: 3 · Maximum runtime (seconds): off",
    );
  });
});
