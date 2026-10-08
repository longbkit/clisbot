import { describe, expect, it } from "vitest";
import type { StoredSchedule } from "@clisbot/protocol/schedule/types";
import { draftFromSchedule, patchMissesMaxRuns, scheduleDraftPatch } from "./schedule-draft";

const schedule: StoredSchedule = {
  id: "s1",
  name: "Check CI",
  prompt: "Check CI and report",
  cadence: { type: "cron", expression: "*/30 * * * *", timezone: "UTC" },
  target: { type: "agent", agentId: "agent-1" },
  status: "active",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: null,
  pausedAt: null,
  expiresAt: null,
  maxRuns: 20,
  runs: [],
};

describe("schedule draft", () => {
  it("asks for nothing until a field the sheet owns changes", () => {
    expect(scheduleDraftPatch(schedule, draftFromSchedule(schedule))).toBeNull();
  });

  it("sends only what changed, clearing a name and the run limit with null", () => {
    const draft = { ...draftFromSchedule(schedule), name: "  ", maxRuns: "" };
    expect(scheduleDraftPatch(schedule, draft)).toEqual({ name: null, maxRuns: null });
  });

  it("never sends an empty prompt", () => {
    expect(
      scheduleDraftPatch(schedule, { ...draftFromSchedule(schedule), prompt: " " }),
    ).toBeNull();
  });

  it("shows a cron without a timezone in UTC, as the daemon runs it, and asks for nothing", () => {
    const utc = { ...schedule, cadence: { type: "cron" as const, expression: "0 9 * * *" } };
    const draft = draftFromSchedule(utc);
    expect(draft.cadence).toEqual({ type: "cron", expression: "0 9 * * *", timezone: "UTC" });
    expect(scheduleDraftPatch(utc, draft)).toBeNull();
  });

  it("sends a changed cron cadence", () => {
    const cadence = { type: "cron" as const, expression: "0 9 * * 1-5", timezone: "UTC" };
    expect(scheduleDraftPatch(schedule, { ...draftFromSchedule(schedule), cadence })).toEqual({
      cadence,
    });
  });

  it("needs Max runs once a change leaves it repeating within the day without one", () => {
    const cleared = scheduleDraftPatch(schedule, { ...draftFromSchedule(schedule), maxRuns: "" });
    expect(patchMissesMaxRuns(schedule, cleared)).toBe(true);
    const daily = { type: "cron" as const, expression: "0 7 * * *", timezone: "UTC" };
    const dailyCleared = scheduleDraftPatch(schedule, {
      ...draftFromSchedule(schedule),
      maxRuns: "",
      cadence: daily,
    });
    expect(patchMissesMaxRuns(schedule, dailyCleared)).toBe(false);
  });

  it("leaves an older schedule without Max runs editable outside cadence and Max runs", () => {
    const older = { ...schedule, maxRuns: null };
    const renamed = scheduleDraftPatch(older, { ...draftFromSchedule(older), name: "Renamed" });
    expect(patchMissesMaxRuns(older, renamed)).toBe(false);
  });
});
