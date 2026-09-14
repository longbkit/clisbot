import { describe, expect, it } from "vitest";
import {
  sessionChannelKey,
  sessionParticipantKey,
  type SessionActor,
  type SessionChannelReference,
} from "@getpaseo/protocol/session-authorship";
import {
  copySessionMetadata,
  matchesSessionMetadata,
  sessionMetadataOptions,
  sessionMetadataRecoveryNotice,
} from "./directory";
const a: SessionActor = {
  kind: "user",
  id: "a",
  hubOrigin: "https://hub.one",
  organizationId: "org",
  memberId: "member-a",
};
const b: SessionActor = {
  kind: "user",
  id: "b",
  hubOrigin: "https://hub.one",
  organizationId: "org",
  connectionId: "slack",
};
const channel: SessionChannelReference = {
  hubOrigin: "https://hub.one",
  organizationId: "org",
  connectionId: "slack",
  channelId: "C1",
  displayName: "general",
};
describe("directory authorship filters", () => {
  it("preserves recovery status without turning unknown metadata into a filter match", () => {
    for (const authorshipStatus of ["pending", "recovering", "error"] as const) {
      const metadata = copySessionMetadata({ authorshipStatus, createdBy: a });
      expect(metadata.authorshipStatus).toBe(authorshipStatus);
      expect(matchesSessionMetadata(metadata, ["missing"], ["missing"])).toBe(false);
      expect(matchesSessionMetadata(metadata, [sessionParticipantKey(a)], [])).toBe(true);
    }
    expect(matchesSessionMetadata({ authorshipStatus: "ready" }, ["missing"], ["missing"])).toBe(
      false,
    );
  });
  it("reports incomplete metadata independently of filtered rows", () => {
    expect(sessionMetadataRecoveryNotice([{ authorshipStatus: "pending" }], true)).toContain(
      "Filter results may be incomplete",
    );
    expect(
      sessionMetadataRecoveryNotice(
        [{ authorshipStatus: "pending" }, { authorshipStatus: "error" }],
        true,
      ),
    ).toContain("unavailable");
    expect(sessionMetadataRecoveryNotice([{ authorshipStatus: "ready" }, {}], true)).toBeNull();
  });
  it("matches any participant after another user takes over, OR within each dimension and AND across dimensions", () => {
    const workspace = {
      createdBy: a,
      participantActors: [a, b],
      lastInteractionBy: b,
      channels: [channel],
    };
    expect(
      matchesSessionMetadata(
        workspace,
        ["missing", sessionParticipantKey(a)],
        [sessionChannelKey(channel)],
      ),
    ).toBe(true);
    expect(matchesSessionMetadata(workspace, [sessionParticipantKey(a)], ["missing"])).toBe(false);
    expect(matchesSessionMetadata(workspace, ["missing"], [sessionChannelKey(channel)])).toBe(
      false,
    );
  });
  it("does not match missing official/legacy metadata and never merges equal names across sources", () => {
    expect(matchesSessionMetadata({}, [], [])).toBe(true);
    expect(matchesSessionMetadata({}, [sessionParticipantKey(a)], [])).toBe(false);
    expect(
      matchesSessionMetadata(
        { participantActors: [{ ...a, hubOrigin: "https://hub.two" }] },
        [sessionParticipantKey(a)],
        [],
      ),
    ).toBe(false);
    expect(
      matchesSessionMetadata(
        { channels: [{ ...channel, connectionId: "other" }] },
        [],
        [sessionChannelKey(channel)],
      ),
    ).toBe(false);
  });
  it("joins app and channel identities only by a verified scoped Member", () => {
    const linked = { ...a, id: "slack:U1", connectionId: "slack" };
    expect(
      matchesSessionMetadata({ participantActors: [linked] }, [sessionParticipantKey(a)], []),
    ).toBe(true);
    expect(
      matchesSessionMetadata(
        { participantActors: [{ ...linked, memberId: undefined }] },
        [sessionParticipantKey(a)],
        [],
      ),
    ).toBe(false);
  });
  it("builds options entirely from directory snapshots and keeps distinct channel keys", () => {
    const options = sessionMetadataOptions([
      {
        createdBy: a,
        participantActors: [a, b],
        channels: [channel, { ...channel, connectionId: "other" }],
      },
    ]);
    expect(options.users.size).toBe(2);
    expect(options.channels.size).toBe(2);
  });
});
