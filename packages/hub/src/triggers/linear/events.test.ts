import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { normalizeLinearEvent } from "./events.js";

describe("Linear event normalization", () => {
  it("uses a comment's own timestamp as the causal history anchor", () => {
    const event = normalizeLinearEvent({
      action: "create",
      type: "Comment",
      organizationId: "linear-org",
      createdAt: "2026-01-02T00:00:05.000Z",
      webhookTimestamp: Date.parse("2026-01-02T00:00:10.000Z"),
      data: {
        id: "comment-1",
        issueId: "issue-1",
        body: "Please investigate",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    });

    assert.equal(event?.occurredAt, "2026-01-02T00:00:00.000Z");
  });

  it("does not use a delivery timestamp as a causal history anchor", () => {
    const event = normalizeLinearEvent({
      action: "create",
      type: "Comment",
      organizationId: "linear-org",
      webhookTimestamp: Date.parse("2026-01-02T00:00:10.000Z"),
      data: { id: "comment-1", issueId: "issue-1", body: "Please investigate" },
    });

    assert.equal(event?.occurredAt, undefined);
  });

  it("falls back to a nested comment user when the top-level actor is null", () => {
    const event = normalizeComment({ user: { id: "user-1", displayName: "Operator" } });

    assert.deepEqual(event?.actor, { id: "user-1", name: "Operator" });
  });

  it("falls back to a nested comment user ID when the top-level actor is null", () => {
    const event = normalizeComment({ userId: "user-1" });

    assert.deepEqual(event?.actor, { id: "user-1" });
  });

  it("preserves explicit nulls in relation-expanded previous issue values", () => {
    const event = normalizeLinearEvent({
      action: "update",
      type: "Issue",
      organizationId: "linear-org",
      updatedFrom: { project: null, state: null, assignee: null },
      data: {
        id: "issue-1",
        title: "Newly scoped issue",
        description: null,
        project: { id: "project-1" },
        state: { id: "state-1" },
        assignee: { id: "user-1" },
      },
    });

    assert.equal(event?.type, "issue");
    if (event?.type !== "issue") throw new Error("expected an issue event");
    assert.deepEqual(event.updatedFrom, {
      projectId: null,
      stateId: null,
      assigneeId: null,
    });
  });

  it("does not replace explicit null issue relations with hydrated values", () => {
    const event = normalizeLinearEvent(
      {
        action: "update",
        type: "Issue",
        organizationId: "linear-org",
        data: {
          id: "issue-1",
          title: "Projectless issue",
          project: null,
          state: null,
          assignee: null,
        },
      },
      undefined,
      {
        id: "issue-1",
        title: "Projectless issue",
        description: null,
        projectId: "later-project",
        stateId: "later-state",
        assigneeId: "later-assignee",
        labelIds: [],
      },
    );

    assert.equal(event?.type, "issue");
    if (event?.type !== "issue") throw new Error("expected an issue event");
    assert.deepEqual(
      {
        projectId: event.issue.projectId,
        stateId: event.issue.stateId,
        assigneeId: event.issue.assigneeId,
      },
      { projectId: null, stateId: null, assigneeId: null },
    );
  });
});

function normalizeComment(extraData: Record<string, unknown>) {
  return normalizeLinearEvent({
    action: "create",
    type: "Comment",
    organizationId: "linear-org",
    actor: null,
    data: {
      id: "comment-1",
      issueId: "issue-1",
      body: "Please investigate",
      ...extraData,
    },
  });
}
