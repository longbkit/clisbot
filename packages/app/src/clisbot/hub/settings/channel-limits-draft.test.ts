import { describe, expect, it } from "vitest";
import { authoredLimits } from "../channel-configuration";
import {
  RULE_LIMIT_NAMES,
  channelLimitsDraft,
  channelLimitsSummary,
  parseChannelLimitsDraft,
  ruleLimitDefaults,
} from "./channel-limits-draft";

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
      "Concurrent runs: 3 · Run time: off",
    );
  });

  it("never writes the bot's posting rate for a Rule", () => {
    const draft = channelLimitsDraft({ messagesSentPerMinute: 5, maxConcurrentRuns: 2 });
    expect(parseChannelLimitsDraft(draft, RULE_LIMIT_NAMES)).toEqual({
      valid: true,
      value: { maxConcurrentRuns: 2 },
    });
  });

  it("shows a Rule the Route's limit first, then the open-Route default for Anyone", () => {
    // As the Hub reads it (`ruleLimits`): a Route leaf stands in for the
    // default, and turned off it leaves none.
    const route = { messagesPerMinute: 100, maxInputCharacters: "off" as const };
    expect(ruleLimitDefaults(route, true)).toEqual({
      messagesPerMinutePerSender: 10,
      messagesPerMinute: 100,
      maxConcurrentRuns: 8,
      maxRuntimeSeconds: 900,
    });
    expect(ruleLimitDefaults(route, false)).toEqual({ messagesPerMinute: 100 });
    expect(ruleLimitDefaults({}, false)).toEqual({});
  });
});
