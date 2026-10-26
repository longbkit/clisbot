import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { UsageReportEntry } from "@/usage/types";
import { chatSessionAgent } from "./opened-session";
import { sessionQuotaLines } from "./session-quota";

const now = Date.parse("2026-10-26T10:00:00Z");
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

function report(windows: Record<string, unknown>[]): UsageReportEntry {
  return {
    id: "codex:me",
    account: {},
    fetchedAt: at(0),
    sourceId: "codex",
    sourceLabel: "Codex",
    report: { status: "available", windows } as UsageReportEntry["report"],
  } as UsageReportEntry;
}

describe("sessionQuotaLines", () => {
  const t = i18n.getFixedT("en");

  it("shows the hour window then the weekly one, each reset in its largest unit", () => {
    const lines = sessionQuotaLines(
      [
        report([
          { id: "weekly", label: "Weekly", usedPct: 12, resetsAt: at(26 * 60 + 5) },
          { id: "opus:weekly", label: "Opus · Weekly", usedPct: 90, resetsAt: at(60) },
          { id: "five_hour", label: "Session", usedPct: 37, resetsAt: at(70) },
        ]),
      ],
      "used",
      now,
      t,
    );
    // 1 day 2 hours reads 1d; 1 hour 10 minutes reads 1h; a scoped weekly limit is left out.
    expect(lines).toMatchObject([
      { kind: "hour", percent: "37%", value: 37, reset: "1h" },
      { kind: "week", percent: "12%", value: 12, reset: "1d" },
    ]);
  });

  it("follows the used / remaining preference and reads minutes under an hour", () => {
    const lines = sessionQuotaLines(
      [report([{ id: "five_hour", label: "Session", usedPct: 37, resetsAt: at(30) }])],
      "remaining",
      now,
      t,
    );
    expect(lines).toMatchObject([{ kind: "hour", percent: "63%", value: 63, reset: "30m" }]);
  });

  it("skips reports without either window, and unavailable ones", () => {
    const unavailable = {
      ...report([]),
      report: { status: "error", error: "boom" },
    } as UsageReportEntry;
    expect(
      sessionQuotaLines([unavailable, report([{ id: "monthly", label: "M" }])], "used", now, t),
    ).toEqual([]);
  });
});

describe("chatSessionAgent", () => {
  it("takes the chat's most recently active agent", () => {
    const agent = (id: string, chat: string, minutes: number) => ({
      id,
      labels: { "clisbot.chat-id": chat },
      lastActivityAt: new Date(now + minutes * 60_000),
    });
    expect(
      chatSessionAgent([agent("a", "c1", 1), agent("b", "c1", 5), agent("c", "c2", 9)], "c1"),
    ).toBe("b");
    expect(chatSessionAgent([agent("a", "c1", 1)], "c3")).toBeNull();
  });
});
