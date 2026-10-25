/**
 * Failure and needs-action lifecycle (brief 3.1c; docs/features/navigation-v2/README.md).
 *
 * The daemon's per-agent attention (`requiresAttention`, `attentionTimestamp`) is the seen signal:
 * opening a session clears it. The device keeps one record per session for what the daemon cannot
 * hold per user — the occurrence it last saw, and the reader's Seen, Dismiss and Mark unread.
 */

export type IssueKind = "failure" | "needs";
export type IssueState = "unseen" | "seen";

export const SEEN_ISSUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** What an agent looks like to the lifecycle; a subset of the directory entry. */
export interface IssueSubject {
  serverId: string;
  id: string;
  status: string;
  archivedAt?: Date | null;
  requiresAttention?: boolean | null;
  attentionReason?: "finished" | "error" | "permission" | null;
  attentionTimestamp?: Date | null;
  pendingPermissionCount?: number;
  lastActivityAt: Date;
}

/** The reader's mark on one occurrence. `observedAt` is when this device first saw it. */
export interface IssueRecord {
  kind: IssueKind;
  occurrence: string;
  observedAt: string;
  /** Explicit reader decision; absent means "follow the daemon's attention". */
  mark?: "seen" | "unread" | "dismissed";
  /** When the occurrence became seen (opened, or marked); drives the 7-day age-out. */
  seenAt?: string;
}

export type IssueRecords = Readonly<Record<string, IssueRecord>>;

export interface Issue {
  key: string;
  kind: IssueKind;
  occurrence: string;
  state: IssueState;
}

export function issueSessionKey(subject: Pick<IssueSubject, "serverId" | "id">): string {
  return `${subject.serverId}:${subject.id}`;
}

/** The issue kind a session has right now, if any. Archived sessions have none. */
export function currentIssueKind(subject: IssueSubject): IssueKind | null {
  if (subject.archivedAt) return null;
  if ((subject.pendingPermissionCount ?? 0) > 0) return "needs";
  if (subject.requiresAttention && subject.attentionReason === "permission") return "needs";
  if (subject.status === "error") return "failure";
  if (subject.requiresAttention && subject.attentionReason === "error") return "failure";
  return null;
}

function unreadAttention(subject: IssueSubject, kind: IssueKind): boolean {
  if (!subject.requiresAttention) return false;
  return kind === "failure"
    ? subject.attentionReason === "error"
    : subject.attentionReason === "permission";
}

/**
 * The occurrence this session's issue belongs to: the daemon's attention timestamp while it is
 * unread, else the one this device captured, else a synthetic seen key for a failure the device
 * only met after it was opened elsewhere.
 */
export function issueOccurrence(
  subject: IssueSubject,
  kind: IssueKind,
  record: IssueRecord | undefined,
): string {
  if (unreadAttention(subject, kind) && subject.attentionTimestamp)
    return subject.attentionTimestamp.toISOString();
  if (record?.kind === kind) return record.occurrence;
  return `seen@${subject.lastActivityAt.toISOString()}`;
}

/**
 * The issue a session shows now, or null when it has none or has left the list: dismissed, or
 * seen longer than seven days ago. Recovery, a new run and archiving end it upstream of the
 * record: `currentIssueKind` is null then.
 */
export function resolveIssue(
  subject: IssueSubject,
  record: IssueRecord | undefined,
  now: number,
): Issue | null {
  const kind = currentIssueKind(subject);
  if (!kind) return null;
  const occurrence = issueOccurrence(subject, kind, record);
  const current = record && record.kind === kind && record.occurrence === occurrence;
  const mark = current ? record.mark : undefined;
  if (mark === "dismissed") return null;
  let state: IssueState;
  if (mark === "unread") state = "unseen";
  else if (mark === "seen") state = "seen";
  else state = unreadAttention(subject, kind) ? "unseen" : "seen";
  if (state === "seen" && kind === "failure") {
    const seenAt = current && record.seenAt ? Date.parse(record.seenAt) : null;
    const since = seenAt ?? subject.lastActivityAt.getTime();
    if (now - since > SEEN_ISSUE_TTL_MS) return null;
  }
  return { key: issueSessionKey(subject), kind, occurrence, state };
}

/**
 * Records after observing the current sessions: capture new occurrences while their attention
 * is still unread, stamp `seenAt` the first time one is seen, and drop records for sessions that
 * no longer have an issue. Returns the same object when nothing changed.
 */
export function observeIssues(
  records: IssueRecords,
  subjects: readonly IssueSubject[],
  now: number,
): IssueRecords {
  const next: Record<string, IssueRecord> = {};
  let changed = false;
  const seen = new Set<string>();
  for (const subject of subjects) {
    const key = issueSessionKey(subject);
    seen.add(key);
    const record = records[key];
    const kind = currentIssueKind(subject);
    if (!kind) {
      if (record) changed = true;
      continue;
    }
    const updated = observeOne(subject, kind, record, now);
    if (updated !== record) changed = true;
    if (updated) next[key] = updated;
  }
  for (const key of Object.keys(records)) {
    // A session absent from this snapshot (Host offline) keeps its record.
    if (!seen.has(key)) next[key] = records[key]!;
  }
  return changed ? next : records;
}

function observeOne(
  subject: IssueSubject,
  kind: IssueKind,
  record: IssueRecord | undefined,
  now: number,
): IssueRecord | undefined {
  const occurrence = issueOccurrence(subject, kind, record);
  const iso = new Date(now).toISOString();
  if (!record || record.kind !== kind || record.occurrence !== occurrence)
    return { kind, occurrence, observedAt: iso };
  const seen = record.mark === "seen" || (!record.mark && !unreadAttention(subject, kind));
  if (seen && !record.seenAt) return { ...record, seenAt: iso };
  return record;
}

function setMark(
  records: IssueRecords,
  subject: IssueSubject,
  value: NonNullable<IssueRecord["mark"]>,
  now: number,
): IssueRecords {
  const kind = currentIssueKind(subject);
  if (!kind) return records;
  const key = issueSessionKey(subject);
  const previous = records[key];
  const occurrence = issueOccurrence(subject, kind, previous);
  const base =
    previous && previous.kind === kind && previous.occurrence === occurrence
      ? previous
      : { kind, occurrence, observedAt: new Date(now).toISOString() };
  const seenAt = value === "unread" ? undefined : (base.seenAt ?? new Date(now).toISOString());
  return { ...records, [key]: { ...base, mark: value, seenAt } };
}

export const markIssueSeen = (records: IssueRecords, subject: IssueSubject, now: number) =>
  setMark(records, subject, "seen", now);
export const markIssueUnread = (records: IssueRecords, subject: IssueSubject, now: number) =>
  setMark(records, subject, "unread", now);
export const dismissIssue = (records: IssueRecords, subject: IssueSubject, now: number) =>
  setMark(records, subject, "dismissed", now);

export function markIssuesSeen(
  records: IssueRecords,
  subjects: readonly IssueSubject[],
  now: number,
): IssueRecords {
  return subjects.reduce((next, subject) => markIssueSeen(next, subject, now), records);
}
