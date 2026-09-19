import { describe, expect, it } from "vitest";
import { convertAccountFile, intersectWhere, type ChannelUseGrant } from "./route-shape.js";

const BASE = {
  channel: "slack",
  accountId: "work",
  connectionId: "c1",
  transport: { mode: "socket" },
};

function grant(overrides: Partial<ChannelUseGrant> = {}): ChannelUseGrant {
  return {
    id: "g1",
    subjectKind: "member",
    subjectId: "m1",
    channel: "slack",
    accountId: "work",
    conversation: { kind: "all" },
    ...overrides,
  };
}

describe("convertAccountFile", () => {
  it("folds an all-conversations grant into each Route without widening its Where", () => {
    const converted = convertAccountFile(
      {
        ...BASE,
        routes: [
          { agent: "a", match: { kind: "channel", ids: ["C_ENG"] }, audience: { kind: "members" } },
          { agent: "b", match: { kind: "channel", ids: ["C_SUPPORT"] } },
        ],
      },
      [grant()],
    );

    expect(converted.account.routes?.map((route) => route.audience)).toEqual([
      [
        { who: { roles: ["member"] }, where: { conversations: ["C_ENG"] } },
        { who: { members: ["m1"] }, where: { conversations: ["C_ENG"] } },
      ],
      [
        { who: { roles: ["member"] }, where: { conversations: ["C_SUPPORT"] } },
        { who: { members: ["m1"] }, where: { conversations: ["C_SUPPORT"] } },
      ],
    ]);
    expect(converted.foldedGrantIds).toEqual(["g1"]);
  });

  it("adds no rule to a Route the grant's scope does not reach", () => {
    const converted = convertAccountFile(
      { ...BASE, routes: [{ agent: "a", match: { kind: "dm" } }] },
      [grant({ conversation: { kind: "public_channels" } })],
    );

    expect(converted.account.routes?.[0]?.audience).toEqual([
      { who: { roles: ["member"] }, where: { dm: true } },
    ]);
  });

  it("turns an enabled catch-all into a last Route and records its position", () => {
    const converted = convertAccountFile(
      {
        ...BASE,
        routes: [{ agent: "a", audience: [{ who: { roles: ["owner"] }, where: { dm: true } }] }],
        fallback: { agent: "cheap", audience: { kind: "conversationParticipants" } },
      },
      [],
    );

    expect(converted.fallbackPosition).toBe(1);
    expect(converted.account.routes?.[1]).toEqual({
      agent: "cheap",
      audience: [{ who: { anyone: true }, where: { dm: true, groups: "all" } }],
    });
    expect(converted.account).not.toHaveProperty("fallback");
  });

  it("drops a denying catch-all: refusing is the default", () => {
    const converted = convertAccountFile(
      { ...BASE, routes: [{ agent: "a", match: { kind: "dm" } }], fallback: { deny: true } },
      [],
    );

    expect(converted.fallbackPosition).toBeUndefined();
    expect(converted.account.routes).toHaveLength(1);
    expect(converted.account).not.toHaveProperty("fallback");
  });

  it("gives a grant its own scope on the catch-all, which covered everything", () => {
    const converted = convertAccountFile({ ...BASE, fallback: { agent: "cheap" } }, [
      grant({ conversation: { kind: "public_channels" }, subjectKind: "team", subjectId: "t1" }),
    ]);

    expect(converted.account.routes?.[0]?.audience).toContainEqual({
      who: { teams: ["t1"] },
      where: { groups: "public" },
    });
  });

  it("keeps a thread route's contains marker at the Route level", () => {
    const converted = convertAccountFile(
      { ...BASE, routes: [{ workflow: "w", match: { kind: "thread", contains: "#triage" } }] },
      [],
    );

    expect(converted.account.routes?.[0]).toMatchObject({
      contains: "#triage",
      audience: [{ who: { roles: ["member"] }, where: { groups: "all" } }],
    });
    expect(converted.account.routes?.[0]).not.toHaveProperty("match");
  });
});

describe("intersectWhere", () => {
  it("keeps a listed room only where the other side lists it or covers every group", () => {
    expect(intersectWhere({ conversations: ["C1"] }, { groups: "all" })).toEqual({
      conversations: ["C1"],
    });
    expect(intersectWhere({ conversations: ["C1"] }, { groups: "public" })).toBeUndefined();
    expect(intersectWhere({ dm: true, groups: "public" }, { dm: true, groups: "private" })).toEqual(
      { dm: true },
    );
  });
});
