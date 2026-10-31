import { describe, expect, it } from "vitest";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { resolveOwnership, type Ownership, type OwnershipHostKind } from "./ownership";
import { participationKeyOf } from "./ownership-key";
import {
  countWork,
  createWorkCounter,
  createWorkFilter,
  type WorkQuery,
  type WorkSession,
  type WorkWorkspace,
} from "./work-items";

const reader = { origin: "https://hub.example", id: "reader", memberId: "member-reader" };
const own: SessionActor = { kind: "user", id: reader.id, hubOrigin: reader.origin };
const other: SessionActor = { ...own, id: "other", memberId: "member-other" };
const workspace: WorkWorkspace = {
  workspaceKey: "host:workspace",
  serverId: "host",
  workspaceId: "workspace",
  statusBucket: "done",
  createdBy: own,
};
const query = (hostKind: OwnershipHostKind = "hub"): WorkQuery => ({
  accounts: [reader],
  hostKinds: new Map([["host", hostKind]]),
  scope: "mine",
  chip: "all",
  showBots: true,
});

describe("incremental ownership evidence", () => {
  it("keeps distinct Host keys and invalidates unchanged workspace counts when bindings change", () => {
    const counter = createWorkCounter();
    // A proven other person is Others on a known Host and unproven (so the reader's) on an
    // unknown one; that difference is what shows a Host binding change was not served stale.
    const sessions: WorkSession[] = [{ id: "theirs", statusBucket: "done", createdBy: other }];
    const options = query("direct");
    const second = { ...workspace, workspaceKey: "other:workspace", serverId: "other" };
    const mixed = {
      ...options,
      hostKinds: new Map<string, OwnershipHostKind>([["host", "direct"]]),
    };
    expect(counter([workspace, second], () => sessions, mixed).scopes).toEqual({
      mine: 1,
      others: 1,
      all: 2,
    });
    for (const [hostKind, mine] of [
      ["direct", 0],
      ["unknown", 1],
      ["hub", 0],
      ["unknown", 1],
      ["direct", 0],
    ] as const) {
      const next = {
        ...options,
        hostKinds: new Map<string, OwnershipHostKind>(
          hostKind === "unknown" ? [] : [["host", hostKind]],
        ),
      };
      const counts = counter([workspace], () => sessions, next);
      expect(counts).toEqual(countWork([workspace], () => sessions, next));
      expect(counts.scopes).toEqual({ mine, others: 1 - mine, all: 1 });
      expect(createWorkFilter(next, () => sessions).session(sessions[0], workspace)).toBe(
        mine === 1,
      );
    }
  });

  it("updates absent-author participation while reusing equivalent identity snapshots", () => {
    // Both "unknown" and "mine" count as For me, so the resolved values show the re-resolution.
    const resolved: Ownership[] = [];
    let calls = 0;
    const counter = createWorkCounter((input) => {
      calls++;
      const ownership = resolveOwnership(input);
      resolved.push(ownership);
      return ownership;
    });
    const options = query();
    let sessions: WorkSession[] = [{ id: "absent", statusBucket: "done" }];
    expect(counter([workspace], () => sessions, options).scopes).toEqual({
      mine: 1,
      others: 0,
      all: 1,
    });
    sessions = [{ ...sessions[0], participationKey: participationKeyOf({ lastMessageBy: own }) }];
    const participated = counter([workspace], () => sessions, options);
    expect(participated.scopes.mine).toBe(1);
    expect(calls).toBe(2);
    expect(resolved).toEqual(["unknown", "mine"]);
    sessions = [
      {
        ...sessions[0],
        participationKey: participationKeyOf({
          participantActors: [{ ...own, displayName: "Updated profile" }, own],
        }),
      },
    ];
    expect(counter([workspace], () => sessions, options)).toBe(participated);
    expect(calls).toBe(2);
    sessions = [
      ...sessions,
      {
        id: "another-absent",
        statusBucket: "done",
        participationKey: participationKeyOf({ lastMessageBy: other }),
      },
    ];
    // With no creator, another verified person's message makes the session theirs.
    expect(counter([workspace], () => sessions, options).scopes).toEqual({
      mine: 1,
      others: 1,
      all: 2,
    });
    expect(resolved.at(-1)).toBe("others");
    sessions = sessions.map((session) => ({ ...session, participationKey: undefined }));
    expect(counter([workspace], () => sessions, options).scopes).toEqual({
      mine: 2,
      others: 0,
      all: 2,
    });
    expect(counter([workspace], () => sessions, options)).toEqual(
      countWork([workspace], () => sessions, options),
    );
  });

  it("invalidates channel linkage and reader identity without changing the session ID", () => {
    const counter = createWorkCounter();
    const options = query();
    const channel = { ...own, connectionId: "connection" };
    const snapshots: [SessionActor, number][] = [
      [own, 1],
      [channel, 0],
      [{ ...channel, id: "channel-user", memberId: reader.memberId }, 1],
      [{ ...channel, memberId: other.memberId }, 0],
    ];
    for (const [createdBy, mine] of snapshots) {
      const sessions = [{ id: "same-session", statusBucket: "done", createdBy }];
      const counts = counter([workspace], () => sessions, options);
      expect(counts.scopes).toEqual({ mine, others: 1 - mine, all: 1 });
      expect(counts).toEqual(countWork([workspace], () => sessions, options));
      expect(createWorkFilter(options, () => sessions).session(sessions[0], workspace)).toBe(
        mine === 1,
      );
    }
    const sessions = [{ id: "same-session", statusBucket: "done", createdBy: other }];
    const switched = {
      ...options,
      accounts: [{ ...reader, id: other.id, memberId: other.memberId }],
    };
    expect(counter([workspace], () => sessions, switched).scopes.mine).toBe(1);
    expect(counter([workspace], () => sessions, options).scopes.mine).toBe(0);
  });

  it("updates authored participation and ignores profile-only edits", () => {
    let calls = 0;
    const counter = createWorkCounter((input) => {
      calls++;
      return resolveOwnership(input);
    });
    const options = query();
    const session: WorkSession = { id: "authored", statusBucket: "done", createdBy: other };
    const initial = counter([workspace], () => [session], options);
    const edited = {
      ...session,
      createdBy: { ...other, displayName: "New profile" },
      participationKey: participationKeyOf({ lastMessageBy: own }),
    };
    expect(initial.scopes).toEqual({ mine: 0, others: 1, all: 1 });
    const participated = counter([workspace], () => [edited], options);
    expect(participated.scopes).toEqual({ mine: 1, others: 0, all: 1 });
    expect(calls).toBe(2);
    const renamed = { ...edited, createdBy: { ...other, displayName: "Renamed again" } };
    expect(counter([workspace], () => [renamed], options)).toBe(participated);
    expect(calls).toBe(2);
    expect(counter([workspace], () => [session], options).scopes).toEqual(initial.scopes);
    // The original evidence key can reuse its cached classification after removal.
    expect(calls).toBe(2);
  });
});
