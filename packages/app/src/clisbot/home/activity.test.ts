import { expect, test } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { activitySections } from "./activity";
import { activityContext, activityStatus } from "./activity-row";
function agent(id: string, date: Date, extra: Partial<AggregatedAgent> = {}): AggregatedAgent {
  return { id, lastActivityAt: date, status: "idle", ...extra } as AggregatedAgent;
}
test("attention precedes running; archived sessions stay in Recent with calendar date groups", () => {
  const today = new Date(2026, 9, 10, 12);
  const yesterday = new Date(2026, 9, 9, 23);
  const earlier = new Date(2026, 9, 7, 23);
  const sections = activitySections(
    [
      agent("older", earlier),
      agent("yesterday", yesterday),
      agent("today", today),
      agent("archived", today, { status: "error", archivedAt: today }),
      agent("running", earlier, { status: "running" }),
      agent("approval", earlier, {
        status: "running",
        requiresAttention: true,
        attentionReason: "permission",
      }),
      agent("replied", new Date(2026, 9, 7, 22), {
        requiresAttention: true,
        attentionReason: "finished",
      }),
    ],
    today,
  );
  expect(sections.slice(0, 5).map((s) => s.title)).toEqual([
    "Needs you",
    "Active",
    "Recent",
    "Today",
    "Yesterday",
  ]);
  expect(sections[0].agents.map((a) => a.id)).toEqual(["approval"]);
  expect(sections[1].agents.map((a) => a.id)).toEqual(["running"]);
  expect(sections[3].agents.map((a) => a.id)).toEqual(["today", "archived"]);
  // An unread reply is Recent, not Needs you.
  expect(sections.at(-1)?.agents.map((a) => a.id)).toEqual(["older", "replied"]);
});
test("Home limits each activity group without dropping the most recent rows", () => {
  const now = new Date(2026, 9, 10, 12);
  const rows = Array.from({ length: 8 }, (_, i) =>
    agent(String(i), new Date(now.getTime() - i * 1000)),
  );
  expect(
    activitySections(rows, now, 3)
      .flatMap((s) => s.agents)
      .map((a) => a.id),
  ).toEqual(["0", "1", "2"]);
});
test("a row says why it needs you and where it runs", () => {
  const now = new Date(2026, 9, 10, 12);
  const placement = {
    projectName: "clisbot",
    workspaceName: "fix-login",
    checkout: { currentBranch: "fix-login" },
  } as AggregatedAgent["projectPlacement"];
  const approval = agent("a", now, {
    requiresAttention: true,
    pendingPermissionCount: 1,
    projectPlacement: placement,
    serverLabel: "This Mac",
  });
  expect(activityStatus(approval)).toEqual({ label: "Needs approval", variant: "warning" });
  expect(activityStatus(agent("e", now, { status: "error" }))).toEqual({
    label: "Failed",
    variant: "error",
  });
  expect(activityStatus(agent("r", now, { status: "running" }))).toBeNull();
  expect(activityStatus(agent("x", now, { archivedAt: now }))?.label).toBe("Archived");
  // The branch is dropped when it repeats the workspace; the Host only with several Hosts.
  expect(activityContext(approval, false).map((part) => part.text)).toEqual([
    "clisbot",
    "fix-login",
  ]);
  expect(activityContext(approval, true).map((part) => part.field)).toEqual([
    "project",
    "workspace",
    "host",
  ]);
});
