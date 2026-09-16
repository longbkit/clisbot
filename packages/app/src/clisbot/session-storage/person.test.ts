import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import { resolvePersonProfile, type RosterMember } from "./person";

const roster: RosterMember[] = [
  {
    id: "member",
    userId: "user-1",
    name: "Long Luong",
    email: "long@example.com",
    image: "https://cdn.example/now.png",
  },
];
const onSlack: SessionActor = {
  kind: "user",
  id: "slack:U8ZTVGJJF",
  displayName: "Long L.",
  organizationId: "org",
  connectionId: "connection",
  memberId: "member",
  hubOrigin: "https://hub.example",
  avatarUrl: "https://cdn.example/then.png",
};

describe("resolvePersonProfile", () => {
  it("prefers what the Hub knows now over what the snapshot froze", () => {
    const resolved = resolvePersonProfile(onSlack, roster);
    assert.equal(resolved.member, roster[0]);
    assert.equal(resolved.actor.displayName, "Long Luong");
    assert.equal(resolved.actor.avatarUrl, "https://cdn.example/now.png");
    // Presentation changes; the recorded identity does not.
    assert.equal(resolved.actor.id, onSlack.id);
    assert.equal(resolved.actor.memberId, onSlack.memberId);
  });

  it("falls back to the snapshot when the roster is unavailable or has no image", () => {
    const unavailable = resolvePersonProfile(onSlack, []);
    assert.equal(unavailable.member, undefined);
    // The same object, so a memoized row does not re-render for nothing.
    assert.equal(unavailable.actor, onSlack);
    const withoutImage = resolvePersonProfile(onSlack, [{ ...roster[0]!, image: null }]);
    assert.equal(withoutImage.actor.avatarUrl, "https://cdn.example/then.png");
    assert.equal(withoutImage.actor.displayName, "Long Luong");
  });

  it("leaves an unlinked sender on their own identity", () => {
    const unlinked = { ...onSlack, memberId: undefined, avatarUrl: undefined };
    assert.deepEqual(resolvePersonProfile(unlinked, roster), {
      actor: unlinked,
      member: undefined,
    });
  });

  it("indexes a roster once however many actors it resolves", () => {
    const counted: RosterMember[] = [...roster];
    let reads = 0;
    const observed = new Proxy(counted, {
      get(target, key, receiver) {
        if (key === "map") reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    resolvePersonProfile(onSlack, observed);
    resolvePersonProfile(onSlack, observed);
    assert.equal(reads, 1);
  });
});
