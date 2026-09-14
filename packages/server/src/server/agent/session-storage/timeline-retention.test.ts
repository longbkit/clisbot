import { expect, test } from "vitest";
import { TimelineRetentionBudget } from "./timeline-retention.js";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
const row = (seq: number): AgentTimelineRow => ({
  seq,
  timestamp: "2026-09-11",
  item: { type: "assistant_message", text: "x".repeat(100) },
});
test("committed retention stays bounded per session and across hidden sessions", () => {
  const discarded: Array<{ id: string; seqs: number[] }> = [];
  const budget = new TimelineRetentionBudget(
    (id, seqs) => discarded.push({ id, seqs: [...seqs] }),
    { sessionBytes: 1500, totalBytes: 2500 },
  );
  for (let seq = 1; seq <= 1000; seq++) budget.retain("a", [row(seq)]);
  expect(budget.bytes).toBeLessThanOrEqual(1500);
  expect(discarded.flatMap((entry) => entry.seqs)).toContain(1);
  budget.retain("b", [row(1), row(2)]);
  budget.retain("c", [row(1), row(2)]);
  expect(budget.bytes).toBeLessThanOrEqual(2500);
  expect(discarded.some((entry) => entry.id === "a" && entry.seqs.includes(1000))).toBe(true);
  budget.delete("a");
  budget.delete("b");
  budget.delete("c");
  expect(budget.bytes).toBe(0);
});
