import { describe, expect, test } from "bun:test";
import {
  clampSlackText,
  getSlackSafeMaxChars,
  isSlackMsgTooLongError,
  SLACK_SOFT_TEXT_LIMIT,
  splitSlackText,
} from "../src/channels/slack/platform-text.ts";

describe("slack platform text", () => {
  test("caps configured max chars to the Slack-safe limit", () => {
    expect(getSlackSafeMaxChars(3500)).toBe(SLACK_SOFT_TEXT_LIMIT);
    expect(getSlackSafeMaxChars(1200)).toBe(1200);
  });

  test("clamps oversized Slack text bodies", () => {
    const text = "a".repeat(SLACK_SOFT_TEXT_LIMIT + 50);
    const clamped = clampSlackText(text);

    expect(clamped.length).toBeLessThanOrEqual(SLACK_SOFT_TEXT_LIMIT);
    expect(clamped.endsWith("\n...")).toBe(true);
  });

  test("detects Slack msg_too_long platform errors", () => {
    expect(
      isSlackMsgTooLongError({
        data: {
          error: "msg_too_long",
        },
      }),
    ).toBe(true);

    expect(
      isSlackMsgTooLongError({
        data: {
          error: "other_error",
        },
      }),
    ).toBe(false);
  });

  test("splits long Slack text into ordered chunks within the platform limit", () => {
    const parts = [
      "Intro",
      "",
      "A".repeat(1200),
      "",
      "B".repeat(1200),
      "",
      "C".repeat(1200),
    ];
    const chunks = splitSlackText(parts.join("\n"), 1500);

    expect(chunks.length).toBe(3);
    expect(chunks.every((chunk) => chunk.length <= 1500)).toBe(true);
    expect(chunks.join("\n\n")).toBe(parts.join("\n"));
  });

  test("splits oversized fenced code blocks into valid fenced chunks", () => {
    const block = [
      "Here is the log:",
      "",
      "```text",
      "line 1",
      "line 2",
      "x".repeat(140),
      "line 4",
      "```",
    ].join("\n");

    const chunks = splitSlackText(block, 120);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
    expect(chunks.filter((chunk) => chunk.includes("```text")).length).toBeGreaterThan(0);
    expect(chunks.filter((chunk) => chunk.endsWith("```")).length).toBeGreaterThan(0);
  });
});
