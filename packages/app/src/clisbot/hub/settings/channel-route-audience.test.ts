import { describe, expect, it } from "vitest";
import {
  audienceRuleErrors,
  audienceRuleFromDraft,
  audienceRuleSentence,
  audienceRulesComplete,
  channelReportsVisibility,
  membersEverywhereRule,
  routeAudienceDraft,
  routeAudienceSummary,
  visibilityFilterMatchesNothing,
  type AudienceNames,
} from "./channel-route-audience";

/** Row ids are the editor's; the stored shape has none. */
function withoutIds<T extends { id: string }>(rules: readonly T[]): Omit<T, "id">[] {
  return rules.map(({ id: _id, ...rule }) => rule);
}

const names: AudienceNames = {
  teamName: (id) => ({ "team-qc": "QC" })[id] ?? id,
  memberName: (id) => ({ "m-aitran": "aitran" })[id] ?? id,
  conversationLabel: (id) => ({ C_PRIVATE: "🔒 #qc-private", C_HELP: "#help" })[id] ?? id,
};

describe("routeAudienceDraft", () => {
  it("reads the rules shape and route-level contains", () => {
    const draft = routeAudienceDraft({
      audience: [
        { who: { teams: ["team-qc"] }, where: { groups: "public", conversations: ["C_PRIVATE"] } },
        { who: { anyone: true }, where: { conversations: [12345] } },
      ],
      contains: "#triage",
    });
    expect(draft.contains).toBe("#triage");
    expect(withoutIds(draft.rules)).toEqual([
      {
        who: { roles: [], teams: ["team-qc"], members: [], anyone: false, identities: "" },
        where: { dm: false, groups: "public", conversations: "C_PRIVATE" },
      },
      {
        who: { roles: [], teams: [], members: [], anyone: true, identities: "" },
        where: { dm: false, groups: "off", conversations: "12345" },
      },
    ]);
  });

  it("gives a Route without audience rules no rules", () => {
    expect(routeAudienceDraft({ agent: "worker" })).toEqual({ rules: [], contains: "" });
  });
});

describe("audience rule drafts", () => {
  it("splits typed ids and requires a Who and a Where", () => {
    const rule = membersEverywhereRule();
    rule.who.identities = "U1, slack:U2\nU1";
    rule.where.conversations = "C1,C2";
    expect(audienceRuleFromDraft(rule)).toEqual({
      who: {
        roles: ["member"],
        teams: [],
        members: [],
        anyone: false,
        identities: ["U1", "slack:U2"],
      },
      where: { dm: true, groups: "all", conversations: ["C1", "C2"] },
    });
    expect(audienceRulesComplete([rule])).toBe(true);
    expect(audienceRulesComplete([])).toBe(false);
    const nobody = membersEverywhereRule();
    nobody.who.roles = [];
    expect(audienceRulesComplete([nobody])).toBe(false);
    const nowhere = membersEverywhereRule();
    nowhere.where = { dm: false, groups: "off", conversations: "" };
    expect(audienceRulesComplete([nowhere])).toBe(false);
  });
});

describe("summaries", () => {
  it("reads one rule as a sentence and a Route grouped by place", () => {
    const rules = [
      {
        id: "r1",
        who: {
          roles: ["owner" as const, "admin" as const],
          teams: [],
          members: [],
          anyone: false,
          identities: "",
        },
        where: { dm: true, groups: "all" as const, conversations: "" },
      },
      {
        id: "r2",
        who: { roles: [], teams: ["team-qc"], members: [], anyone: false, identities: "" },
        where: { dm: false, groups: "public" as const, conversations: "C_PRIVATE" },
      },
      {
        id: "r3",
        who: { roles: [], teams: [], members: ["m-aitran"], anyone: false, identities: "" },
        where: { dm: true, groups: "off" as const, conversations: "" },
      },
      {
        id: "r4",
        who: { roles: [], teams: [], members: [], anyone: true, identities: "" },
        where: { dm: false, groups: "off" as const, conversations: "C_HELP" },
      },
    ];
    expect(audienceRuleSentence(rules[1]!, names)).toBe(
      "Team QC may talk in every public group chat and 🔒 #qc-private",
    );
    expect(routeAudienceSummary(rules, names)).toEqual([
      { place: "DM", who: "Owner and Admins · aitran" },
      { place: "Group chat · all", who: "Owner and Admins" },
      { place: "Group chat · public only", who: "Team QC" },
      { place: "🔒 #qc-private", who: "Team QC" },
      { place: "#help", who: "Anyone" },
    ]);
  });
});

describe("audienceRuleErrors", () => {
  it("maps the Hub's dotted paths onto the edited Route's rules", () => {
    const message = [
      "channels/slack/support.yml.routes.0.audience.1.who: an audience rule needs at least one Who part",
      "channels/slack/support.yml.routes.2.audience.0: unrelated route",
      "channels/slack/support.yml.routes.2.audience.3.where: an audience rule needs at least one Where part",
    ].join("\n");
    expect([...audienceRuleErrors(message, 0)]).toEqual([
      [1, "an audience rule needs at least one Who part"],
    ]);
    expect([...audienceRuleErrors(message, 2)]).toEqual([
      [0, "unrelated route"],
      [3, "an audience rule needs at least one Where part"],
    ]);
    expect(audienceRuleErrors("something else", 0).size).toBe(0);
  });
});

describe("room visibility", () => {
  it("follows the channel catalog's visibility capability", () => {
    expect(channelReportsVisibility({ capabilities: ["text", "visibility"] })).toBe(true);
    expect(channelReportsVisibility({ capabilities: ["text"] })).toBe(false);
    expect(channelReportsVisibility(undefined)).toBe(false);
  });

  it("flags a public/private filter where the channel reports no visibility", () => {
    const where = { dm: false, groups: "public" as const, conversations: "" };
    expect(visibilityFilterMatchesNothing(where, false)).toBe(true);
    expect(visibilityFilterMatchesNothing(where, true)).toBe(false);
    expect(visibilityFilterMatchesNothing({ ...where, groups: "all" }, false)).toBe(false);
  });
});
