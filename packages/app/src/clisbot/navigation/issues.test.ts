import { describe, expect, it } from "vitest";
import {
  SEEN_ISSUE_TTL_MS,
  dismissIssue,
  markIssueSeen,
  markIssueUnread,
  markIssuesSeen,
  observeIssues,
  resolveIssue,
  type IssueRecords,
  type IssueSubject,
} from "./issues";

const T0 = Date.parse("2026-10-20T10:00:00.000Z");
const failedAt = new Date(T0);

function failed(overrides: Partial<IssueSubject> = {}): IssueSubject {
  return {
    serverId: "h1",
    id: "a1",
    status: "error",
    requiresAttention: true,
    attentionReason: "error",
    attentionTimestamp: failedAt,
    lastActivityAt: failedAt,
    ...overrides,
  };
}
const opened = (subject: IssueSubject): IssueSubject => ({
  ...subject,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
});
const issueOf = (subject: IssueSubject, records: IssueRecords, now = T0) =>
  resolveIssue(subject, records["h1:a1"], now);

describe("failure lifecycle", () => {
  it("is unseen until opened, then seen", () => {
    const subject = failed();
    let records = observeIssues({}, [subject], T0);
    expect(issueOf(subject, records)?.state).toBe("unseen");
    records = observeIssues(records, [opened(subject)], T0 + 1000);
    expect(issueOf(opened(subject), records, T0 + 1000)).toMatchObject({
      kind: "failure",
      state: "seen",
      occurrence: failedAt.toISOString(),
    });
  });

  it("marks seen without opening, and Mark all as seen", () => {
    const a = failed();
    const b = failed({ id: "a2" });
    const records = markIssuesSeen(observeIssues({}, [a, b], T0), [a, b], T0);
    expect(resolveIssue(a, records["h1:a1"], T0)?.state).toBe("seen");
    expect(resolveIssue(b, records["h1:a2"], T0)?.state).toBe("seen");
  });

  it("leaves Failed on dismiss and stays gone after opening", () => {
    const subject = failed();
    let records = dismissIssue(observeIssues({}, [subject], T0), subject, T0);
    expect(issueOf(subject, records)).toBeNull();
    records = observeIssues(records, [opened(subject)], T0 + 1000);
    expect(issueOf(opened(subject), records, T0 + 1000)).toBeNull();
  });

  it("resurfaces as unseen when a new failure occurs on a dismissed session", () => {
    const subject = failed();
    let records = dismissIssue(observeIssues({}, [subject], T0), subject, T0);
    const again = failed({ attentionTimestamp: new Date(T0 + 60_000) });
    records = observeIssues(records, [again], T0 + 60_000);
    expect(issueOf(again, records, T0 + 60_000)?.state).toBe("unseen");
  });

  it("leaves when the session recovers or runs again, and drops the record", () => {
    const subject = failed();
    let records = observeIssues({}, [subject], T0);
    const recovered = { ...opened(subject), status: "idle" };
    expect(issueOf(recovered, records)).toBeNull();
    const running = { ...opened(subject), status: "running" };
    expect(issueOf(running, records)).toBeNull();
    records = observeIssues(records, [running], T0 + 1);
    expect(records["h1:a1"]).toBeUndefined();
  });

  it("leaves when archived", () => {
    const subject = failed({ archivedAt: new Date(T0) });
    expect(issueOf(subject, {})).toBeNull();
  });

  it("ages out seven days after it was seen", () => {
    const subject = failed();
    let records = observeIssues({}, [subject], T0);
    records = observeIssues(records, [opened(subject)], T0 + 1000);
    expect(issueOf(opened(subject), records, T0 + SEEN_ISSUE_TTL_MS)?.state).toBe("seen");
    expect(issueOf(opened(subject), records, T0 + 1001 + SEEN_ISSUE_TTL_MS)).toBeNull();
  });

  it("an unseen failure never ages out", () => {
    const subject = failed();
    const records = observeIssues({}, [subject], T0);
    expect(issueOf(subject, records, T0 + 30 * SEEN_ISSUE_TTL_MS)?.state).toBe("unseen");
  });

  it("Mark unread returns a seen failure to unseen until it is marked seen again", () => {
    const subject = opened(failed());
    let records = observeIssues(observeIssues({}, [failed()], T0), [subject], T0 + 1);
    records = markIssueUnread(records, subject, T0 + 2);
    expect(issueOf(subject, records, T0 + 2)?.state).toBe("unseen");
    records = markIssueSeen(records, subject, T0 + 3);
    expect(issueOf(subject, records, T0 + 3)?.state).toBe("seen");
  });

  it("treats a failure first met after it was opened elsewhere as seen", () => {
    const subject = opened(failed());
    const records = observeIssues({}, [subject], T0);
    expect(issueOf(subject, records)).toMatchObject({ state: "seen" });
    expect(records["h1:a1"]?.occurrence).toBe(`seen@${failedAt.toISOString()}`);
  });

  it("keeps records of sessions missing from a partial snapshot", () => {
    const records = observeIssues({}, [failed()], T0);
    expect(observeIssues(records, [], T0 + 1)).toBe(records);
  });
});

describe("needs-action lifecycle", () => {
  const pending = (overrides: Partial<IssueSubject> = {}) =>
    failed({
      status: "running",
      attentionReason: "permission",
      pendingPermissionCount: 1,
      ...overrides,
    });

  it("stays while actionable; seen after opening; leaves once resolved", () => {
    const subject = pending();
    let records = observeIssues({}, [subject], T0);
    expect(issueOf(subject, records)).toMatchObject({ kind: "needs", state: "unseen" });
    const seen = opened(subject);
    records = observeIssues(records, [seen], T0 + 1);
    expect(issueOf(seen, records)).toMatchObject({ kind: "needs", state: "seen" });
    // Seen requests never age out while still actionable.
    expect(issueOf(seen, records, T0 + 10 * SEEN_ISSUE_TTL_MS)?.state).toBe("seen");
    expect(issueOf({ ...seen, pendingPermissionCount: 0 }, records)).toBeNull();
  });

  it("leaves when the session stops", () => {
    expect(issueOf(pending({ archivedAt: new Date(T0) }), {})).toBeNull();
  });

  it("dismisses a stale request until a new one arrives", () => {
    const subject = pending();
    let records = dismissIssue(observeIssues({}, [subject], T0), subject, T0);
    expect(issueOf(subject, records)).toBeNull();
    const next = pending({ attentionTimestamp: new Date(T0 + 5000) });
    records = observeIssues(records, [next], T0 + 5000);
    expect(issueOf(next, records, T0 + 5000)?.state).toBe("unseen");
  });
});
