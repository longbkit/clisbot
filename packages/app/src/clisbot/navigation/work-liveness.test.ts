import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { selectWorkspaceSessions } from "@/clisbot/workspace-sessions/select-sessions";
import { indexWorkSessions } from "./work-filter";
import {
  countWork,
  createWorkFilter,
  matchesWorkChip,
  workItemsOf,
  type WorkQuery,
  type WorkWorkspace,
} from "./work-items";

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  const now = new Date("2026-10-27T00:00:00Z");
  return {
    id,
    serverId: "h",
    provider: "codex",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    lastUserMessageAt: null,
    capabilities: {} as Agent["capabilities"],
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: id,
    cwd: "/synthetic",
    model: null,
    parentAgentId: null,
    workspaceId: "ws",
    labels: {},
    ...overrides,
  } as Agent;
}
const permission = {
  key: "p1",
  agentId: "approval",
} as unknown as Agent["pendingPermissions"][number];
const agents = new Map(
  [
    agent("running", { status: "running" }),
    agent("approval", { status: "running", pendingPermissions: [permission] }),
    agent("failed", { status: "error" }),
    agent("idle"),
  ].map((entry) => [entry.id, entry]),
);
const source = { agents, messageSubmissions: new Map() };
const bucketsOf = (cached: boolean) => {
  const sessions = indexWorkSessions(new Map([["srv", { ...source, cached }]])).get("srv:ws") ?? [];
  return Object.fromEntries(sessions.map((entry) => [entry.id, entry]));
};

describe("Workspace sessions on a source that is not live", () => {
  it("reads the raw status while the source is live", () => {
    const live = bucketsOf(false);
    expect(live.running).toMatchObject({ statusBucket: "running" });
    expect(live.approval).toMatchObject({ statusBucket: "needs_input" });
    expect(live.running?.unverified).toBeFalsy();
  });

  it("shows neither Running nor an approval for a cached source, and does not call it Done", () => {
    const cached = bucketsOf(true);
    for (const id of ["running", "approval"]) {
      expect(cached[id]?.statusBucket).not.toBe("running");
      expect(cached[id]?.statusBucket).not.toBe("needs_input");
      expect(cached[id]?.unverified).toBe(true);
      for (const chip of ["running", "needs", "done"] as const)
        expect(matchesWorkChip(cached[id]!, chip)).toBe(false);
      expect(matchesWorkChip(cached[id]!, "all")).toBe(true);
    }
    // A failure is a fact; a truly idle session is Done even on a cached source.
    expect(cached.failed).toMatchObject({ statusBucket: "failed" });
    expect(cached.idle).toMatchObject({ statusBucket: "done" });
    expect(cached.idle?.unverified).toBeFalsy();
  });

  it("draws the session lines of a cached source without a live status either", () => {
    const lines = selectWorkspaceSessions({
      source: { ...source, cached: true },
      workspaceId: "ws",
      activeOnly: false,
    });
    const bucket = Object.fromEntries(lines.map((line) => [line.agent.id, line.statusBucket]));
    expect(bucket.running).not.toBe("running");
    expect(bucket.approval).not.toBe("needs_input");
    expect(lines.find((line) => line.agent.id === "running")?.unverified).toBe(true);
  });
});

describe("Workspace counts over registered Hosts", () => {
  const reader = { origin: "https://hub.example", id: "me", memberId: "m" };
  const workspaceOf = (serverId: string): WorkWorkspace => ({
    workspaceKey: `${serverId}:ws`,
    serverId,
    workspaceId: "ws",
    statusBucket: "running",
  });
  const live = workspaceOf("live");
  const offline = workspaceOf("offline");
  const sessions = new Map([
    ["live:ws", [{ id: "a", statusBucket: "running" }]],
    ["offline:ws", [{ id: "b", statusBucket: "done", unverified: true }]],
  ]);
  const sessionsOf = (ws: WorkWorkspace) => sessions.get(ws.workspaceKey) ?? null;
  const query = (chip: WorkQuery["chip"]): WorkQuery => ({
    scope: "all",
    chip,
    accounts: [reader],
    showBots: true,
    cachedServerIds: new Set(["offline"]),
  });

  it("counts Running once, for the live Host only", () => {
    const counts = countWork([live, offline], sessionsOf, query("all"));
    expect(counts.chips).toMatchObject({ all: 2, running: 1, done: 0, needs: 0 });
    const filter = createWorkFilter(query("running"), sessionsOf);
    expect(filter.workspace(live)).toBe(true);
    expect(filter.workspace(offline)).toBe(false);
  });

  it("gives a cached workspace with no session list no live status", () => {
    const items = workItemsOf({ ...offline, statusBucket: "needs_input" }, null, true, true);
    expect(items).toHaveLength(1);
    expect(items[0]?.unverified).toBe(true);
    expect(matchesWorkChip(items[0]!, "needs")).toBe(false);
    const liveItems = workItemsOf({ ...live, statusBucket: "needs_input" }, null, true, false);
    expect(matchesWorkChip(liveItems[0]!, "needs")).toBe(true);
  });
});
