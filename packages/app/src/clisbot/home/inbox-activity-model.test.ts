import { expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { summarizeInboxActivity } from "./inbox-activity-model";
const ready = { status: "ready", hasAcceptedResult: true, message: null, serverId: null } as const;
const offline = {
  status: "unavailable",
  hasAcceptedResult: true,
  message: "Disconnected",
  serverId: "host-a",
  recovery: "connection",
} as const;
function agent(id: string, changes: Partial<AggregatedAgent> = {}): AggregatedAgent {
  return {
    id,
    serverId: "host-a",
    status: "idle",
    requiresAttention: false,
    attentionReason: null,
    pendingPermissionCount: 0,
    archivedAt: null,
    ...changes,
  } as AggregatedAgent;
}
it("counts Host-qualified sessions once across duplicate representations, excluding archived sessions", () => {
  const running = agent("same", { status: "running" });
  expect(
    summarizeInboxActivity(
      [
        running,
        running,
        { ...running, serverId: "host-b" },
        agent("archived", { status: "running", archivedAt: new Date() }),
      ],
      ready,
    ),
  ).toMatchObject({ active: 2, needs: 0, bucket: "running" });
});
it("preserves Needs you and unread meaning and the existing collapsed status precedence", () => {
  const agents = [
    agent("active", { status: "running" }),
    agent("approval", { pendingPermissionCount: 1 }),
    agent("error", { status: "error" }),
    agent("reply", { requiresAttention: true, attentionReason: "finished" }),
  ];
  expect(summarizeInboxActivity(agents, ready)).toMatchObject({
    active: 1,
    needs: 2,
    unread: 1,
    bucket: "needs_input",
  });
  expect(summarizeInboxActivity(agents.slice(2), ready)).toMatchObject({
    active: 0,
    needs: 1,
    unread: 1,
    bucket: "failed",
  });
  expect(summarizeInboxActivity(agents.slice(3), ready)).toMatchObject({
    needs: 0,
    unread: 1,
    bucket: "attention",
  });
  expect(summarizeInboxActivity([], ready)).toMatchObject({
    active: 0,
    bucket: "done",
    complete: true,
  });
});
it("retains accepted last-known activity offline and distinguishes an unknown empty catalog from zero", () => {
  expect(summarizeInboxActivity([agent("running", { status: "running" })], offline)).toMatchObject({
    active: 1,
    bucket: "running",
    complete: true,
    availability: "unavailable",
  });
  expect(summarizeInboxActivity([], { ...offline, hasAcceptedResult: false })).toMatchObject({
    active: 0,
    complete: false,
    availability: "unavailable",
  });
});
