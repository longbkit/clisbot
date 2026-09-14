import { describe, expect, it } from "vitest";
import {
  sessionActorKey,
  type SessionActor,
  type SessionAuthorship,
} from "@getpaseo/protocol/session-authorship";
import { aggregateWorkspaceAuthorship, recordSessionInteraction } from "./session-authorship.js";
const a: SessionActor = {
  kind: "user",
  id: "slack:U1",
  hubOrigin: "https://hub.test",
  organizationId: "o",
  connectionId: "c",
};
const b: SessionActor = { ...a, id: "slack:U2" };
describe("session authorship", () => {
  it("keeps channel identity stable when linked and separates scopes", () => {
    expect(sessionActorKey(a)).toBe(sessionActorKey({ ...a, memberId: "verified" }));
    expect(sessionActorKey(a)).not.toBe(sessionActorKey({ ...a, hubOrigin: "https://other.test" }));
    expect(sessionActorKey(a)).not.toBe(sessionActorKey({ ...a, connectionId: "other" }));
  });
  it("keeps all participants and clears last actor for unknown interaction", () => {
    const summary: SessionAuthorship = { createdBy: a };
    recordSessionInteraction(summary, {
      actor: a,
      timestamp: "2026-09-11T01:00:00Z",
      kind: "message",
    });
    recordSessionInteraction(summary, {
      actor: b,
      timestamp: "2026-09-11T02:00:00Z",
      kind: "permission",
    });
    recordSessionInteraction(summary, {
      timestamp: "2026-09-11T03:00:00Z",
      kind: "message",
    });
    expect(summary.createdBy).toEqual(a);
    expect(summary.participantActors).toEqual([a, b]);
    expect(summary.lastMessageBy).toBeUndefined();
    expect(summary.lastInteractionBy).toBeUndefined();
    expect(summary.lastInteractionAt).toBe("2026-09-11T03:00:00Z");
  });
  it("aggregates matching actor/time, keeps prior participants, and recomputes after removal", () => {
    const old = {
      createdBy: a,
      lastInteractionBy: a,
      lastInteractionAt: "2026-09-11T01:00:00Z",
    };
    const recent = {
      createdBy: b,
      lastInteractionBy: b,
      lastInteractionAt: "2026-09-11T02:00:00Z",
    };
    const workspace = { createdBy: a, createdAt: "2026-09-10T01:00:00Z" };
    expect(aggregateWorkspaceAuthorship(workspace, [recent, old])).toMatchObject({
      createdBy: a,
      lastInteractionBy: b,
      lastInteractionAt: recent.lastInteractionAt,
      participantActors: [a, b],
    });
    expect(aggregateWorkspaceAuthorship(workspace, [old]).lastInteractionBy).toEqual(a);
    expect(aggregateWorkspaceAuthorship(workspace, []).lastInteractionAt).toBeUndefined();
  });
  it("does not infer creator from the earliest session or create channel bindings from cwd", () => {
    expect(aggregateWorkspaceAuthorship({}, [{ createdBy: a }])).toMatchObject({
      createdBy: undefined,
      channels: [],
    });
  });
});

it("retains historical verified memberships when one scoped sender unlinks and links again", () => {
  const summary: import("@getpaseo/protocol/session-authorship").SessionAuthorship = {};
  const actor = {
    kind: "user" as const,
    id: "slack:sender",
    hubOrigin: "https://hub.example",
    organizationId: "org",
    connectionId: "connection",
  };
  for (const [index, memberId] of ["member-A", undefined, "member-B"].entries()) {
    recordSessionInteraction(summary, {
      actor: { ...actor, ...(memberId ? { memberId } : {}) },
      kind: "message",
      timestamp: `2026-09-11T00:00:0${index}.000Z`,
    });
  }
  expect(summary.participantActors?.map((entry) => entry.memberId)).toEqual([
    "member-A",
    undefined,
    "member-B",
  ]);
  expect(summary.lastMessageBy?.memberId).toBe("member-B");
});

it("breaks cross-session timestamp ties by stable session ID, including unknown actors", () => {
  const sessions = [
    { id: "a", lastInteractionAt: "2026-09-11T00:00:00Z", lastInteractionBy: a },
    { id: "z", lastInteractionAt: "2026-09-11T00:00:00Z" },
  ];
  expect(aggregateWorkspaceAuthorship({}, sessions).lastInteractionBy).toBeUndefined();
  expect(aggregateWorkspaceAuthorship({}, sessions.toReversed()).lastInteractionBy).toBeUndefined();
});

it("does not present a complete latest actor while a workspace has pending summary recovery", () => {
  const summary = aggregateWorkspaceAuthorship({}, [
    { id: "ready", lastInteractionBy: a, lastInteractionAt: "2026-09-11T00:00:00Z" },
    { id: "pending", authorshipStatus: "pending", createdBy: b },
  ]);
  expect(summary).toMatchObject({ authorshipStatus: "pending", participantActors: [a, b] });
  expect(summary.lastInteractionBy).toBeUndefined();
  expect(summary.lastInteractionAt).toBeUndefined();
});

it("aggregates incomplete status deterministically and suppresses authoritative latest activity", () => {
  const sessions: SessionAuthorship[] = ["error", "pending", "recovering", "ready"].map(
    (status) => ({
      authorshipStatus: status as SessionAuthorship["authorshipStatus"],
      lastInteractionBy: a,
      lastInteractionAt: "2026-09-11T01:00:00Z",
    }),
  );
  for (const inputs of [sessions, sessions.toReversed()]) {
    const summary = aggregateWorkspaceAuthorship({}, inputs);
    expect(summary.authorshipStatus).toBe("error");
    expect(summary.lastInteractionBy).toBeUndefined();
    expect(summary.lastInteractionAt).toBeUndefined();
  }
});
