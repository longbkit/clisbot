import { describe, expect, test } from "bun:test";
import {
  renderLoopStartNotification,
  renderQueueStartNotification,
} from "../src/channels/config/surface-notifications.ts";

describe("surface notifications", () => {
  test("renders queue-start notification modes", () => {
    expect(
      renderQueueStartNotification({
        mode: "none",
        agentId: "default",
        promptSummary: "summarize the regression",
      }),
    ).toBeUndefined();

    expect(
      renderQueueStartNotification({
        mode: "brief",
        agentId: "default",
        promptSummary: "summarize the regression",
      }),
    ).toBe("Queued message is now running: `summarize the regression`.");

    expect(
      renderQueueStartNotification({
        mode: "full",
        agentId: "default",
        promptSummary: "summarize the regression",
      }),
    ).toBe("Queued message is now running for agent `default`: `summarize the regression`.");
  });

  test("renders loop-start notification modes", () => {
    expect(
      renderLoopStartNotification({
        mode: "none",
        agentId: "default",
        loopId: "loop123",
        promptSummary: "daily review",
        intervalMs: 7_200_000,
        nextRunAt: Date.parse("2026-04-15T09:00:00.000Z"),
        remainingRuns: 4,
        maxRuns: 10,
      }),
    ).toBeUndefined();

    expect(
      renderLoopStartNotification({
        mode: "brief",
        agentId: "default",
        loopId: "loop123",
        promptSummary: "daily review",
        intervalMs: 7_200_000,
        nextRunAt: Date.parse("2026-04-15T09:00:00.000Z"),
        remainingRuns: 4,
        maxRuns: 10,
      }),
    ).toBe(
      "Loop `loop123` is now running: `daily review` · every 2h · next run `2026-04-15T09:00:00.000Z` · remaining `4/10`.",
    );

    expect(
      renderLoopStartNotification({
        mode: "full",
        agentId: "default",
        loopId: "loop123",
        promptSummary: "daily review",
        cadence: "weekday",
        localTime: "07:00",
        timezone: "UTC",
        nextRunAt: Date.parse("2026-04-15T09:00:00.000Z"),
        remainingRuns: 4,
        maxRuns: 10,
        kind: "calendar",
      }),
    ).toBe(
      "Loop `loop123` is now running for agent `default`: `daily review` · every weekday at 07:00 · next run `2026-04-15T09:00:00.000Z` · remaining `4/10`.",
    );
  });
});
