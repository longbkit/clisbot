import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  compileAudienceRule,
  deriveRouteWhere,
  isOpenAudience,
  needsSenderFacts,
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
    assert.equal(needsSenderFacts(rules), true);
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
