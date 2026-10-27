import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { buildHomeFeed, homeBadgeCount, homeRows, type HomeFeedFilters } from "./home-feed";
import { observeIssues } from "./issues";
import {
  asCachedAgent,
  cachedServerIds,
  isCachedAgent,
  isCachedSource,
  listableServerIds,
  listedAgents,
  quietCachedAgents,
  withoutLiveFacts,
  type SourceStatusLike,
} from "./source-liveness";

const NOW = Date.parse("2026-10-27T10:00:00Z");
function agent(id: string, serverId: string, overrides: Partial<AggregatedAgent> = {}) {
  return {
    id,
    serverId,
    serverLabel: serverId,
    title: id,
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    lastActivityAt: new Date(NOW - 60_000),
    createdAt: new Date(NOW - 120_000),
    cwd: "/tmp",
    provider: "codex",
    labels: {},
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    ...overrides,
  } as AggregatedAgent;
}
const running = (id: string, serverId: string) =>
  agent(id, serverId, {
    status: "running",
    turn: { phase: "open", turnId: "t1", startedAt: new Date(NOW), cancellationRequestId: null },
  });
const approval = (id: string, serverId: string) =>
  agent(id, serverId, {
    status: "running",
    pendingPermissionCount: 1,
    requiresAttention: true,
    attentionReason: "permission",
    attentionTimestamp: new Date(NOW - 500),
  });
const failure = (id: string, serverId: string) =>
  agent(id, serverId, {
    status: "error",
    requiresAttention: true,
    attentionReason: "error",
    attentionTimestamp: new Date(NOW - 1000),
  });

function status(serverId: string, overrides: Partial<SourceStatusLike> = {}): SourceStatusLike {
  return { serverId, effectiveState: "live", agents: { loaded: true }, ...overrides };
}

describe("which sources may be listed", () => {
  const registered = ["own", "managed", "hub-hidden"];
  const inventory = ["own", "managed"];

  it("follows the Host picker once the registry and every Hub have settled", () => {
    expect([...listableServerIds({ registered, inventory, settled: true })].sort()).toEqual([
      "managed",
      "own",
    ]);
  });

  it("hides nothing while it cannot be judged: cold start, registry or Hubs still loading", () => {
    expect([...listableServerIds({ registered, inventory: [], settled: false })].sort()).toEqual([
      "hub-hidden",
      "managed",
      "own",
    ]);
  });

  it("drops the sessions of a source that is not listable, without touching the input", () => {
    const kept = running("kept", "own");
    const hidden = running("hidden", "hub-hidden");
    const input = Object.freeze([kept, hidden]);
    const result = listedAgents(input, new Set(["own"]));
    expect(result).toEqual([kept]);
    expect(result[0]).toBe(kept);
    expect(hidden.status).toBe("running");
  });

  it("returns the same array while every source is still listable", () => {
    const list = [running("a", "h1"), running("b", "h2")];
    expect(listedAgents(list, new Set(["h1", "h2"]))).toBe(list);
  });
});

describe("sources that are registered but not reachable", () => {
  it("marks offline, signed-out, revoked and never-yet-loaded sources as cached", () => {
    const statuses = [
      status("live"),
      status("catching-up", { effectiveState: "syncing" }),
      status("first-connect", { effectiveState: "syncing", agents: { loaded: false } }),
      status("offline", { effectiveState: "offline" }),
      status("host-sign-in", { effectiveState: "needs-sign-in" }),
      status("revoked", { effectiveState: "revoked" }),
    ];
    const listable = new Set(statuses.map((entry) => entry.serverId));
    expect([...cachedServerIds({ statuses, listable })].sort()).toEqual([
      "first-connect",
      "host-sign-in",
      "offline",
      "revoked",
    ]);
  });

  it("never takes a source with no health entry yet as live", () => {
    const listable = new Set(["live", "not-measured-yet"]);
    expect([...cachedServerIds({ statuses: [status("live")], listable })]).toEqual([
      "not-measured-yet",
    ]);
    expect(isCachedSource(undefined)).toBe(true);
    expect(isCachedSource(null)).toBe(true);
  });

  it("does not make a removed source cached; it is simply not listed", () => {
    const cached = cachedServerIds({
      statuses: [status("gone", { effectiveState: "offline" })],
      listable: new Set(["live"]),
    });
    expect(cached.has("gone")).toBe(false);
  });

  it("shows a cached running session as an ordinary one, and keeps what is a fact", () => {
    const cachedRunning = asCachedAgent(running("r", "h1"));
    expect(cachedRunning.status).toBe("idle");
    expect(cachedRunning.turn.phase).toBe("idle");
    const cachedApproval = asCachedAgent(approval("p", "h1"));
    expect(cachedApproval.pendingPermissionCount).toBe(0);
    expect(cachedApproval.requiresAttention).toBe(false);
    expect(cachedApproval.attentionReason).toBeNull();
    // A failure, an unread reply and an archive are history, not liveness.
    const failed = failure("f", "h1");
    expect(asCachedAgent(failed)).toBe(failed);
    const idle = agent("i", "h1");
    expect(asCachedAgent(idle)).toBe(idle);
  });

  it("marks a session whose liveness was dropped, so it is never read as finished", () => {
    const original = running("r", "h1");
    const quieted = asCachedAgent(original);
    expect(isCachedAgent(quieted)).toBe(true);
    expect(isCachedAgent(original)).toBe(false);
    // A row with nothing live to drop was never unverified.
    expect(isCachedAgent(asCachedAgent(agent("i", "h1")))).toBe(false);
  });

  it("drops live facts from any status input the same way", () => {
    const facts = {
      status: "running",
      pendingPermissionCount: 2,
      requiresAttention: true,
      attentionReason: "permission" as const,
    };
    expect(withoutLiveFacts(facts)).toEqual({
      status: "idle",
      pendingPermissionCount: 0,
      requiresAttention: false,
      attentionReason: null,
    });
    const settled = {
      ...facts,
      status: "error",
      pendingPermissionCount: 0,
      requiresAttention: false,
      attentionReason: null,
    };
    expect(withoutLiveFacts(settled)).toBe(settled);
  });

  it("clears no stored data: the cached copy is new and the original stays running", () => {
    const original = Object.freeze(running("r", "h1"));
    const list = [original, agent("other", "h2")];
    const quiet = quietCachedAgents(list, new Set(["h1"]));
    expect(quiet[0]).not.toBe(original);
    expect(original.status).toBe("running");
    expect(quiet[1]).toBe(list[1]);
  });

  it("returns the same copy for the same input, so rows do not re-render", () => {
    const list = [running("r", "h1")];
    const cached = new Set(["h1"]);
    expect(quietCachedAgents(list, cached)[0]).toBe(quietCachedAgents(list, cached)[0]);
    expect(quietCachedAgents(list, new Set())).toBe(list);
  });
});

describe("Home over registered, cached and removed sources", () => {
  const filters = (overrides: Partial<HomeFeedFilters> = {}): HomeFeedFilters => ({
    scope: "all",
    mode: "hybrid",
    chip: "all",
    serverIds: [],
    ...overrides,
  });
  const live = running("live-run", "live");
  const cachedRun = running("cached-run", "unreachable");
  const cachedAsk = approval("cached-ask", "unreachable");
  const cachedFail = failure("cached-fail", "unreachable");
  const orphan = running("orphan-run", "removed");
  const everything = [live, cachedRun, cachedAsk, cachedFail, orphan];

  function feed(chip: HomeFeedFilters["chip"]) {
    const listable = listableServerIds({
      registered: ["live", "unreachable", "removed"],
      inventory: ["live", "unreachable"],
      settled: true,
    });
    const observed = listedAgents(everything, listable);
    const display = quietCachedAgents(observed, new Set(["unreachable"]));
    const records = observeIssues({}, observed, NOW);
    const rows = homeRows({ agents: display, ownershipOf: () => "mine", records, now: NOW });
    return { rows, feed: buildHomeFeed(rows, filters({ chip })) };
  }
  const ids = (result: ReturnType<typeof feed>) =>
    result.feed.visible.map((item) => item.row.agent.id).sort();

  it("lists only the live source's session under Running, with the right count", () => {
    const result = feed("running");
    expect(ids(result)).toEqual(["live-run"]);
    expect(result.feed.chipCounts.running).toBe(1);
  });

  it("never lists a removed source's session anywhere", () => {
    expect(ids(feed("all"))).not.toContain("orphan-run");
    expect(feed("all").feed.scopeCounts.all).toBe(4);
  });

  it("keeps a cached session in the list, without Running or an approval to give", () => {
    const all = feed("all");
    expect(ids(all)).toEqual(["cached-ask", "cached-fail", "cached-run", "live-run"]);
    const needs = feed("needs");
    // The failure happened; the approval cannot be given while the source is out of reach.
    expect(ids(needs)).toEqual(["cached-fail"]);
    expect(homeBadgeCount(all.rows)).toBe(1);
  });

  it("keeps the approval's record so it is still seen or unseen when the source returns", () => {
    const observed = [live, cachedAsk];
    const records = observeIssues({}, observed, NOW);
    expect(Object.keys(records)).toContain("unreachable:cached-ask");
  });
});
