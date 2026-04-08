import { describe, expect, test } from "bun:test";
import {
  isImplicitFollowUpAllowed,
  resolveFollowUpMode,
  shouldReactivateFollowUpOnExplicitMention,
} from "../src/agents/follow-up-policy.ts";

describe("follow-up policy", () => {
  test("uses the runtime override when present", () => {
    expect(
      resolveFollowUpMode({
        defaultMode: "auto",
        overrideMode: "mention-only",
      }),
    ).toBe("mention-only");
    expect(
      resolveFollowUpMode({
        defaultMode: "mention-only",
      }),
    ).toBe("mention-only");
  });

  test("allows implicit follow-up only for active auto mode", () => {
    expect(
      isImplicitFollowUpAllowed({
        mode: "auto",
        participationTtlMs: 1_000,
        lastBotReplyAt: 9_500,
        now: 10_000,
      }),
    ).toBe(true);
    expect(
      isImplicitFollowUpAllowed({
        mode: "auto",
        participationTtlMs: 1_000,
        lastBotReplyAt: 8_900,
        now: 10_000,
      }),
    ).toBe(false);
    expect(
      isImplicitFollowUpAllowed({
        mode: "mention-only",
        participationTtlMs: 1_000,
        lastBotReplyAt: 9_500,
        now: 10_000,
      }),
    ).toBe(false);
  });

  test("accepts direct replies to the bot as implicit auto follow-up", () => {
    expect(
      isImplicitFollowUpAllowed({
        mode: "auto",
        participationTtlMs: 1,
        directReplyToBot: true,
      }),
    ).toBe(true);
  });

  test("reactivates paused mode only on an explicit mention", () => {
    expect(
      shouldReactivateFollowUpOnExplicitMention({
        overrideMode: "paused",
        explicitlyMentioned: true,
      }),
    ).toBe(true);
    expect(
      shouldReactivateFollowUpOnExplicitMention({
        overrideMode: "paused",
        explicitlyMentioned: false,
      }),
    ).toBe(false);
  });
});
