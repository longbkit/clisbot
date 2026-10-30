import { isChatSession } from "./work-items";
import { activityBucket, isUnreadReply } from "@/clisbot/home/activity";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  issueSessionKey,
  resolveIssue,
  type Issue,
  type IssueRecord,
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

interface HomeRowsInput {
  agents: readonly AggregatedAgent[];
  ownershipOf: (agent: AggregatedAgent) => Ownership;
  records: IssueRecords;
  now: number;
  /** Adds what the directory entry lacks, such as the pending requests' ids. */
  subjectOf?: (agent: AggregatedAgent) => IssueSubject;
}

function buildRow(
  agent: AggregatedAgent,
  subject: IssueSubject,
  input: Pick<HomeRowsInput, "ownershipOf" | "records" | "now">,
): HomeRow {
  return {
    agent,
    ownership: input.ownershipOf(agent),
    issue: resolveIssue(subject, input.records[issueSessionKey(agent)], input.now),
  };
}

/** Rows before the scope is applied: ownership and the issue each agent shows now. */
export function homeRows(input: HomeRowsInput): HomeRow[] {
  const subjectOf = input.subjectOf ?? ((agent: AggregatedAgent) => agent);
  return input.agents.map((agent) => buildRow(agent, subjectOf(agent), input));
}

interface CachedRow {
  row: HomeRow;
  record: IssueRecord | undefined;
}

/** Only a seen failure depends on the clock: it leaves Seen issues after a week. */
function agesWithClock(row: HomeRow): boolean {
  return row.issue?.kind === "failure" && row.issue.state === "seen";
}

function sameIssue(a: Issue | null, b: Issue | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.key === b.key && a.kind === b.kind && a.occurrence === b.occurrence && a.state === b.state
  );
}

/**
 * `homeRows` for a stream of directory updates: a directory entry is replaced only when it
 * changes, so the row of every other session is reused, along with the reader and Hub matching
 * its ownership costs. The minute clock and an issue record change re-derive only the issues they
 * can move (a seen failure, a session whose record changed) and keep each row's ownership. A
 * session with pending requests is always rebuilt, because its request ids (the issue's
 * occurrence) can change while its entry stays equal. The array itself is reused when no row
 * changed, so memoized readers downstream stay quiet.
 */
export function createHomeRowCache() {
  let ownershipOf: HomeRowsInput["ownershipOf"] | null = null;
  let records: IssueRecords | null = null;
  let now = Number.NaN;
  let cached = new Map<AggregatedAgent, CachedRow>();
  let lastRows: HomeRow[] = [];

  function refresh(agent: AggregatedAgent, input: HomeRowsInput, entry: CachedRow | undefined) {
    const record = entry && input.records === records ? entry.record : recordOf(agent, input);
    if (entry && record === entry.record && !(input.now !== now && agesWithClock(entry.row))) {
      return entry;
    }
    const issue = resolveIssue(agent, record, input.now);
    if (entry && sameIssue(issue, entry.row.issue)) return { row: entry.row, record };
    const ownership = entry ? entry.row.ownership : input.ownershipOf(agent);
    return { row: { agent, ownership, issue }, record };
  }

  return (input: HomeRowsInput): HomeRow[] => {
    if (input.ownershipOf !== ownershipOf) {
      ownershipOf = input.ownershipOf;
      cached = new Map();
    }
    const next = new Map<AggregatedAgent, CachedRow>();
    const rows = input.agents.map((agent) => {
      if ((agent.pendingPermissionCount ?? 0) > 0) {
        return buildRow(agent, input.subjectOf ? input.subjectOf(agent) : agent, input);
      }
      const entry = refresh(agent, input, cached.get(agent));
      next.set(agent, entry);
      return entry.row;
    });
    cached = next;
    records = input.records;
    now = input.now;
    const unchanged =
      rows.length === lastRows.length && rows.every((row, i) => row === lastRows[i]);
    if (!unchanged) lastRows = rows;
    return lastRows;
  };
}

function recordOf(agent: AggregatedAgent, input: HomeRowsInput): IssueRecord | undefined {
  return input.records[issueSessionKey(agent)];
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
