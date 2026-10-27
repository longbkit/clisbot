import { describe, expect, it } from "vitest";
import {
  countByScope,
  inScope,
  resolveBotOwnership,
  resolveDirectChatOwnership,
  resolveOwnership,
} from "./ownership";

const HUB = "https://hub.example";
const accounts = [{ origin: HUB, id: "u-me", memberId: "m-me" }];
const teammate = { kind: "user" as const, id: "u-2", hubOrigin: HUB, memberId: "m-2" };

describe("resolveOwnership", () => {
  it("keeps work with no person behind it as mine", () => {
    expect(resolveOwnership({ createdBy: undefined, accounts })).toBe("mine");
    expect(resolveOwnership({ createdBy: { kind: "automation", id: "x" }, accounts })).toBe("mine");
    // A direct connection records no Hub origin: the device owner's.
    expect(resolveOwnership({ createdBy: { kind: "user", id: "owner" }, accounts })).toBe("mine");
  });

  it("cannot tell who made a Hub member's session while no reader is known for that Hub", () => {
    // Known author, absent reader: the old rule called this mine.
    expect(resolveOwnership({ createdBy: teammate, accounts: [] })).toBe("unknown");
    // A Hub this device is not signed in to.
    expect(
      resolveOwnership({
        createdBy: { kind: "user", id: "u-x", hubOrigin: "https://other.example" },
        accounts,
      }),
    ).toBe("unknown");
    // A reader whose account id is not resolved yet cannot be compared either.
    expect(
      resolveOwnership({
        createdBy: teammate,
        accounts: [{ origin: HUB, id: null, memberId: null }],
      }),
    ).toBe("unknown");
  });

  it("matches the signed-in account by member, then by id", () => {
    const viaChannel = { kind: "user" as const, id: "slack:U1", hubOrigin: HUB, memberId: "m-me" };
    expect(resolveOwnership({ createdBy: viaChannel, accounts })).toBe("mine");
    const app = { kind: "user" as const, id: "u-me", hubOrigin: HUB };
    expect(resolveOwnership({ createdBy: app, accounts })).toBe("mine");
  });

  it("puts another member's items under Others unless watched", () => {
    expect(resolveOwnership({ createdBy: teammate, accounts })).toBe("others");
    expect(resolveOwnership({ createdBy: teammate, accounts, watched: true })).toBe("mine");
    expect(resolveOwnership({ createdBy: teammate, accounts: [], watched: true })).toBe("mine");
  });

  it("finds the reader when the Hub is named by another form of its origin", () => {
    // A paired Hub is scoped as hub://<id>; its sessions name the Hub's HTTPS address.
    const paired = [
      {
        origin: "hub://hub-1",
        aliases: ["https://hub.example"],
        id: "u-me",
        memberId: "m-me",
      },
    ];
    const mine = { kind: "user" as const, id: "u-me", hubOrigin: "HTTPS://Hub.Example:443/" };
    const theirs = { ...teammate, hubOrigin: "https://hub.example/" };
    expect(resolveOwnership({ createdBy: mine, accounts: paired })).toBe("mine");
    expect(resolveOwnership({ createdBy: theirs, accounts: paired })).toBe("others");
  });

  it("finds a paired Hub's reader by the Hub's identity when the origin forms share nothing", () => {
    const relayOnly = [{ origin: "hub://hub-1", id: "u-me", memberId: "m-me" }];
    const mine = { kind: "user" as const, id: "u-me", hubOrigin: HUB, hubIdentity: "hub-1" };
    const theirs = { ...teammate, hubIdentity: "hub-1" };
    expect(resolveOwnership({ createdBy: mine, accounts: relayOnly })).toBe("mine");
    expect(resolveOwnership({ createdBy: theirs, accounts: relayOnly })).toBe("others");
    // The same address but another Hub identity is another Hub.
    const impostor = { ...teammate, hubIdentity: "hub-2" };
    expect(
      resolveOwnership({
        createdBy: impostor,
        accounts: [{ origin: HUB, id: "u-me", memberId: "m-me", hubId: "hub-1" }],
      }),
    ).toBe("unknown");
  });

  it("uses the Host's Bot ownership projection first", () => {
    expect(resolveBotOwnership({ isOwner: false }, accounts)).toBe("others");
    expect(resolveBotOwnership({ isOwner: true }, accounts)).toBe("mine");
    expect(resolveBotOwnership({}, accounts)).toBe("mine");
    expect(resolveBotOwnership({ owner: teammate }, accounts)).toBe("others");
    expect(resolveBotOwnership({ owner: teammate }, [])).toBe("unknown");
  });

  it("lets a Bot's direct chat decide before the Bot's owner does", () => {
    expect(
      resolveDirectChatOwnership({ directChatCreatedBy: teammate, bot: { isOwner: true } }, []),
    ).toBe("unknown");
    expect(resolveDirectChatOwnership({ directChatCreatedBy: undefined, bot: {} }, [])).toBe(
      "mine",
    );
  });
});

describe("scopes", () => {
  it("lists a session nobody can place only under All", () => {
    expect(inScope("all", "unknown")).toBe(true);
    expect(inScope("mine", "unknown")).toBe(false);
    expect(inScope("others", "unknown")).toBe(false);
  });

  it("counts scopes so All is For me, Others and the ones nobody can place", () => {
    const counts = countByScope(["mine", "others", "mine", "unknown"]);
    expect(counts).toEqual({ mine: 2, others: 1, unknown: 1, all: 4 });
    expect(inScope("all", "others") && inScope("mine", "mine") && !inScope("mine", "others")).toBe(
      true,
    );
  });
});
