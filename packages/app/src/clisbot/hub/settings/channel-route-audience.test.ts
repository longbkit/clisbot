import { describe, expect, it } from "vitest";
import {
  audienceRuleErrors,
  audienceRuleFromDraft,
  audienceRuleSentence,
  audienceRuleProblem,
  audienceRulesComplete,
  channelReportsVisibility,
  extraConversations,
  isOpenAudienceDraft,
  newRouteRule,
  routeAudienceDraft,
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
        where: {
          dm: "off",
          dmMembers: [],
          dmTeams: [],
          dmIdentities: "",
          groups: "public",
          conversations: "C_PRIVATE",
        },
      },
      {
        who: { roles: [], teams: [], members: [], anyone: true, identities: "" },
        where: {
          dm: "off",
          dmMembers: [],
          dmTeams: [],
          dmIdentities: "",
          groups: "specific",
          conversations: "12345",
        },
      },
    ]);
  });

  it("gives a Route without audience rules no rules", () => {
    expect(routeAudienceDraft({ agent: "worker" })).toEqual({ rules: [], contains: "" });
  });
});

describe("audience rule drafts", () => {
  it("splits typed ids and requires a Who and a Where", () => {
    const rule = newRouteRule();
    rule.where = {
      dm: "all",
      dmMembers: [],
      dmTeams: [],
      dmIdentities: "",
      groups: "all",
      conversations: "",
    };
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
      where: {
        dm: true,
        dmMembers: [],
        dmTeams: [],
        dmIdentities: [],
        groups: "all",
        conversations: ["C1", "C2"],
      },
    });
    expect(audienceRulesComplete([rule])).toBe(true);
    expect(audienceRulesComplete([])).toBe(false);
    const nobody = { ...newRouteRule(), where: rule.where };
    nobody.who.roles = [];
    expect(audienceRulesComplete([nobody])).toBe(false);
    expect(audienceRulesComplete([newRouteRule()])).toBe(false);
  });
});

describe("where", () => {
  it("starts a new Route with every place off, so it cannot save until one is opened", () => {
    const rule = newRouteRule();
    expect(rule.where).toEqual({
      dm: "off",
      dmMembers: [],
      dmTeams: [],
      dmIdentities: "",
      groups: "off",
      conversations: "",
    });
    expect(audienceRulesComplete([rule])).toBe(false);
  });

  it("saves one exclusive choice per place, and named DMs only while Specific is chosen", () => {
    const rule = newRouteRule();
    rule.where = {
      dm: "specific",
      dmMembers: ["m-aitran"],
      dmTeams: [],
      dmIdentities: "",
      groups: "specific",
      conversations: "C_HELP",
    };
    expect(audienceRuleFromDraft(rule).where).toEqual({
      dm: false,
      dmMembers: ["m-aitran"],
      dmTeams: [],
      dmIdentities: [],
      groups: "off",
      conversations: ["C_HELP"],
    });
    expect(audienceRuleSentence(rule, names)).toBe(
      "Members may talk in DMs (only aitran) and #help",
    );
    // Specific with nobody named opens nothing.
    rule.where = {
      dm: "specific",
      dmMembers: [],
      dmTeams: [],
      dmIdentities: "",
      groups: "off",
      conversations: "",
    };
    expect(audienceRulesComplete([rule])).toBe(false);
    // All DMs drops the named list; group chats off drops the conversations.
    rule.where = {
      dm: "all",
      dmMembers: ["m-aitran"],
      dmTeams: [],
      dmIdentities: "",
      groups: "off",
      conversations: "C_HELP",
    };
    expect(audienceRuleFromDraft(rule).where).toEqual({
      dm: true,
      dmMembers: [],
      dmTeams: [],
      dmIdentities: [],
      groups: "off",
      conversations: [],
    });
  });

  it("refuses a place that is on but names nothing, even when the other place carries the rule", () => {
    const rule = newRouteRule();
    rule.where = {
      dm: "specific",
      dmMembers: [],
      dmTeams: [],
      dmIdentities: "",
      groups: "all",
      conversations: "",
    };
    expect(audienceRuleProblem(rule)).toBe("Pick who may DM, or choose All direct messages.");
    rule.where = {
      dm: "all",
      dmMembers: [],
      dmTeams: [],
      dmIdentities: "",
      groups: "specific",
      conversations: " ",
    };
    expect(audienceRuleProblem(rule)).toBe("Name a conversation, or choose All group chats.");
    expect(audienceRulesComplete([rule])).toBe(false);
    rule.where = {
      dm: "all",
      dmMembers: [],
      dmTeams: [],
      dmIdentities: "",
      groups: "specific",
      conversations: "C_HELP",
    };
    expect(audienceRuleProblem(rule)).toBeNull();
  });

  it("narrows DMs to Members and Guests the Who can hold, and refuses a list it cannot reach", () => {
    const rule = newRouteRule();
    const guestsOnly = { roles: [], teams: [], members: [], anyone: false, identities: "U0GUEST" };
    const dms = { dm: "specific" as const, groups: "off" as const, conversations: "" };
    rule.who = guestsOnly;
    rule.where = { ...dms, dmMembers: ["m-aitran"], dmTeams: [], dmIdentities: "" };
    expect(audienceRuleProblem(rule)).toMatch(/^Who names no Member/);
    rule.where = { ...dms, dmMembers: [], dmTeams: [], dmIdentities: "U0GUEST" };
    expect(audienceRuleProblem(rule)).toBeNull();
    expect(audienceRuleFromDraft(rule).where).toEqual({
      dm: false,
      dmMembers: [],
      dmTeams: [],
      dmIdentities: ["U0GUEST"],
      groups: "off",
      conversations: [],
    });
    expect(audienceRuleSentence(rule, names)).toBe(
      "Guest U0GUEST may talk in DMs (only Guest U0GUEST)",
    );
    // Members under Who cannot be narrowed to a Guest.
    rule.who = newRouteRule().who;
    expect(audienceRuleProblem(rule)).toMatch(/^Who names no Guest/);
    // Anyone holds both kinds.
    rule.who = { ...guestsOnly, identities: "", anyone: true };
    rule.where = { ...dms, dmMembers: ["m-aitran"], dmTeams: [], dmIdentities: "U0GUEST" };
    expect(audienceRuleProblem(rule)).toBeNull();
  });

  it("narrows DMs by Team as well as by Member, and says both in the sentence", () => {
    const rule = newRouteRule();
    rule.where = {
      ...rule.where,
      dm: "specific",
      dmTeams: ["team-qc"],
      dmMembers: ["m-aitran"],
    };
    expect(audienceRuleProblem(rule)).toBeNull();
    expect(audienceRuleFromDraft(rule).where).toMatchObject({
      dm: false,
      dmTeams: ["team-qc"],
      dmMembers: ["m-aitran"],
    });
    expect(audienceRuleSentence(rule, names)).toBe(
      "Members may talk in DMs (only Team QC and aitran)",
    );
    // A Team alone is enough to name someone.
    rule.where.dmMembers = [];
    expect(audienceRuleProblem(rule)).toBeNull();
  });

  it("calls a rule open only when Anyone gets in somewhere un-narrowed", () => {
    const rule = newRouteRule();
    rule.who = { roles: [], teams: [], members: [], anyone: true, identities: "" };
    rule.where = { ...rule.where, dm: "specific", dmTeams: ["team-qc"] };
    expect(isOpenAudienceDraft([rule])).toBe(false);
    rule.where.dm = "all";
    expect(isOpenAudienceDraft([rule])).toBe(true);
  });

  it("keeps the named conversations while Group chats is switched off, and sends none", () => {
    const rule = newRouteRule();
    rule.where = {
      dm: "all",
      dmMembers: [],
      dmTeams: [],
      dmIdentities: "",
      groups: "off",
      conversations: "C_HELP",
    };
    expect(audienceRuleFromDraft(rule).where.conversations).toEqual([]);
    // Switching back on lands at Specific with the list the form still holds.
    rule.where.groups = "specific";
    expect(audienceRuleFromDraft(rule).where.conversations).toEqual(["C_HELP"]);
  });

  it("round-trips a stored rule, including conversations an earlier editor kept beside a filter", () => {
    const stored = {
      who: { teams: ["team-qc"] },
      where: {
        dmMembers: ["m-aitran"],
        dmTeams: [],
        dmIdentities: "",
        groups: "public",
        conversations: ["C_PRIVATE"],
      },
    };
    const [rule] = routeAudienceDraft({ audience: [stored] }).rules;
    expect(rule!.where).toEqual({
      dm: "specific",
      dmMembers: ["m-aitran"],
      dmTeams: [],
      dmIdentities: "",
      groups: "public",
      conversations: "C_PRIVATE",
    });
    expect(extraConversations(rule!.where)).toEqual(["C_PRIVATE"]);
    expect(audienceRuleFromDraft(rule!).where).toEqual({
      dm: false,
      dmMembers: ["m-aitran"],
      dmTeams: [],
      dmIdentities: [],
      groups: "public",
      conversations: ["C_PRIVATE"],
    });
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
        where: {
          dm: "all" as const,
          dmMembers: [],
          dmTeams: [],
          dmIdentities: "",
          groups: "all" as const,
          conversations: "",
        },
      },
      {
        id: "r2",
        who: { roles: [], teams: ["team-qc"], members: [], anyone: false, identities: "" },
        where: {
          dm: "off" as const,
          dmMembers: [],
          dmTeams: [],
          dmIdentities: "",
          groups: "public" as const,
          conversations: "C_PRIVATE",
        },
      },
      {
        id: "r3",
        who: { roles: [], teams: [], members: ["m-aitran"], anyone: false, identities: "" },
        where: {
          dm: "all" as const,
          dmMembers: [],
          dmTeams: [],
          dmIdentities: "",
          groups: "off" as const,
          conversations: "",
        },
      },
      {
        id: "r4",
        who: { roles: [], teams: [], members: [], anyone: true, identities: "" },
        where: {
          dm: "off" as const,
          dmMembers: [],
          dmTeams: [],
          dmIdentities: "",
          groups: "specific" as const,
          conversations: "C_HELP",
        },
      },
    ];
    expect(audienceRuleSentence(rules[1]!, names)).toBe(
      "Team QC may talk in every public group chat and 🔒 #qc-private",
    );
    expect(audienceRuleSentence(rules[3]!, names)).toBe("Anyone may talk in #help");
    // Anyone covers every sender, so a rule saved as Anyone names nobody else.
    expect(
      audienceRuleFromDraft({ ...rules[3]!, who: { ...rules[0]!.who, anyone: true } }).who,
    ).toEqual({ roles: [], teams: [], members: [], anyone: true, identities: [] });
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
    const where = {
      dm: "off" as const,
      dmMembers: [],
      dmTeams: [],
      dmIdentities: "",
      groups: "public" as const,
      conversations: "",
    };
    expect(visibilityFilterMatchesNothing(where, false)).toBe(true);
    expect(visibilityFilterMatchesNothing(where, true)).toBe(false);
    expect(visibilityFilterMatchesNothing({ ...where, groups: "all" }, false)).toBe(false);
  });
});
