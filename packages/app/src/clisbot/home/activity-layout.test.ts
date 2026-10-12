import { expect, test } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { activityLayout, activityLayoutChanges, visibleActivityLayout } from "./activity-layout";

const now = new Date(2026, 9, 12, 12);
function agent(
  id: string,
  time: number,
  status: AggregatedAgent["status"] = "idle",
  serverId = "a",
) {
  return {
    id,
    serverId,
    status,
    lastActivityAt: new Date(now.getTime() + time),
  } as AggregatedAgent;
}
const keys = (layout: ReturnType<typeof activityLayout>) =>
  layout.flatMap((section) => section.keys);

test("streaming active rows keep their order; a newly running conversation joins at the end", () => {
  const first = activityLayout([agent("one", 1, "running"), agent("two", 2, "running")], now);
  const next = activityLayout(
    [agent("one", 9, "running"), agent("two", 2, "running"), agent("three", 10, "running")],
    now,
    first,
  );
  expect(keys(next)).toEqual(["a:two", "a:one", "a:three"]);
  expect(activityLayoutChanges(first, next)).toBe(1);
  expect(keys(first)).toEqual(["a:two", "a:one"]);
});

test("pending membership changes are counted once; accepted layouts hold only identities", () => {
  const first = activityLayout([agent("same", 1, "running"), agent("same", 2, "idle", "b")], now);
  const next = activityLayout([agent("same", 3), agent("same", 2, "error", "b")], now, first);
  expect(activityLayoutChanges(first, next)).toBe(2);
  expect(first).toEqual([
    { key: "active", title: "Active", keys: ["a:same"] },
    { key: "recent", title: "Recent", keys: [] },
    { key: "date:Today", title: "Today", keys: ["b:same"] },
  ]);
});

test("new Recent rows do not count every shifted row as an update; removals and reorders are detected", () => {
  const first = activityLayout([agent("one", 1), agent("two", 2)], now);
  const added = activityLayout([agent("one", 1), agent("two", 2), agent("three", 3)], now, first);
  expect(activityLayoutChanges(first, added)).toBe(1);
  expect(activityLayoutChanges(first, activityLayout([agent("two", 2)], now))).toBe(1);
  expect(
    activityLayoutChanges(first, activityLayout([agent("one", 3), agent("two", 2)], now)),
  ).toBe(2);
});

test("Recent's limit spans dates and grows without resorting the accepted order", () => {
  const rows = Array.from({ length: 14 }, (_, i) => agent(String(i), -i * 86400000));
  const layout = activityLayout(rows, now);
  expect(keys(visibleActivityLayout(layout, 10))).toEqual(
    rows.slice(0, 10).map((a) => `a:${a.id}`),
  );
  expect(keys(visibleActivityLayout(layout, 20))).toHaveLength(14);
  expect(activityLayoutChanges(layout, activityLayout(rows.toReversed(), now, layout))).toBe(0);
});
