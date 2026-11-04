import { describe, expect, it } from "vitest";
import type { SessionAuthorship } from "@clisbot/protocol/session-authorship";
import { createAggregatedAgentProjector } from "@/hooks/aggregated-agent-projector";
import type { Agent } from "@/stores/session-store";
import { advanceWorkspaceRootAgents, workspaceRootAgentsOf } from "@/stores/workspace-root-agents";
import { indexWorkSessions } from "./work-filter";
import { countWork } from "./work-items";
import { agentOwnershipEvidence, type InheritanceSource } from "./ownership-inheritance";
import { ownershipKey } from "./ownership-key";
import { resolveOwnership } from "./ownership";

const HUB = "https://hub.example";
const accounts = [{ origin: HUB, id: "u-me", memberId: "m-me" }];
const me = { kind: "user" as const, id: "u-me", hubOrigin: HUB, memberId: "m-me" };
const teammate = { kind: "user" as const, id: "u-2", hubOrigin: HUB, memberId: "m-2" };

function session(
  id: string,
  parentAgentId: string | null,
  authorship: SessionAuthorship = {},
): InheritanceSource & { id: string } {
  return { id, parentAgentId, ...authorship };
}

function hostOf(...sessions: (InheritanceSource & { id: string })[]) {
  return new Map(sessions.map((entry) => [entry.id, entry]));
}

function ownershipOf(
  id: string,
  host: ReadonlyMap<string, InheritanceSource>,
  hostKind: "hub" | "direct" = "hub",
) {
  return resolveOwnership({
    ...agentOwnershipEvidence(host.get(id)!, host),
    accounts,
    hostKind,
  });
}

describe("a followed session", () => {
  it("is the reader's in every list even when a teammate created it", () => {
    const host = hostOf({ ...session("t", null, { createdBy: teammate }), followed: true });
    expect(ownershipOf("t", host)).toBe("mine");
    const unfollowed = hostOf(session("t", null, { createdBy: teammate }));
    expect(ownershipOf("t", unfollowed)).toBe("others");
  });
});

describe("a subagent with no verified person of its own takes its parent's ownership", () => {
  it("is a teammate's under a teammate-created parent", () => {
    const host = hostOf(
      session("parent", null, { createdBy: teammate }),
      session("child", "parent"),
    );
    expect(ownershipOf("child", host)).toBe("others");
    // A direct Host's legacy fallback no longer claims it either.
    expect(ownershipOf("child", host, "direct")).toBe("others");
  });

  it("is the reader's under a reader-created parent", () => {
    const host = hostOf(session("parent", null, { createdBy: me }), session("child", "parent"));
    expect(ownershipOf("child", host)).toBe("mine");
  });

  it("is a teammate's under a creatorless parent only a teammate took part in", () => {
    const host = hostOf(
      session("parent", null, { participantActors: [teammate] }),
      session("child", "parent", { createdBy: { kind: "automation", id: "agent" } }),
    );
    expect(ownershipOf("child", host)).toBe("others");
  });

  it("follows a chain of two levels to the nearest ancestor with evidence", () => {
    const host = hostOf(
      session("root", null, { createdBy: teammate }),
      session("parent", "root"),
      session("child", "parent"),
    );
    expect(ownershipOf("child", host)).toBe("others");
    expect(ownershipOf("parent", host)).toBe("others");
  });

  it("stays unknown when the parent is not loaded or has no evidence either", () => {
    expect(ownershipOf("child", hostOf(session("child", "missing")))).toBe("unknown");
    const bare = hostOf(session("parent", null), session("child", "parent"));
    expect(ownershipOf("child", bare)).toBe("unknown");
  });

  it("terminates on a parent cycle and on a chain deeper than it follows", () => {
    const cycle = hostOf(session("a", "b"), session("b", "a"));
    expect(ownershipOf("a", cycle)).toBe("unknown");
    const deep = [session("s0", null, { createdBy: teammate })];
    for (let level = 1; level <= 12; level += 1) deep.push(session(`s${level}`, `s${level - 1}`));
    const host = hostOf(...deep);
    expect(ownershipOf("s8", host)).toBe("others");
    expect(ownershipOf("s12", host)).toBe("unknown");
  });

  it("keeps a subagent's own verified evidence over its parent's", () => {
    const host = hostOf(
      session("parent", null, { createdBy: teammate }),
      session("child", "parent", { participantActors: [me] }),
    );
    expect(agentOwnershipEvidence(host.get("child")!, host).inheritedOwnership).toBeUndefined();
    expect(ownershipOf("child", host)).toBe("mine");
  });

  it("keys the ownership cache on the inherited evidence", () => {
    const before = hostOf(session("parent", null, { createdBy: me }), session("child", "parent"));
    const after = hostOf(
      session("parent", null, { createdBy: teammate }),
      session("child", "parent"),
    );
    const key = (host: ReadonlyMap<string, InheritanceSource>) =>
      ownershipKey({
        ...agentOwnershipEvidence(host.get("child")!, host),
        accounts,
        hostKind: "hub",
      });
    expect(key(before)).not.toBe(key(after));
    expect(ownershipOf("child", before)).toBe("mine");
    expect(ownershipOf("child", after)).toBe("others");
  });
});

function agent(id: string, overrides: Partial<Agent>): Agent {
  const now = new Date("2026-10-31T00:00:00Z");
  return {
    id,
    serverId: "host",
    provider: "codex",
    status: "running",
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
    labels: {},
    ...overrides,
  } as Agent;
}

describe("Home and Work agree on a subagent's inherited ownership", () => {
  // The reported case: a subagent in its own workspace, under a parent a teammate drives.
  const parent = agent("parent", { workspaceId: "ws-parent", participantActors: [teammate] });
  const child = agent("child", { workspaceId: "ws-child", parentAgentId: "parent" });
  const query = (agents: Map<string, Agent>) => {
    const sources = new Map([["host", { agents, messageSubmissions: new Map(), cached: false }]]);
    const index = indexWorkSessions(sources);
    const sessionsOf = (workspace: { workspaceId: string }) =>
      index.get(`host:${workspace.workspaceId}`) ?? null;
    const workspace = {
      workspaceKey: "host:ws-child",
      serverId: "host",
      workspaceId: "ws-child",
      statusBucket: "running",
    };
    const work = countWork([workspace], sessionsOf, {
      scope: "mine",
      accounts,
      hostKinds: new Map([["host", "hub" as const]]),
      showBots: true,
    }).scopes;
    const rows = createAggregatedAgentProjector()({
      hosts: [{ serverId: "host", label: "Host" }],
      includeArchived: false,
      sessionAgents: { host: agents },
    });
    const row = rows.find((entry) => entry.id === "child")!;
    const home = resolveOwnership({
      createdBy: row.createdBy,
      participationKey: row.participationKey,
      inheritedOwnership: row.inheritedOwnership,
      accounts,
      hostKind: "hub",
    });
    return { work, home, sessions: index.get("host:ws-child") };
  };

  it("lists the subagent under Others on both surfaces", () => {
    const { work, home } = query(new Map([parent, child].map((entry) => [entry.id, entry])));
    expect(home).toBe("others");
    expect(work).toEqual({ mine: 0, others: 1, all: 1 });
  });

  it("moves both when the parent's evidence changes and the child's source does not", () => {
    const beforeAgents = new Map([parent, child].map((entry) => [entry.id, entry]));
    const before = query(beforeAgents);
    const mine = { ...parent, participantActors: [me] };
    const afterAgents = new Map([mine, child].map((entry) => [entry.id, entry]));
    // The store advances its root index, so the child's untouched workspace keeps its list.
    advanceWorkspaceRootAgents(beforeAgents, afterAgents);
    expect(workspaceRootAgentsOf(afterAgents).get("ws-child")).toBe(
      workspaceRootAgentsOf(beforeAgents).get("ws-child"),
    );
    const after = query(afterAgents);
    expect(after.home).toBe("mine");
    expect(after.work).toEqual({ mine: 1, others: 0, all: 1 });
    expect(after.sessions).not.toEqual(before.sessions);
  });
});
