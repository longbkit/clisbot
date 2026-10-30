import { describe, expect, it } from "vitest";
import { activitySections, type ActivityBucketOf } from "@/clisbot/home/activity";
import {
  activityKey,
  activityLayout,
  activityLayoutChanges,
  type ActivityLayoutSection,
} from "@/clisbot/home/activity-layout";
import { createAggregatedAgentProjector } from "@/hooks/aggregated-agent-projector";
import {
  createAgentFleet,
  fleetSource,
  fleetTime,
  fleetUpdates,
  timeReads,
  withAgent,
} from "@/hooks/agent-fleet-fixture";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  HOME_CHIPS,
  buildHomeFeed,
  chipCounts,
  createHomeFeedCache,
  createHomeRowCache,
  homeBucket,
  matchesMode,
  type HomeBucket,
  type HomeFeedFilters,
  type HomeMode,
  type HomeRow,
} from "./home-feed";
import { markIssuesSeen, observeIssues, type IssueRecords } from "./issues";
import {
  EMPTY_SCOPE_COUNTS,
  addToScopeCounts,
  inScope,
  type Ownership,
  type OwnershipScope,
} from "./ownership";

const NOW = fleetTime(0).getTime();
const TODAY = new Date(NOW);

/** Home's feed and layout as they were before the single pass (2026-10-30): the oracle. */
function referenceFeed(rows: readonly HomeRow[], filters: HomeFeedFilters) {
  const base = rows.filter(
    (row) =>
      matchesMode(row.agent, filters.mode) &&
      (filters.serverIds.length === 0 || filters.serverIds.includes(row.agent.serverId)),
  );
  const scoped = base.filter((row) => inScope(filters.scope, row.ownership));
  const visible: { row: HomeRow; bucket: HomeBucket }[] = [];
  for (const row of scoped) {
    const bucket = homeBucket(row, filters.chip);
    if (bucket) visible.push({ row, bucket });
  }
  const scopeCounts = { ...EMPTY_SCOPE_COUNTS };
  for (const row of base)
    if (homeBucket(row, filters.chip)) addToScopeCounts(scopeCounts, row.ownership);
  // What NavigationHomeLayout derived from the feed for Home's layout.
  const buckets = new Map(visible.map(({ row, bucket }) => [activityKey(row.agent), bucket]));
  const bucketOf: ActivityBucketOf = (agent) => buckets.get(activityKey(agent)) ?? "recent";
  return {
    visible,
    scopeCounts,
    chipCounts: chipCounts(scoped),
    agents: visible.map(({ row }) => row.agent),
    bucketOf,
    byKey: new Map(visible.map(({ row }) => [activityKey(row.agent), row])),
    // What NavigationHomeFeed filtered for Mark all as seen.
    unseen: visible.filter(({ row }) => row.issue?.state === "unseen").map(({ row }) => row.agent),
  };
}

function referenceLayout(
  agents: AggregatedAgent[],
  now: Date,
  previous: ActivityLayoutSection[],
  bucketOf: ActivityBucketOf,
): ActivityLayoutSection[] {
  const byKey = (a: { key: string }, b: { key: string }) => {
    if (a.key === b.key) return 0;
    return a.key < b.key ? -1 : 1;
  };
  const ordered = agents
    .map((agent) => ({ agent, key: activityKey(agent) }))
    .sort(byKey)
    .map((entry) => entry.agent);
  return activitySections(ordered, now, undefined, bucketOf).map((section) => {
    let keys = section.agents.map(activityKey);
    if (section.key === "active" || section.key === "needs" || section.key === "seen") {
      const oldKeys = previous.find((old) => old.key === section.key)?.keys ?? [];
      const current = new Set(keys);
      const old = new Set(oldKeys);
      keys = [...oldKeys.filter((key) => current.has(key)), ...keys.filter((key) => !old.has(key))];
    }
    return { key: section.key, title: section.title, keys };
  });
}

/** Sessions on even Hosts are the reader's; a few cannot be placed. */
function ownershipOf(agent: AggregatedAgent): Ownership {
  if (agent.id.endsWith("7")) return "unknown";
  return Number(agent.serverId.split("-")[1]) % 2 === 0 ? "mine" : "others";
}

/** The fleet as Navigation V2 sees it: projected, its issues observed, some of them seen. */
function homePipeline() {
  const project = createAggregatedAgentProjector();
  const rowsOf = createHomeRowCache();
  let records: IssueRecords = {};
  let step = 0;
  return (fleet: ReturnType<typeof createAgentFleet>) => {
    const agents = project(fleet);
    records = observeIssues(records, agents, NOW);
    if (++step % 30 === 0) {
      const unseen = agents.filter((agent) => agent.status === "error").slice(0, 3);
      records = markIssuesSeen(records, unseen, NOW);
    }
    return rowsOf({ agents, ownershipOf, records, now: NOW });
  };
}

const SCOPES: OwnershipScope[] = ["mine", "others", "all"];
const MODES: HomeMode[] = ["hybrid", "chat", "work"];
const HOST_FILTERS: string[][] = [[], ["host-3", "host-8"]];
const FILTERS: HomeFeedFilters[] = [];
for (const scope of SCOPES)
  for (const mode of MODES)
    for (const chip of HOME_CHIPS)
      for (const serverIds of HOST_FILTERS) FILTERS.push({ scope, mode, chip, serverIds });

function sameFeed(rows: readonly HomeRow[], filters: HomeFeedFilters) {
  const actual = buildHomeFeed(rows, filters);
  const expected = referenceFeed(rows, filters);
  expect(actual.visible).toEqual(expected.visible);
  expect(actual.scopeCounts).toEqual(expected.scopeCounts);
  expect(actual.chipCounts).toEqual(expected.chipCounts);
  expect(actual.agents).toEqual(expected.agents);
  expect([...actual.byKey.keys()]).toEqual([...expected.byKey.keys()]);
  expect(actual.unseen).toEqual(expected.unseen);
  for (const agent of expected.agents)
    expect(actual.bucketOf(agent)).toBe(expected.bucketOf(agent));
}

describe("Home over a company fleet", () => {
  it(
    "shows the same rows, buckets and counts as the separate passes did, under every filter",
    {
      timeout: 60_000,
    },
    () => {
      const pipeline = homePipeline();
      let step = 0;
      for (const fleet of fleetUpdates(createAgentFleet(), 120)) {
        const rows = pipeline(fleet);
        if (++step % 40 === 0) for (const filters of FILTERS) sameFeed(rows, filters);
      }
    },
  );

  it(
    "lays out, holds and counts pending changes as the double sort did",
    { timeout: 60_000 },
    () => {
      const pipeline = homePipeline();
      for (const filters of [
        FILTERS[0]!,
        { ...FILTERS[0]!, scope: "all" as const, chip: "needs" as const },
      ]) {
        let accepted: ActivityLayoutSection[] = [];
        let expectedAccepted: ActivityLayoutSection[] = [];
        let step = 0;
        for (const fleet of fleetUpdates(createAgentFleet(), 150)) {
          const rows = pipeline(fleet);
          const feed = buildHomeFeed(rows, filters);
          const reference = referenceFeed(rows, filters);
          const next = activityLayout(feed.agents, TODAY, accepted, feed.bucketOf);
          const expected = referenceLayout(
            reference.agents,
            TODAY,
            expectedAccepted,
            reference.bucketOf,
          );
          expect(next).toEqual(expected);
          // Home's Needs count reads the layout's Needs section instead of filtering the sessions.
          const needs = next.find((section) => section.key === "needs")?.keys.length ?? 0;
          expect(needs).toBe(
            feed.agents.filter((agent) => feed.bucketOf(agent) === "needs").length,
          );
          expect(activityLayoutChanges(accepted, next)).toBe(
            activityLayoutChanges(expectedAccepted, expected),
          );
          if (++step % 7 === 0) {
            accepted = next;
            expectedAccepted = expected;
          }
        }
      }
    },
  );
});

describe("Home feed cache", () => {
  function fleetRows() {
    const fleet = createAgentFleet();
    const pipeline = homePipeline();
    const update = (serverId: string, id: string, patch: Partial<ReturnType<typeof fleetSource>>) =>
      pipeline(withAgent(fleet, { ...fleetSource(fleet, serverId, id), ...patch }));
    return { rows: pipeline(fleet), update };
  }

  it("keeps everything Home renders when a session outside the feed changes", () => {
    const { rows, update } = fleetRows();
    const feedOf = createHomeFeedCache();
    const filters: HomeFeedFilters = { scope: "all", mode: "hybrid", chip: "needs", serverIds: [] };
    const first = feedOf(rows, filters);
    const quiet = rows.find((row) => !row.issue && !first.byKey.has(activityKey(row.agent)))!;
    const next = feedOf(
      update(quiet.agent.serverId, quiet.agent.id, { title: "Renamed" }),
      filters,
    );
    expect(next).toBe(first);
  });

  it("replaces only what a visible change moved", () => {
    const { rows, update } = fleetRows();
    const feedOf = createHomeFeedCache();
    const first = feedOf(rows, FILTERS[0]!);
    const shown = first.agents[5]!;
    const next = feedOf(update(shown.serverId, shown.id, { title: "Renamed" }), FILTERS[0]!);
    expect(next.agents).not.toBe(first.agents);
    expect(next.agents[5]!.title).toBe("Renamed");
    expect(next.scopeCounts).toBe(first.scopeCounts);
    expect(next.chipCounts).toBe(first.chipCounts);
  });
});

describe("Home work for one session update on a 14-Host fleet", () => {
  /** Rows whose `agent` reads are counted: one read per row per pass over the feed. */
  function counted(rows: readonly HomeRow[]) {
    const reads = { count: 0 };
    const wrapped = rows.map((row) => {
      const copy = { ...row };
      Object.defineProperty(copy, "agent", {
        get: () => {
          reads.count += 1;
          return row.agent;
        },
      });
      return copy;
    });
    return { rows: wrapped, reads };
  }

  function updatedRows() {
    const fleet = createAgentFleet();
    const pipeline = homePipeline();
    pipeline(fleet);
    const source = fleetSource(fleet, "host-6", "agent-1600");
    return pipeline(
      withAgent(fleet, { ...source, title: "Renamed", lastActivityAt: fleetTime(0) }),
    );
  }

  it("reads each row once to build the feed and sorts nothing to lay it out", () => {
    const filters = FILTERS[0]!;
    const { rows, reads } = counted(updatedRows());
    const feed = buildHomeFeed(rows, filters);
    const feedReads = reads.count / rows.length;
    reads.count = 0;
    referenceFeed(rows, filters);
    const referenceReads = reads.count / rows.length;

    timeReads.count = 0;
    activityLayout(feed.agents, TODAY, [], feed.bucketOf);
    const layoutTimeReads = timeReads.count;
    timeReads.count = 0;
    const reference = referenceFeed(rows, filters);
    referenceLayout(reference.agents, TODAY, [], reference.bucketOf);
    const referenceTimeReads = timeReads.count;

    // Before: over 4 reads of every row (two filters, three counting passes, three maps of the
    // visible rows) and two full sorts.
    expect(referenceReads).toBeGreaterThan(4);
    expect(feedReads).toBeLessThanOrEqual(2);
    expect(referenceTimeReads).toBeGreaterThan(10 * feed.agents.length);
    expect(layoutTimeReads).toBeLessThanOrEqual(6 * feed.agents.length);
  });
});
