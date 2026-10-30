import { describe, expect, it, vi } from "vitest";
import { BOT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { observeIssues, markIssueSeen } from "./issues";
import {
  buildHomeFeed,
  createHomeRowCache,
  homeBadgeCount,
  homeRows,
  type HomeFeedFilters,
} from "./home-feed";

const NOW = Date.parse("2026-10-25T10:00:00Z");
function agent(id: string, overrides: Partial<AggregatedAgent> = {}): AggregatedAgent {
  return {
    id,
    serverId: "h1",
    serverLabel: "Local",
    title: id,
    status: "idle",
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
const failure = (id: string, extra: Partial<AggregatedAgent> = {}) =>
  agent(id, {
    status: "error",
    requiresAttention: true,
    attentionReason: "error",
    attentionTimestamp: new Date(NOW - 1000),
    ...extra,
  });

const agents = [
  failure("my-fail"),
  failure("their-fail"),
  agent("approval", {
    status: "running",
    pendingPermissionCount: 1,
    requiresAttention: true,
    attentionReason: "permission",
    attentionTimestamp: new Date(NOW - 500),
  }),
  agent("running", { status: "running" }),
  agent("bot-dm", { labels: { [BOT_ID_LABEL]: "nia" } }),
  agent("unread", { requiresAttention: true, attentionReason: "finished" }),
];
const ownershipOf = (row: AggregatedAgent) => (row.id === "their-fail" ? "others" : "mine");
const filters = (overrides: Partial<HomeFeedFilters> = {}): HomeFeedFilters => ({
  scope: "mine",
  mode: "hybrid",
  chip: "all",
  serverIds: [],
  ...overrides,
});

describe("Home feed", () => {
  const records = observeIssues({}, agents, NOW);
  const rows = homeRows({ agents, ownershipOf, records, now: NOW });
  const ids = (feed: ReturnType<typeof buildHomeFeed>, bucket?: string) =>
    feed.visible
      .filter((item) => !bucket || item.bucket === bucket)
      .map((item) => item.row.agent.id);

  it("keeps others' failures out of For me lists, chips and badges (C15)", () => {
    const mine = buildHomeFeed(rows, filters());
    expect(ids(mine)).not.toContain("their-fail");
    expect(mine.chipCounts.failed).toBe(1);
    expect(homeBadgeCount(rows)).toBe(2);
    const others = buildHomeFeed(rows, filters({ scope: "others" }));
    expect(ids(others)).toEqual(["their-fail"]);
    const all = buildHomeFeed(rows, filters({ scope: "all" }));
    expect(all.scopeCounts).toEqual({ mine: 5, others: 1, all: 6 });
  });

  it("collapses seen failures into the Seen group and stops counting them", () => {
    const seen = markIssueSeen(records, agents[0]!, NOW);
    const next = homeRows({ agents, ownershipOf, records: seen, now: NOW });
    const feed = buildHomeFeed(next, filters());
    expect(ids(feed, "seen")).toEqual(["my-fail"]);
    expect(ids(feed, "needs")).toEqual(["approval"]);
    expect(feed.chipCounts.failed).toBe(0);
    expect(homeBadgeCount(next)).toBe(1);
    // The Failed chip still lists it, below unseen ones.
    const failed = buildHomeFeed(next, filters({ chip: "failed" }));
    expect(failed.visible.map((item) => item.bucket)).toEqual(["seen"]);
  });

  it("filters by mode: Chat is Bot sessions, Work is the rest", () => {
    expect(ids(buildHomeFeed(rows, filters({ mode: "chat" })))).toEqual(["bot-dm"]);
    expect(ids(buildHomeFeed(rows, filters({ mode: "work" })))).not.toContain("bot-dm");
  });

  it("maps chips onto the existing buckets", () => {
    expect(ids(buildHomeFeed(rows, filters({ chip: "running" })))).toEqual(["running"]);
    expect(ids(buildHomeFeed(rows, filters({ chip: "updated" })))).toEqual(["unread"]);
    expect(ids(buildHomeFeed(rows, filters({ chip: "needs" })))).toEqual(["my-fail", "approval"]);
    const counts = buildHomeFeed(rows, filters()).chipCounts;
    expect(counts).toMatchObject({ needs: 2, failed: 1, running: 1, updated: 1, all: 5 });
  });

  it("lists a session nobody can place under For me and All, never Others", () => {
    const owners: Record<string, "others" | "unknown"> = {
      "their-fail": "others",
      "my-fail": "unknown",
    };
    const placed = (row: AggregatedAgent) => owners[row.id] ?? "mine";
    const unplaced = homeRows({ agents, ownershipOf: placed, records, now: NOW });
    expect(ids(buildHomeFeed(unplaced, filters()))).toContain("my-fail");
    expect(ids(buildHomeFeed(unplaced, filters({ scope: "others" })))).toEqual(["their-fail"]);
    const all = buildHomeFeed(unplaced, filters({ scope: "all" }));
    expect(ids(all)).toContain("my-fail");
    expect(all.scopeCounts).toEqual({ mine: 5, others: 1, all: 6 });
    // Its unseen failure counts on the reader's badge, beside the approval.
    expect(homeBadgeCount(unplaced)).toBe(2);
  });

  it("filters by Host", () => {
    const other = [...agents, agent("remote", { serverId: "h2" })];
    const otherRows = homeRows({ agents: other, ownershipOf, records, now: NOW });
    expect(ids(buildHomeFeed(otherRows, filters({ serverIds: ["h2"] })))).toEqual(["remote"]);
  });
});

describe("Home row cache", () => {
  const entry = (id: string, extra: Partial<AggregatedAgent> = {}) =>
    ({
      id,
      serverId: "h",
      status: "idle",
      lastActivityAt: new Date(0),
      pendingPermissionCount: 0,
      ...extra,
    }) as AggregatedAgent;

  const NONE = {};

  it("re-derives only the session that changed", () => {
    const list = Array.from({ length: 200 }, (_, i) => entry(`a${i}`));
    const ownerOf = vi.fn(() => "mine" as const);
    const rowsOf = createHomeRowCache();
    const first = rowsOf({ agents: list, ownershipOf: ownerOf, records: NONE, now: 1 });
    ownerOf.mockClear();
    const next = [...list];
    next[7] = { ...list[7]!, title: "renamed" };
    const second = rowsOf({ agents: next, ownershipOf: ownerOf, records: NONE, now: 1 });
    expect(ownerOf).toHaveBeenCalledTimes(1);
    expect(second[7]!.agent.title).toBe("renamed");
    expect(second[8]).toBe(first[8]);
  });

  it("hands back the same array when nothing changed, and rebuilds when ownership does", () => {
    const list = [entry("a"), entry("b")];
    const ownerOf = vi.fn(() => "mine" as const);
    const rowsOf = createHomeRowCache();
    const first = rowsOf({ agents: list, ownershipOf: ownerOf, records: NONE, now: 1 });
    expect(rowsOf({ agents: [...list], ownershipOf: ownerOf, records: NONE, now: 1 })).toBe(first);
    const otherOwner = vi.fn(() => "others" as const);
    const rebuilt = rowsOf({ agents: list, ownershipOf: otherOwner, records: NONE, now: 1 });
    expect(otherOwner).toHaveBeenCalledTimes(2);
    expect(rebuilt.map((row) => row.ownership)).toEqual(["others", "others"]);
  });

  it("on a clock tick re-derives only seen failures, which age out of Seen issues", () => {
    const failed = failure("f", { serverId: "h", lastActivityAt: new Date(NOW) });
    const list = [...Array.from({ length: 200 }, (_, i) => entry(`a${i}`)), failed];
    const seen = markIssueSeen(observeIssues({}, list, NOW), failed, NOW);
    const ownerOf = vi.fn(() => "mine" as const);
    const rowsOf = createHomeRowCache();
    const first = rowsOf({ agents: list, ownershipOf: ownerOf, records: seen, now: NOW });
    ownerOf.mockClear();

    const minuteLater = rowsOf({
      agents: list,
      ownershipOf: ownerOf,
      records: seen,
      now: NOW + 60_000,
    });
    expect(minuteLater).toBe(first);
    const weekLater = NOW + 8 * 24 * 60 * 60 * 1000;
    const aged = rowsOf({ agents: list, ownershipOf: ownerOf, records: seen, now: weekLater });

    expect(ownerOf).not.toHaveBeenCalled();
    expect(first.at(-1)!.issue?.state).toBe("seen");
    expect(aged.at(-1)!.issue).toBeNull();
    expect(aged[0]).toBe(first[0]);
  });

  it("on a records change re-derives only the sessions whose record changed", () => {
    const list = [failure("f1", { serverId: "h" }), failure("f2", { serverId: "h" })];
    const observed = observeIssues({}, list, NOW);
    const ownerOf = vi.fn(() => "mine" as const);
    const rowsOf = createHomeRowCache();
    const first = rowsOf({ agents: list, ownershipOf: ownerOf, records: observed, now: NOW });
    ownerOf.mockClear();

    const seen = markIssueSeen(observed, list[0]!, NOW);
    const second = rowsOf({ agents: list, ownershipOf: ownerOf, records: seen, now: NOW });

    expect(ownerOf).not.toHaveBeenCalled();
    expect(second[0]!.issue?.state).toBe("seen");
    expect(second[1]).toBe(first[1]);
  });

  it("always rebuilds a session with pending requests, whose request ids can change unseen", () => {
    const pending = entry("p", { pendingPermissionCount: 1 });
    let requestKey = "r1";
    const subjectOf = (item: AggregatedAgent) => ({ ...item, requestKey });
    const rowsOf = createHomeRowCache();
    const input = { agents: [pending], ownershipOf: () => "mine" as const, records: NONE, now: 1 };
    const first = rowsOf({ ...input, subjectOf })[0]!;
    requestKey = "r2";
    const second = rowsOf({ ...input, subjectOf })[0]!;
    expect(first.issue?.occurrence).toBe("request:r1");
    expect(second.issue?.occurrence).toBe("request:r2");
  });
});
