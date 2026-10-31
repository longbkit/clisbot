import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@/stores/session-store";
import {
  createAggregatedAgentProjector,
  createMemoizedAggregatedAgentProjector,
  sharedAggregatedAgentProjector,
  type AggregatedAgentSources,
} from "./aggregated-agent-projector";

function agent({ id, ...overrides }: Partial<Agent> & { id: string }): Agent {
  const now = new Date("2026-10-14T00:00:00Z");
  return {
    id,
    serverId: "host-a",
    provider: "codex",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    lastUserMessageAt: null,
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
    title: id,
    cwd: "/synthetic",
    model: null,
    parentAgentId: null,
    labels: {},
    ...overrides,
  };
}
function input(...agents: Agent[]): AggregatedAgentSources {
  return {
    hosts: [{ serverId: "host-a", label: "Host A" }],
    includeArchived: false,
    sessionAgents: { "host-a": new Map(agents.map((entry) => [entry.id, entry])) },
  };
}

describe("aggregated agent projection", () => {
  it("keeps untouched rows and the sorted array stable across unrelated source updates", () => {
    const project = createAggregatedAgentProjector();
    const a = agent({ id: "a" });
    const b = agent({ id: "b" });
    const first = project(input(a, b));
    const internalUpdate = agent({ id: "a", updatedAt: new Date("2026-10-14T01:00:00Z") });
    expect(project(input(internalUpdate, b))).toBe(first);
    const renamed = project(input({ ...internalUpdate, title: "Renamed" }, b));
    expect(renamed[0].title).toBe("Renamed");
    expect(renamed[1]).toBe(first[1]);
  });

  it("keeps source identity distinct across Hosts and refreshes renamed Host labels", () => {
    const project = createAggregatedAgentProjector();
    const a = agent({ id: "same-id" });
    const sources = input(a);
    sources.sessionAgents["host-b"] = new Map([[a.id, a]]);
    const first = project(sources);
    expect(first.map((entry) => entry.serverLabel)).toEqual(["Host A", "host-b"]);
    const renamed = project({ ...sources, hosts: [{ serverId: "host-a", label: "Renamed Host" }] });
    expect(renamed[0].serverLabel).toBe("Renamed Host");
    expect(renamed[1]).toBe(first[1]);
  });

  it("sorts open turns first, then activity, and preserves attention and archive changes", () => {
    const project = createAggregatedAgentProjector();
    const recent = agent({ id: "recent", lastActivityAt: new Date("2026-10-14T02:00:00Z") });
    const open = agent({
      id: "open",
      turn: { phase: "open", turnId: "turn", startedAt: new Date(), cancellationRequestId: null },
    });
    const archived = agent({ id: "archived", archivedAt: new Date("2026-10-14T01:00:00Z") });
    expect(project(input(recent, archived, open)).map((entry) => entry.id)).toEqual([
      "open",
      "recent",
    ]);
    const next = project(
      input(
        { ...recent, status: "error", requiresAttention: true, attentionReason: "error" },
        open,
      ),
    );
    expect(next[1]).toMatchObject({
      status: "error",
      requiresAttention: true,
      attentionReason: "error",
    });
    const restored = project({ ...input(recent, archived, open), includeArchived: true });
    expect(restored.map((entry) => entry.id)).toEqual(["open", "recent", "archived"]);
  });

  it("forgets removed sources rather than retaining every historical projection", () => {
    const project = createAggregatedAgentProjector();
    const a = agent({ id: "a" });
    const first = project(input(a));
    expect(project(input())).toEqual([]);
    expect(project(input(a))[0]).not.toBe(first[0]);
  });
});

describe("shared aggregated agent projection", () => {
  it("answers an equal input with the same array and recomputes when a source changes", () => {
    const project = createMemoizedAggregatedAgentProjector();
    const sources = input(agent({ id: "a" }), agent({ id: "b" }));
    const first = project(sources);
    const again = project({ ...sources, hosts: [{ serverId: "host-a", label: "Host A" }] });
    expect(again).toBe(first);
    const renamedHost = project({ ...sources, hosts: [{ serverId: "host-a", label: "Renamed" }] });
    expect(renamedHost[0]?.serverLabel).toBe("Renamed");
    const archived = project({ ...sources, includeArchived: true });
    expect(archived).not.toBe(renamedHost);
  });

  it("hands every consumer of a view the same projector", () => {
    expect(sharedAggregatedAgentProjector(false)).toBe(sharedAggregatedAgentProjector(false));
    expect(sharedAggregatedAgentProjector(true)).not.toBe(sharedAggregatedAgentProjector(false));
  });
});

it("projects all participant identities once per immutable source without comparing profiles or arrays", () => {
  const own = { kind: "user" as const, id: "me", hubOrigin: "https://hub" };
  const profile = vi.fn(() => {
    throw new Error("participant profile traversed");
  });
  const participants = Array.from({ length: 500 }, (_, index) => ({
    ...own,
    id: String(index),
    get displayName(): string {
      return profile();
    },
  }));
  const read = vi.fn(() => participants);
  const legacy = agent({ id: "legacy" });
  Object.defineProperty(legacy, "participantActors", { get: read });
  const authored = agent({ id: "authored", createdBy: own });
  const authoredRead = vi.fn(() => participants);
  Object.defineProperty(authored, "participantActors", { get: authoredRead });
  const project = createMemoizedAggregatedAgentProjector();
  const sources = input(legacy, authored);
  const first = project(sources);
  for (let i = 0; i < 5; i++) expect(project({ ...sources })).toBe(first);
  expect(read).toHaveBeenCalledTimes(1);
  expect(authoredRead).toHaveBeenCalledTimes(1);
  expect(profile).not.toHaveBeenCalled();
  expect(first.find((row) => row.id === "legacy")?.participationKey).toBeTypeOf("string");
  expect(first.find((row) => row.id === "authored")?.participationKey).toBeTypeOf("string");
  expect(first.every((row) => !("participantActors" in row))).toBe(true);
  const renamed = agent({
    ...legacy,
    participantActors: participants.map(({ kind, id, hubOrigin }) => ({
      kind,
      id,
      hubOrigin,
      displayName: "New profile",
    })),
  });
  expect(project(input(renamed, authored))).toBe(first);
  const changed = agent({ ...renamed, participantActors: [own] });
  expect(project(input(changed, authored))).not.toBe(first);
});
