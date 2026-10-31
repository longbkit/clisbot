import { describe, expect, it } from "vitest";
import type { Agent } from "./session-store";
import { advanceWorkspaceRootAgents, workspaceRootAgentsOf } from "./workspace-root-agents";

function agent(
  id: string,
  input: {
    workspaceId?: string;
    createdAt?: string;
    parentAgentId?: string;
    archived?: boolean;
    title?: string;
  } = {},
): Agent {
  return {
    serverId: "host",
    id,
    provider: "codex",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: new Date(input.createdAt ?? "2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    lastUserMessageAt: null,
    lastActivityAt: new Date("2026-10-01T00:00:00.000Z"),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: input.title ?? null,
    cwd: "/repo",
    workspaceId: input.workspaceId,
    model: null,
    archivedAt: input.archived ? new Date("2026-10-02T00:00:00.000Z") : null,
    parentAgentId: input.parentAgentId ?? null,
    labels: {},
  };
}

function directory(...agents: Agent[]): Map<string, Agent> {
  return new Map(agents.map((entry) => [entry.id, entry]));
}

function ids(agents: readonly Agent[] | undefined): string[] {
  return (agents ?? []).map((entry) => entry.id);
}

describe("workspace root agents", () => {
  it("lists each workspace's unarchived root agents, oldest first", () => {
    const agents = directory(
      agent("newer", { workspaceId: "w", createdAt: "2026-10-03T00:00:00.000Z" }),
      agent("older", { workspaceId: "w", createdAt: "2026-10-02T00:00:00.000Z" }),
      agent("archived", { workspaceId: "w", archived: true }),
      agent("subagent", { workspaceId: "w", parentAgentId: "older" }),
      agent("other", { workspaceId: "v" }),
      agent("loose"),
    );

    const index = workspaceRootAgentsOf(agents);

    expect(Object.fromEntries([...index].map(([key, list]) => [key, ids(list)]))).toEqual({
      w: ["older", "newer"],
      v: ["other"],
    });
    expect(workspaceRootAgentsOf(agents)).toBe(index);
  });

  it("rebuilds only the workspaces whose agents changed", () => {
    const previous = directory(agent("a", { workspaceId: "w" }), agent("b", { workspaceId: "v" }));
    const before = workspaceRootAgentsOf(previous);
    const next = new Map(previous);
    next.set("a", agent("a", { workspaceId: "w", title: "renamed" }));

    const touched = advanceWorkspaceRootAgents(previous, next);

    const after = workspaceRootAgentsOf(next);
    expect([...(touched ?? [])]).toEqual(["w"]);
    expect(after.get("v")).toBe(before.get("v"));
    expect(after.get("w")?.[0]?.title).toBe("renamed");
  });

  it("keeps the same index when no agent changed", () => {
    const previous = directory(agent("a", { workspaceId: "w" }));
    const before = workspaceRootAgentsOf(previous);
    const next = new Map(previous);

    const touched = advanceWorkspaceRootAgents(previous, next);

    expect([...(touched ?? [])]).toEqual([]);
    expect(workspaceRootAgentsOf(next)).toBe(before);
  });

  it("moves a subagent into its own workspace's list when its parent leaves", () => {
    const previous = directory(
      agent("parent", { workspaceId: "w" }),
      agent("child", { workspaceId: "w", parentAgentId: "parent" }),
    );
    workspaceRootAgentsOf(previous);
    const next = new Map(previous);
    next.set("parent", agent("parent", { workspaceId: "v" }));

    const touched = advanceWorkspaceRootAgents(previous, next);

    const after = workspaceRootAgentsOf(next);
    expect(new Set(touched)).toEqual(new Set(["w", "v"]));
    expect({ w: ids(after.get("w")), v: ids(after.get("v")) }).toEqual({
      w: ["child"],
      v: ["parent"],
    });
  });

  it("drops a removed or archived agent from its workspace", () => {
    const previous = directory(agent("a", { workspaceId: "w" }), agent("b", { workspaceId: "w" }));
    workspaceRootAgentsOf(previous);
    const next = directory(agent("a", { workspaceId: "w", archived: true }));

    advanceWorkspaceRootAgents(previous, next);

    expect(workspaceRootAgentsOf(next).has("w")).toBe(false);
  });

  it("reports nothing touched when the previous directory was never indexed", () => {
    const touched = advanceWorkspaceRootAgents(
      new Map(),
      directory(agent("a", { workspaceId: "w" })),
    );

    expect(touched).toBeNull();
  });
});
