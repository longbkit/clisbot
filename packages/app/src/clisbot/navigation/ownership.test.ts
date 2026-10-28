import { ownershipHostKind } from "./ownership-host";
import { ownershipKey, participationKeyOf } from "./ownership-key";
import * as presentation from "@/clisbot/session-storage/actor-presentation";
import { describe, expect, it, vi } from "vitest";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import {
  countByScope,
  createOwnershipResolver,
  inScope,
  resolveBotOwnership,
  resolveDirectChatOwnership,
  resolveOwnership,
} from "./ownership";

const HUB = "https://hub.example";
const accounts = [{ origin: HUB, id: "u-me", memberId: "m-me" }];
const teammate = { kind: "user" as const, id: "u-2", hubOrigin: HUB, memberId: "m-2" };

describe("resolveOwnership", () => {
  it.each<{ scenario: string; createdBy?: SessionActor }>([
    { scenario: "legacy session with no recorded author" },
    { scenario: "local owner fallback", createdBy: { kind: "user", id: "owner" } },
    {
      scenario: "user with no Hub scope",
      createdBy: { kind: "user", id: "u-me", memberId: "m-me" },
    },
    {
      scenario: "workflow on a teammate's sandbox",
      createdBy: { kind: "automation", id: "workflow", hubOrigin: HUB },
    },
    { scenario: "heartbeat with no Hub scope", createdBy: { kind: "automation", id: "schedule" } },
    {
      scenario: "channel approval policy",
      createdBy: { kind: "system", id: "channel-approval-policy", hubOrigin: HUB },
    },
    { scenario: "system without Hub scope", createdBy: { kind: "system", id: "system" } },
  ])("does not claim ownership from $scenario", ({ createdBy }) => {
    const ownership = resolveOwnership({ hostKind: "hub", createdBy, accounts });
    expect(ownership).toBe("unknown");
    expect(inScope("mine", ownership)).toBe(false);
    expect(countByScope([ownership])).toEqual({ mine: 0, others: 1, all: 1 });
  });

  it("retains direct compatibility only for registered direct Hosts", () => {
    for (const createdBy of [
      undefined,
      { kind: "automation" as const, id: "x" },
      { kind: "user" as const, id: "owner" },
    ]) {
      expect(resolveOwnership({ createdBy, accounts, hostKind: "direct" })).toBe("mine");
      expect(resolveOwnership({ createdBy, accounts, hostKind: "unknown" })).toBe("unknown");
    }
  });

  it("cannot tell who made a Hub member's session while no reader is known for that Hub", () => {
    // Known author, absent reader: the old rule called this mine.
    expect(resolveOwnership({ hostKind: "hub", createdBy: teammate, accounts: [] })).toBe(
      "unknown",
    );
    // A Hub this device is not signed in to.
    expect(
      resolveOwnership({
        hostKind: "hub",
        createdBy: { kind: "user", id: "u-x", hubOrigin: "https://other.example" },
        accounts,
      }),
    ).toBe("unknown");
    // A reader whose account id is not resolved yet cannot be compared either.
    expect(
      resolveOwnership({
        hostKind: "hub",
        createdBy: teammate,
        accounts: [{ origin: HUB, id: null, memberId: null }],
      }),
    ).toBe("unknown");
  });

  it("matches the signed-in account by member, then by id", () => {
    const viaChannel = { kind: "user" as const, id: "slack:U1", hubOrigin: HUB, memberId: "m-me" };
    expect(resolveOwnership({ hostKind: "hub", createdBy: viaChannel, accounts })).toBe("mine");
    const app = { kind: "user" as const, id: "u-me", hubOrigin: HUB };
    expect(resolveOwnership({ hostKind: "hub", createdBy: app, accounts })).toBe("mine");
  });

  it("puts another member's items under Others unless watched", () => {
    expect(resolveOwnership({ hostKind: "hub", createdBy: teammate, accounts })).toBe("others");
    expect(
      resolveOwnership({ hostKind: "hub", createdBy: teammate, accounts, watched: true }),
    ).toBe("mine");
    expect(
      resolveOwnership({ hostKind: "hub", createdBy: teammate, accounts: [], watched: true }),
    ).toBe("mine");
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
    expect(resolveOwnership({ hostKind: "hub", createdBy: mine, accounts: paired })).toBe("mine");
    expect(resolveOwnership({ hostKind: "hub", createdBy: theirs, accounts: paired })).toBe(
      "others",
    );
  });

  it("finds a paired Hub's reader by the Hub's identity when the origin forms share nothing", () => {
    const relayOnly = [{ origin: "hub://hub-1", id: "u-me", memberId: "m-me" }];
    const mine = { kind: "user" as const, id: "u-me", hubOrigin: HUB, hubIdentity: "hub-1" };
    const theirs = { ...teammate, hubIdentity: "hub-1" };
    expect(resolveOwnership({ hostKind: "hub", createdBy: mine, accounts: relayOnly })).toBe(
      "mine",
    );
    expect(resolveOwnership({ hostKind: "hub", createdBy: theirs, accounts: relayOnly })).toBe(
      "others",
    );
    // The same address but another Hub identity is another Hub.
    const impostor = { ...teammate, hubIdentity: "hub-2" };
    expect(
      resolveOwnership({
        hostKind: "hub",
        createdBy: impostor,
        accounts: [{ origin: HUB, id: "u-me", memberId: "m-me", hubId: "hub-1" }],
      }),
    ).toBe("unknown");
  });

  it("does not trust a Bot ownership flag on a Hub Host", () => {
    const context = { accounts, hostKind: "hub" as const };
    expect(resolveBotOwnership({ isOwner: true }, context)).toBe("unknown");
    expect(resolveBotOwnership({ isOwner: true, owner: teammate }, context)).toBe("others");
    expect(resolveBotOwnership({}, context)).toBe("unknown");
    expect(resolveBotOwnership({ isOwner: true }, { ...context, hostKind: "direct" })).toBe("mine");
    expect(resolveBotOwnership({ isOwner: false }, { ...context, hostKind: "direct" })).toBe(
      "others",
    );
  });

  it("uses an existing direct chat even when it has no author", () => {
    const context = { accounts, hostKind: "hub" as const };
    const bot = { owner: { kind: "user" as const, id: "u-me", hubOrigin: HUB } };
    expect(resolveDirectChatOwnership({ directChat: {}, bot }, context)).toBe("unknown");
    expect(resolveDirectChatOwnership({ bot }, context)).toBe("mine");
    expect(resolveDirectChatOwnership({ directChat: { createdBy: teammate }, bot }, context)).toBe(
      "others",
    );
  });
});

describe("scopes", () => {
  it("lists a session nobody can place under Others and All, never For me", () => {
    expect(inScope("all", "unknown")).toBe(true);
    expect(inScope("mine", "unknown")).toBe(false);
    expect(inScope("others", "unknown")).toBe(true);
  });

  it("counts scopes so All is For me plus Others, which holds the ones nobody can place", () => {
    const counts = countByScope(["mine", "others", "mine", "unknown"]);
    expect(counts).toEqual({ mine: 2, others: 2, all: 4 });
    expect(inScope("all", "others") && inScope("mine", "mine") && !inScope("mine", "others")).toBe(
      true,
    );
  });
});

const own = { kind: "user" as const, id: "u-me", hubOrigin: HUB, memberId: "m-me" };

describe("ownership evidence and cache", () => {
  it("accepts participation only without a recorded creator", () => {
    const context = { accounts, hostKind: "hub" as const };
    for (const source of [
      { lastMessageBy: own },
      { participantActors: [teammate, own] },
      { lastMessageBy: own, participantActors: [own] },
    ]) {
      const participationKey = participationKeyOf(source);
      expect(resolveOwnership({ ...context, createdBy: undefined, participationKey })).toBe("mine");
      expect(resolveOwnership({ ...context, createdBy: teammate, participationKey })).toBe(
        "others",
      );
    }
    for (const source of [
      {},
      { lastInteractionBy: own },
      { participantActors: [teammate] },
      { lastMessageBy: { kind: "user" as const, id: "owner" } },
    ]) {
      expect(
        resolveOwnership({
          ...context,
          createdBy: undefined,
          participationKey: participationKeyOf(source),
        }),
      ).toBe("unknown");
    }
  });

  it.each([true, false])("keeps the direct compatibility switch explicit: %s", (keep) => {
    const resolve = createOwnershipResolver(keep);
    for (const createdBy of [
      undefined,
      { kind: "user" as const, id: "owner" },
      { kind: "automation" as const, id: "a" },
      { kind: "system" as const, id: "s" },
    ]) {
      expect(resolve({ accounts, createdBy, hostKind: "direct" })).toBe(keep ? "mine" : "unknown");
      expect(resolve({ accounts, createdBy, hostKind: "hub" })).toBe("unknown");
      expect(resolve({ accounts, createdBy, hostKind: "unknown" })).toBe("unknown");
    }
    expect(resolve({ accounts, createdBy: own, hostKind: "direct" })).toBe("mine");
    expect(resolve({ accounts, createdBy: teammate, hostKind: "direct" })).toBe("others");
  });

  it("requires a verified channel member even when a provider id collides", () => {
    const context = { accounts, hostKind: "hub" as const };
    expect(
      resolveOwnership({ ...context, createdBy: { ...own, id: "slack:U1", connectionId: "c" } }),
    ).toBe("mine");
    expect(
      resolveOwnership({
        ...context,
        createdBy: { ...own, memberId: undefined, connectionId: "c" },
      }),
    ).toBe("others");
    expect(
      resolveOwnership({
        ...context,
        createdBy: { ...own, memberId: "m-other", connectionId: "c" },
      }),
    ).toBe("others");
  });

  it("deduplicates participant identities and ignores presentation changes", () => {
    const first = participationKeyOf({ lastMessageBy: own, participantActors: [teammate, own] });
    expect(
      participationKeyOf({ participantActors: [own, { ...teammate, displayName: "Renamed" }] }),
    ).toBe(first);
    expect(participationKeyOf({ createdBy: teammate, participantActors: [own] })).toBeUndefined();
  });

  it("invalidates the same actor when accounts, participation or Host binding change", () => {
    const resolve = createOwnershipResolver();
    const input = { accounts, createdBy: undefined, hostKind: "direct" as const };
    expect(resolve(input)).toBe("mine");
    const hub = { ...input, hostKind: "hub" as const };
    expect(ownershipKey(hub)).not.toBe(ownershipKey(input));
    expect(resolve(hub)).toBe("unknown");
    const participated = { ...hub, participationKey: participationKeyOf({ lastMessageBy: own }) };
    expect(resolve(participated)).toBe("mine");
    expect(
      resolve({ ...participated, accounts: [{ ...accounts[0], id: "u-2", memberId: "m-2" }] }),
    ).toBe("unknown");
    expect(resolve({ ...participated, hostKind: "unknown" })).toBe("unknown");
  });

  it("reuses identity matches and evicts beyond 2048 entries", () => {
    const match = vi.spyOn(presentation, "isOwnActor");
    const resolve = createOwnershipResolver();
    const input = { accounts, createdBy: own, hostKind: "hub" as const };
    resolve(input);
    resolve({ ...input, createdBy: { ...own, displayName: "New name" } });
    expect(match).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 2048; i++)
      resolve({ ...input, createdBy: { ...own, id: String(i), memberId: String(i) } });
    resolve(input);
    expect(match).toHaveBeenCalledTimes(2050);
    match.mockRestore();
  });
});

it("classifies the registry binding, including mode off and direct TCP on a personal Hub", () => {
  expect(ownershipHostKind(undefined)).toBe("unknown");
  expect(ownershipHostKind({})).toBe("direct");
  const management = { kind: "hub" as const, hubOrigin: HUB, organizationId: "o", daemonId: "d" };
  for (const managedAccessMode of ["external", "off", undefined] as const) {
    const host = {
      management: { ...management, managedAccessMode },
      connections: [{ type: "directTcp" }],
    };
    expect(ownershipHostKind(host)).toBe("hub");
  }
});
