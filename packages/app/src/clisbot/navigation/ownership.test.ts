import { describe, expect, it } from "vitest";
import { countByScope, inScope, resolveBotOwnership, resolveOwnership } from "./ownership";

const HUB = "https://hub.example";
const accounts = [{ origin: HUB, id: "u-me", memberId: "m-me" }];

describe("resolveOwnership", () => {
  it("treats unknown authors as mine", () => {
    expect(resolveOwnership({ createdBy: undefined, accounts })).toBe("mine");
    expect(resolveOwnership({ createdBy: { kind: "automation", id: "x" }, accounts })).toBe("mine");
    // A direct connection records no Hub origin: the device owner's.
    expect(resolveOwnership({ createdBy: { kind: "user", id: "owner" }, accounts })).toBe("mine");
    // A Hub this device is not signed in to cannot be told apart.
    expect(
      resolveOwnership({
        createdBy: { kind: "user", id: "u-x", hubOrigin: "https://other.example" },
        accounts,
      }),
    ).toBe("mine");
  });

  it("matches the signed-in account by member, then by id", () => {
    const viaChannel = { kind: "user" as const, id: "slack:U1", hubOrigin: HUB, memberId: "m-me" };
    expect(resolveOwnership({ createdBy: viaChannel, accounts })).toBe("mine");
    const app = { kind: "user" as const, id: "u-me", hubOrigin: HUB };
    expect(resolveOwnership({ createdBy: app, accounts })).toBe("mine");
  });

  it("puts another member's items under Others unless watched", () => {
    const other = { kind: "user" as const, id: "u-2", hubOrigin: HUB, memberId: "m-2" };
    expect(resolveOwnership({ createdBy: other, accounts })).toBe("others");
    expect(resolveOwnership({ createdBy: other, accounts, watched: true })).toBe("mine");
  });

  it("uses the Host's Bot ownership projection first", () => {
    expect(resolveBotOwnership({ isOwner: false }, accounts)).toBe("others");
    expect(resolveBotOwnership({ isOwner: true }, accounts)).toBe("mine");
    expect(resolveBotOwnership({}, accounts)).toBe("mine");
  });

  it("counts scopes so All is the sum of For me and Others", () => {
    const counts = countByScope(["mine", "others", "mine"]);
    expect(counts).toEqual({ mine: 2, others: 1, all: 3 });
    expect(inScope("all", "others") && inScope("mine", "mine") && !inScope("mine", "others")).toBe(
      true,
    );
  });
});
