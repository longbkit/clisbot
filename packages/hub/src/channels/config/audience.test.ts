import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  compileAudienceRule,
  deriveRouteWhere,
  isOpenAudience,
  needsSenderFacts,
  ruleAdmits,
  whereCovers,
  whoMatches,
  type AudienceSender,
} from "./audience.js";
import { AccountFileSchema, AudienceRuleSchema, RouteSchema } from "./schema.js";

const owner: AudienceSender = {
  identity: "slack:U0OWNER",
  member: { membershipId: "m-owner", role: "owner", teamIds: ["qc"] },
};
const member: AudienceSender = {
  identity: "slack:U0MEMBER",
  member: { membershipId: "m-member", role: "member", teamIds: [] },
};
const stranger: AudienceSender = { identity: "slack:U0STRANGER", member: null };

describe("audience rule schema", () => {
  it("requires at least one Who part and one Where part", () => {
    assert.equal(AudienceRuleSchema.safeParse({ who: {}, where: { dm: true } }).success, false);
    assert.equal(
      AudienceRuleSchema.safeParse({ who: { anyone: true }, where: { groups: "off" } }).success,
      false,
    );
    assert.equal(
      AudienceRuleSchema.safeParse({ who: { roles: ["owner"] }, where: { dm: true } }).success,
      true,
    );
  });

  it("accepts named DMs as the only Where, and refuses them for a Who of Guests alone", () => {
    const named = { dmMembers: ["m-owner"] };
    assert.equal(
      AudienceRuleSchema.safeParse({ who: { roles: ["member"] }, where: named }).success,
      true,
    );
    assert.equal(
      AudienceRuleSchema.safeParse({ who: { anyone: true }, where: named }).success,
      true,
    );
    // The same holds the other way: Guests named for DMs need a Who that can hold a Guest.
    const guestList = { dmIdentities: ["U0GUEST"] };
    assert.equal(
      AudienceRuleSchema.safeParse({ who: { identities: ["U0GUEST"] }, where: guestList }).success,
      true,
    );
    const membersOnly = AudienceRuleSchema.safeParse({
      who: { roles: ["member"] },
      where: guestList,
    });
    assert.equal(membersOnly.success, false);
    assert.deepEqual(membersOnly.error?.issues[0]?.path, ["where", "dmIdentities"]);
    // A Guest has no Member, so it can never be on the list: the rule would admit nobody.
    const guests = AudienceRuleSchema.safeParse({ who: { identities: ["U0GUEST"] }, where: named });
    assert.equal(guests.success, false);
    assert.deepEqual(guests.error?.issues[0]?.path, ["where", "dmMembers"]);
    // With every DM open the list is unused, so the same Who is fine.
    assert.equal(
      AudienceRuleSchema.safeParse({
        who: { identities: ["U0GUEST"] },
        where: { dm: true, dmMembers: ["m-owner"] },
      }).success,
      true,
    );
  });

  it("reports the failing rule under routes[i].audience[j]", () => {
    const result = RouteSchema.safeParse({
      audience: [
        { who: { roles: ["owner"] }, where: { dm: true } },
        { who: {}, where: {} },
      ],
      agent: "a",
      environment: "e",
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.error?.issues[0]?.path.slice(0, 2), ["audience", 1]);
  });
});

describe("where", () => {
  const dmOnly = compileAudienceRule({ who: { anyone: true }, where: { dm: true } }).where;
  const groupsAll = compileAudienceRule({ who: { anyone: true }, where: { groups: "all" } }).where;
  const publicOnly = compileAudienceRule({
    who: { anyone: true },
    where: { groups: "public" },
  }).where;
  const specific = compileAudienceRule({
    who: { anyone: true },
    where: { conversations: ["C0QC", 42] },
  }).where;

  it("covers DMs only when the rule says DM: a channel rule never implies DM access", () => {
    assert.equal(whereCovers(dmOnly, { kind: "dm", id: "D1" }), true);
    assert.equal(whereCovers(groupsAll, { kind: "dm", id: "D1" }), false);
    assert.equal(whereCovers(dmOnly, { kind: "channel", id: "C1" }), false);
  });

  it("narrows DMs to the named Members of the Who, and leaves group chats to the Who", () => {
    const rule = compileAudienceRule({
      who: { roles: ["member"] },
      where: { dmMembers: ["m-owner"], conversations: ["C1"] },
    });
    const dm = { kind: "dm", id: "D1" } as const;
    assert.equal(ruleAdmits(rule, dm, owner), true);
    assert.equal(ruleAdmits(rule, dm, member), false);
    assert.equal(ruleAdmits(rule, dm, stranger), false);
    assert.equal(ruleAdmits(rule, { kind: "channel", id: "C1" }, member), true);
    assert.equal(deriveRouteWhere([rule]).dm, true);
    assert.equal(needsSenderFacts([rule], dm), true);
    // A named Member outside the Who stays out: the list narrows, it never adds.
    const teamOnly = compileAudienceRule({
      who: { teams: ["qc"] },
      where: { dmMembers: ["m-member"] },
    });
    assert.equal(ruleAdmits(teamOnly, dm, member), false);
    // `dm: true` already covers every DM, so the list is dropped.
    const allDms = compileAudienceRule({
      who: { roles: ["member"] },
      where: { dm: true, dmMembers: ["m-owner"] },
    });
    assert.deepEqual(allDms.where.dmMembers, []);
    assert.equal(ruleAdmits(allDms, dm, member), true);
  });

  it("treats a DM listed under conversations as open to the whole Who, threads included", () => {
    const rule = compileAudienceRule({
      who: { roles: ["member"] },
      where: { dmMembers: ["m-owner"], conversations: ["D1"] },
    });
    // D1 is named, so the Who decides there; the list narrows every other DM.
    assert.equal(ruleAdmits(rule, { kind: "dm", id: "D1" }, member), true);
    assert.equal(
      ruleAdmits(rule, { kind: "dm", id: "1700000000.1", rootConversationId: "D1" }, member),
      true,
    );
    assert.equal(ruleAdmits(rule, { kind: "dm", id: "D2" }, member), false);
    assert.equal(
      ruleAdmits(rule, { kind: "dm", id: "1700000000.2", rootConversationId: "D2" }, owner),
      true,
    );
  });

  it("covers every group chat under `all`, and public/private only when reported", () => {
    assert.equal(whereCovers(groupsAll, { kind: "channel", id: "C1" }), true);
    assert.equal(whereCovers(groupsAll, { kind: "group", id: "-100" }), true);
    assert.equal(whereCovers(publicOnly, { kind: "channel", id: "C1" }), false);
    assert.equal(
      whereCovers(publicOnly, { kind: "channel", id: "C1", visibility: "public" }),
      true,
    );
    assert.equal(
      whereCovers(publicOnly, { kind: "channel", id: "C1", visibility: "private" }),
      false,
    );
  });

  it("resolves threads and topics to their room, and a listed thread id narrows to it", () => {
    assert.equal(
      whereCovers(specific, { kind: "thread", id: "1.2", rootConversationId: "C0QC" }),
      true,
    );
    assert.equal(
      whereCovers(specific, { kind: "topic", id: "42", rootConversationId: "-200" }),
      true,
    );
    assert.equal(whereCovers(specific, { kind: "channel", id: "C0OTHER" }), false);
    assert.deepEqual(specific.conversations, ["C0QC", "42"]);
  });

  it("derives a Route's Where as the union of its rules", () => {
    const rules = [
      compileAudienceRule({ who: { roles: ["owner"] }, where: { dm: true, groups: "public" } }),
      compileAudienceRule({ who: { anyone: true }, where: { conversations: ["C1"] } }),
    ];
    assert.deepEqual(deriveRouteWhere(rules), {
      dm: true,
      groups: ["public"],
      conversations: ["C1"],
    });
    assert.equal(isOpenAudience(rules), true);
    // Only the rules covering the conversation count: the anyone room reads no Member.
    assert.equal(needsSenderFacts(rules, { kind: "dm", id: "D1" }), true);
    assert.equal(needsSenderFacts(rules, { kind: "channel", id: "C1" }), false);
  });

  it("asks for Member facts on a named-DM rule only in DMs", () => {
    const rules = [
      compileAudienceRule({
        who: { anyone: true },
        where: { dmMembers: ["m-owner"], conversations: ["C1"] },
      }),
    ];
    assert.equal(needsSenderFacts(rules, { kind: "dm", id: "D1" }), true);
    assert.equal(needsSenderFacts(rules, { kind: "channel", id: "C1" }), false);
  });

  it("names Guests for DMs the way it names Members, in either spelling", () => {
    const rule = compileAudienceRule({
      who: { anyone: true },
      where: { dmIdentities: ["U0STRANGER"], dmMembers: ["m-owner"] },
    });
    const dm = { kind: "dm", id: "D1" } as const;
    assert.equal(ruleAdmits(rule, dm, stranger), true);
    assert.equal(ruleAdmits(rule, dm, owner), true);
    assert.equal(ruleAdmits(rule, dm, member), false);
    assert.equal(ruleAdmits(rule, dm, { identity: "slack:U0OTHER", member: null }), false);
    // Guests alone need no Member read.
    const guests = compileAudienceRule({
      who: { identities: ["slack:U0STRANGER", "U0OTHER"] },
      where: { dmIdentities: ["slack:U0STRANGER"] },
    });
    assert.equal(ruleAdmits(guests, dm, stranger), true);
    assert.equal(ruleAdmits(guests, dm, { identity: "slack:U0OTHER", member: null }), false);
    assert.equal(needsSenderFacts([guests], dm), false);
  });

  it("narrows DMs by Team the way Who names a Team", () => {
    const rule = compileAudienceRule({ who: { roles: ["member"] }, where: { dmTeams: ["qc"] } });
    const dm = { kind: "dm", id: "D1" } as const;
    assert.equal(ruleAdmits(rule, dm, owner), true); // owner is in Team qc
    assert.equal(ruleAdmits(rule, dm, member), false);
    assert.equal(needsSenderFacts([rule], dm), true);
    assert.equal(
      AudienceRuleSchema.safeParse({ who: { identities: ["U0GUEST"] }, where: { dmTeams: ["qc"] } })
        .success,
      false,
    );
  });

  it("calls a Route open only when anyone gets in somewhere un-narrowed", () => {
    const open = (where: Parameters<typeof compileAudienceRule>[0]["where"]) =>
      isOpenAudience([compileAudienceRule({ who: { anyone: true }, where })]);
    assert.equal(open({ dmMembers: ["m-owner"] }), false);
    assert.equal(open({ dmIdentities: ["U0STRANGER"] }), false);
    assert.equal(open({ dm: true }), true);
    assert.equal(open({ dmMembers: ["m-owner"], conversations: ["C1"] }), true);
    assert.equal(open({ groups: "public" }), true);
  });
});

describe("who", () => {
  const who = (input: Parameters<typeof compileAudienceRule>[0]["who"]) =>
    compileAudienceRule({ who: input, where: { dm: true } }).who;

  it("matches roles per message: admin includes Owners, member is every linked Member", () => {
    assert.equal(whoMatches(who({ roles: ["owner"] }), owner), true);
    assert.equal(whoMatches(who({ roles: ["admin"] }), owner), true);
    assert.equal(whoMatches(who({ roles: ["admin"] }), member), false);
    assert.equal(whoMatches(who({ roles: ["member"] }), member), true);
    assert.equal(whoMatches(who({ roles: ["member"] }), stranger), false);
  });

  it("matches Teams, Members, identities in either spelling, and anyone", () => {
    assert.equal(whoMatches(who({ teams: ["qc"] }), owner), true);
    assert.equal(whoMatches(who({ teams: ["qc"] }), member), false);
    assert.equal(whoMatches(who({ members: ["m-member"] }), member), true);
    assert.equal(whoMatches(who({ identities: ["U0STRANGER"] }), stranger), true);
    assert.equal(whoMatches(who({ identities: ["slack:U0STRANGER"] }), stranger), true);
    assert.equal(whoMatches(who({ anyone: true }), stranger), true);
  });
});

describe("route shape", () => {
  it("knows only audience rules: no match, no one-value audience, no fallback", () => {
    const target = { agent: "a", environment: "e" };
    assert.equal(RouteSchema.safeParse({ ...target }).success, false);
    assert.equal(
      RouteSchema.safeParse({ ...target, audience: [], match: { kind: "channel" } }).success,
      false,
    );
    assert.equal(
      RouteSchema.safeParse({ ...target, audience: { kind: "conversationParticipants" } }).success,
      false,
    );
    const account = {
      channel: "slack",
      accountId: "work",
      connectionId: "c",
      transport: { mode: "socket" },
      routes: [{ ...target, audience: [{ who: { anyone: true }, where: { dm: true } }] }],
    };
    assert.equal(AccountFileSchema.safeParse(account).success, true);
    assert.equal(
      AccountFileSchema.safeParse({ ...account, fallback: { deny: true } }).success,
      false,
    );
  });
});
