import { describe, expect, test } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { AggregatedSchedule } from "@/hooks/use-schedules";
import { formatNextAt, heartbeatMeta } from "./use-heartbeats";

describe("formatNextAt", () => {
  const now = new Date(2026, 9, 8, 10, 0);
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();

  test("a time today, a weekday and time this week, a date after that", () => {
    expect(formatNextAt(at(8, 15), now, "en-GB")).toBe("15:00");
    expect(formatNextAt(at(9, 9), now, "en-GB")).toBe("Fri 09:00");
    expect(formatNextAt(at(20, 9), now, "en-GB")).toBe("20 Oct 09:00");
  });

  test("a past time shows its date, and another year shows the year", () => {
    expect(formatNextAt(at(7, 15), now, "en-GB")).toBe("7 Oct 15:00");
    expect(formatNextAt(new Date(2027, 0, 1, 9, 0).toISOString(), now, "en-GB")).toBe(
      "1 Jan 2027 09:00",
    );
  });

  test("nothing when the schedule has no next run", () => {
    expect(formatNextAt(null, now)).toBe("");
    expect(formatNextAt("not a date", now)).toBe("");
  });
});

describe("heartbeatMeta", () => {
  const t = i18n.getFixedT("en");
  const base = {
    id: "s1",
    name: "Standup",
    prompt: "p",
    cadence: { type: "cron", expression: "*/2 * * * *", timezone: "UTC" },
    target: { type: "agent", agentId: "a" },
    status: "active",
    nextRunAt: null,
    maxRuns: 10,
    runCount: 3,
    serverId: "srv",
    serverName: "Host",
  } as unknown as AggregatedSchedule;

  test("says how often, how far along, and that it ended, in one short line", () => {
    expect(heartbeatMeta(base, t)).toBe("Every 2 minutes · 3 of 10 runs");
    expect(heartbeatMeta({ ...base, status: "completed", runCount: 10 }, t)).toBe(
      "Every 2 minutes · 10 of 10 runs · Ended",
    );
    expect(heartbeatMeta({ ...base, maxRuns: null, runCount: 1, status: "paused" }, t)).toBe(
      "Every 2 minutes · 1 run · Paused",
    );
  });
});
