import { isChatSession } from "./work-items";
import { activityBucket, isUnreadReply } from "@/clisbot/home/activity";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  issueSessionKey,
  resolveIssue,
  type Issue,
  type IssueRecords,
  type IssueSubject,
} from "./issues";
import {
  EMPTY_SCOPE_COUNTS,
  addToScopeCounts,
  inScope,
  type Ownership,
  type OwnershipScope,
  type ScopeCounts,
} from "./ownership";

export type HomeMode = "chat" | "work" | "hybrid";
export type HomeChip = "all" | "needs" | "running" | "updated" | "failed";
export const HOME_CHIPS: readonly HomeChip[] = ["all", "needs", "running", "updated", "failed"];

/** Where a row sits in the Home feed; `seen` is the collapsed "Seen issues" group. */
export type HomeBucket = "needs" | "active" | "recent" | "seen";

export interface HomeRow {
  agent: AggregatedAgent;
  ownership: Ownership;
  issue: Issue | null;
}

/** Chat = sessions of a Bot (DMs and groups); Work = projects and Quick chats (brief C13). */
/** Home's Chat mode reads the one Chat-vs-Workspace rule (`isChatSession`). */
export function isChatAgent(agent: Pick<AggregatedAgent, "labels">): boolean {
  return isChatSession(agent);
}

export function matchesMode(agent: Pick<AggregatedAgent, "labels">, mode: HomeMode): boolean {
  if (mode === "hybrid") return true;
  return isChatAgent(agent) === (mode === "chat");
}

/** Rows before the scope is applied: ownership and the issue each agent shows now. */
export function homeRows(input: {
  agents: readonly AggregatedAgent[];
  ownershipOf: (agent: AggregatedAgent) => Ownership;
  records: IssueRecords;
  now: number;
  /** Adds what the directory entry lacks, such as the pending requests' ids. */
  subjectOf?: (agent: AggregatedAgent) => IssueSubject;
}): HomeRow[] {
  const subjectOf = input.subjectOf ?? ((agent: AggregatedAgent) => agent);
  return input.agents.map((agent) => ({
    agent,
    ownership: input.ownershipOf(agent),
    issue: resolveIssue(subjectOf(agent), input.records[issueSessionKey(agent)], input.now),
  }));
}

/**
 * The bucket a row falls in under a chip, or null when the chip excludes it. An issue the reader
 * has seen leaves Needs you for the Seen group; a dismissed or aged-out failure has no issue and
 * reads as an ordinary row.
 */
export function homeBucket(row: HomeRow, chip: HomeChip): HomeBucket | null {
  const { agent, issue } = row;
  if (chip === "failed") return issue?.kind === "failure" ? issueBucket(issue) : null;
  // Needs me is the existing Needs you bucket: approvals and failures the reader has not seen.
  if (chip === "needs") return issue?.state === "unseen" ? "needs" : null;
  if (chip === "updated") return isUnreadReply(agent) && !agent.archivedAt ? "recent" : null;
  const plain = plainBucket(agent);
  if (chip === "running") return plain === "active" && !issue ? "active" : null;
  if (issue) return issueBucket(issue);
  return plain;
}

function issueBucket(issue: Issue): HomeBucket {
  return issue.state === "unseen" ? "needs" : "seen";
}

/** Without an issue, a blocking agent (dismissed or aged out) is history, not Needs you. */
function plainBucket(agent: AggregatedAgent): HomeBucket {
  const bucket = activityBucket(agent);
  return bucket === "needs" ? "recent" : bucket;
}

export interface HomeFeedFilters {
  scope: OwnershipScope;
  mode: HomeMode;
  chip: HomeChip;
  /** Host filter; empty means every Host. */
  serverIds: readonly string[];
}

function matchesBase(row: HomeRow, filters: Omit<HomeFeedFilters, "chip" | "scope">) {
  return (
    matchesMode(row.agent, filters.mode) &&
    (filters.serverIds.length === 0 || filters.serverIds.includes(row.agent.serverId))
  );
}

/** Rows the feed shows with their buckets, plus every count the Home header and chips read. */
export function buildHomeFeed(rows: readonly HomeRow[], filters: HomeFeedFilters) {
  const base = rows.filter((row) => matchesBase(row, filters));
  const scoped = base.filter((row) => inScope(filters.scope, row.ownership));
  const visible: { row: HomeRow; bucket: HomeBucket }[] = [];
  for (const row of scoped) {
    const bucket = homeBucket(row, filters.chip);
    if (bucket) visible.push({ row, bucket });
  }
  return {
    visible,
    scopeCounts: countScopes(base, filters.chip),
    chipCounts: chipCounts(scoped),
  };
}

function countScopes(rows: readonly HomeRow[], chip: HomeChip): ScopeCounts {
  const counts = { ...EMPTY_SCOPE_COUNTS };
  for (const row of rows) {
    if (!homeBucket(row, chip)) continue;
    addToScopeCounts(counts, row.ownership);
  }
  return counts;
}

/** Needs me counts every unseen issue, Failed the unseen failures; seen ones never count (3.1c). */
export function chipCounts(rows: readonly HomeRow[]): Record<HomeChip, number> {
  const counts: Record<HomeChip, number> = { all: 0, needs: 0, running: 0, updated: 0, failed: 0 };
  for (const row of rows) {
    counts.all += 1;
    if (row.issue?.state === "unseen") counts.needs += 1;
    if (row.issue?.kind === "failure" && row.issue.state === "unseen") counts.failed += 1;
    if (homeBucket(row, "running")) counts.running += 1;
    if (homeBucket(row, "updated")) counts.updated += 1;
  }
  return counts;
}

/** The Home tab and rail badge: the reader's own unseen issues, in every mode (C9, C15). */
export function homeBadgeCount(rows: readonly HomeRow[]): number {
  let count = 0;
  for (const row of rows) if (row.ownership === "mine" && row.issue?.state === "unseen") count += 1;
  return count;
}
