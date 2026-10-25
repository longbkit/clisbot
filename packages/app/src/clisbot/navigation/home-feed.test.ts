import { describe, expect, it } from "vitest";
import { BOT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { observeIssues, markIssueSeen } from "./issues";
import { buildHomeFeed, homeBadgeCount, homeRows, type HomeFeedFilters } from "./home-feed";

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
    expect(ids(buildHomeFeed(rows, filters({ chip: "needs" })))).toEqual(["approval"]);
    const counts = buildHomeFeed(rows, filters()).chipCounts;
    expect(counts).toMatchObject({ needs: 1, failed: 1, running: 1, updated: 1, all: 5 });
  });

  it("filters by Host", () => {
    const other = [...agents, agent("remote", { serverId: "h2" })];
    const otherRows = homeRows({ agents: other, ownershipOf, records, now: NOW });
    expect(ids(buildHomeFeed(otherRows, filters({ serverIds: ["h2"] })))).toEqual(["remote"]);
  });
});
