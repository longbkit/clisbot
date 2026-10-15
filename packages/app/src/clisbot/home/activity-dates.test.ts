import { expect, test } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { activitySections } from "./activity";

function recent(id: string, date: Date): AggregatedAgent {
  return { id, lastActivityAt: date, status: "idle" } as AggregatedAgent;
}

test("calendar groups retain local date labels, order and per-group limits", () => {
  const now = new Date(2026, 9, 15, 12);
  const older = new Date(2026, 9, 12, 23);
  const olderLabel = older.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const rows = [
    recent("older-morning", new Date(2026, 9, 12, 1)),
    recent("yesterday", new Date(2026, 9, 14, 23, 59)),
    recent("today", new Date(2026, 9, 15, 0)),
    recent("older-evening", older),
    recent("earlier", new Date(2026, 9, 11, 23)),
  ];

  expect(
    activitySections(rows, now, 4).map(({ key, title, agents }) => ({
      key,
      title,
      ids: agents.map((agent) => agent.id),
    })),
  ).toEqual([
    { key: "recent", title: "Recent", ids: [] },
    { key: "date:Today", title: "Today", ids: ["today"] },
    { key: "date:Yesterday", title: "Yesterday", ids: ["yesterday"] },
    {
      key: `date:${olderLabel}`,
      title: olderLabel,
      ids: ["older-evening", "older-morning"],
    },
  ]);
  expect(rows.map((agent) => agent.id)).toEqual([
    "older-morning",
    "yesterday",
    "today",
    "older-evening",
    "earlier",
  ]);
});

test("an invalid historical timestamp keeps its existing display instead of throwing", () => {
  const invalid = new Date(Number.NaN);
  expect(activitySections([recent("unknown", invalid)], new Date(2026, 9, 15)).at(-1)).toEqual({
    key: `date:${invalid.toLocaleDateString()}`,
    title: invalid.toLocaleDateString(),
    agents: [recent("unknown", invalid)],
  });
});
