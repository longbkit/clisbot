// A Route's Rules as the editor holds them (docs/audits/2026-10-05-routes-and-rules.md).
import { describe, expect, it } from "vitest";
import {
  audienceRuleErrors,
  audienceRuleFromDraft,
  audienceRuleProblem,
  audienceRulesComplete,
  channelReportsVisibility,
  extraConversations,
  isOpenAudienceDraft,
  newAudienceRule,
  routeAudienceDraft,
  visibilityFilterMatchesNothing,
  whoChoiceOf,
  whoForChoice,
  withPlace,
  type AudienceRuleDraft,
  type InheritedConditions,
} from "./channel-route-audience";
import { ruleSummary, type AudienceNames } from "./channel-route-rule-summary";

const names: AudienceNames = {
  teamName: (id) => ({ "team-qc": "QC" })[id] ?? id,
  memberName: (id) => ({ "m-aitran": "aitran" })[id] ?? id,
  conversationLabel: (id) => ({ C_PRIVATE: "🔒 #qc-private", C_HELP: "#help" })[id] ?? id,
};

const INHERITED: InheritedConditions = {
  requireMention: true,
  followUpMode: "mention-only",
  ttlMinutes: 5,
};

/** The only Rule a stored Route with this one rule opens with. */
function only(rule: Record<string, unknown>): AudienceRuleDraft {
  const rules = routeAudienceDraft({ audience: [rule] });
  expect(rules).toHaveLength(1);
  return rules[0]!;
}

/** The Rule with one change, as the editor makes it. */
function edited(rule: AudienceRuleDraft, change: Partial<AudienceRuleDraft>): AudienceRuleDraft {
  return { ...rule, ...change, edited: true };
}

describe("reading stored Rules", () => {
  it("reads where, who and the Rule's own conditions", () => {
    const rule = only({
      who: { teams: ["team-qc"] },
      where: { conversations: ["C_HELP"] },
      interaction: { requireMention: true, followUp: { mode: "auto", ttlMinutes: 10 } },
      contains: "#triage",
    });
    expect(rule.place).toBe("groups");
    expect(rule.where.groups).toBe("specific");
    expect(rule.conditions).toEqual({
      requireMention: true,
      followUpMode: "auto",
      ttlMinutes: "10",
      contains: "#triage",
    });
    expect(rule.edited).toBe(false);
  });

  it("writes an untouched Rule back exactly as stored, keys it does not show included", () => {
    const stored = {
      who: { roles: ["member"], identities: [] },
      where: { dm: true },
      interaction: { requireMention: false, futureLeaf: 1 },
      futureKey: "kept",
    };
    expect(audienceRuleFromDraft(only(stored))).toBe(stored);
  });

  it("opens a Rule over DMs and group chats as two Rules with the same people and conditions", () => {
    const rules = routeAudienceDraft({
      audience: [
        {
          who: { roles: ["member"] },
          where: { dm: true, groups: "all" },
          interaction: { requireMention: true },
        },
      ],
    });
    expect(rules.map(({ place }) => place)).toEqual(["dm", "groups"]);
    const [dm, groups] = rules.map(audienceRuleFromDraft);
    expect(dm).toMatchObject({
      where: { dm: true, groups: "off" },
      interaction: { requireMention: true },
    });
    expect(groups).toMatchObject({
      where: { dm: false, groups: "all" },
      who: { roles: ["member"] },
    });
    // Split, they are written as two: the meaning is the same, a sender gets in through either.
    expect(rules.every((rule) => rule.edited)).toBe(true);
  });

  it("keeps an older Rule that narrowed DMs, and names only the people it let in", () => {
    const stored = { who: { roles: ["member"] }, where: { dmMembers: ["m-aitran"] } };
    const rule = only(stored);
    expect(rule.place).toBe("dm");
    expect(rule.where.dm).toBe("specific");
    expect(whoChoiceOf(rule)).toBe("pick");
    expect(ruleSummary(rule, names, INHERITED)).toBe("DMs · aitran · when mentioned");
    expect(audienceRuleFromDraft(rule)).toBe(stored);
  });

  it("gives a Route without Rules no Rules", () => {
    expect(routeAudienceDraft({ agent: "worker" })).toEqual([]);
  });
});

describe("new Rules", () => {
  it("starts in DMs with the Hub's owners, answered without a mention", () => {
    const rule = newAudienceRule();
    expect(whoChoiceOf(rule)).toBe("owners");
    expect(audienceRuleFromDraft(rule)).toEqual({
      who: { roles: ["owner"], teams: [], members: [], anyone: false, identities: [] },
      where: {
        dm: true,
        dmMembers: [],
        dmTeams: [],
        dmIdentities: [],
        groups: "off",
        conversations: [],
      },
      interaction: { requireMention: false },
    });
    expect(audienceRulesComplete([rule], INHERITED)).toBe(true);
    expect(newAudienceRule().id).not.toBe(rule.id);
  });

  it("needs a mention in group chats, and keeps its text filter when it moves", () => {
    const filtered = {
      ...newAudienceRule(),
      conditions: { requireMention: false, contains: "#help" },
    };
    const groups = withPlace(filtered, "groups");
    expect(groups.conditions).toEqual({
      requireMention: true,
      followUpMode: "mention-only",
      contains: "#help",
    });
    expect(groups.where).toMatchObject({ dm: "off", groups: "specific" });
    // No chat named yet: it cannot save until one is picked.
    expect(audienceRuleProblem(groups, INHERITED)).toBe(
      "Pick a chat, or choose Every chat the bot is in.",
    );
    expect(withPlace(groups, "dm").conditions.requireMention).toBe(false);
  });
});

describe("who", () => {
  const rule = (who: Partial<AudienceRuleDraft["who"]>) => ({
    who: { roles: [], teams: [], members: [], anyone: false, identities: "", ...who },
    picking: false,
  });

  it("reads nested roles as one choice from narrow to wide", () => {
    expect(whoChoiceOf(rule({ roles: ["owner"] }))).toBe("owners");
    // `admin` already includes Owners.
    expect(whoChoiceOf(rule({ roles: ["owner", "admin"] }))).toBe("admins");
    expect(whoChoiceOf(rule({ roles: ["member"] }))).toBe("everyone");
    expect(whoChoiceOf(rule({ roles: ["member"], identities: "U1" }))).toBe("pick");
    expect(whoChoiceOf(rule({ teams: ["team-qc"] }))).toBe("pick");
    expect(whoChoiceOf(rule({ anyone: true }))).toBe("anyone");
    expect(whoChoiceOf({ ...rule({ roles: ["owner"] }), picking: true })).toBe("pick");
    expect(whoForChoice("admins").roles).toEqual(["admin"]);
    expect(whoForChoice("everyone").roles).toEqual(["member"]);
  });

  it("saves Anyone with nobody else named", () => {
    const anyone = edited(newAudienceRule(), {
      who: { roles: ["owner"], teams: ["team-qc"], members: [], anyone: true, identities: "U1" },
    });
    expect(audienceRuleFromDraft(anyone).who).toEqual({
      roles: [],
      teams: [],
      members: [],
      anyone: true,
      identities: [],
    });
    expect(isOpenAudienceDraft([anyone])).toBe(true);
  });
});

describe("saving an edited Rule", () => {
  it("replaces only the leaves the editor owns and keeps every other key", () => {
    const rule = edited(
      only({
        who: { roles: ["member"] },
        where: { conversations: ["C_HELP"] },
        interaction: { requireMention: true, futureLeaf: 1 },
        contains: "old",
        futureKey: "kept",
      }),
      { conditions: { requireMention: false, contains: "  #help  " } },
    );
    expect(audienceRuleFromDraft(rule)).toMatchObject({
      futureKey: "kept",
      interaction: { requireMention: false, futureLeaf: 1 },
      contains: "#help",
    });
  });

  it("writes nothing for a condition left to inherit, and drops a cleared text filter", () => {
    const rule = edited(only({ who: { roles: ["member"] }, where: { dm: true }, contains: "x" }), {
      conditions: {},
    });
    const saved = audienceRuleFromDraft(rule) as Record<string, unknown>;
    expect(saved["interaction"]).toBeUndefined();
    expect(saved["contains"]).toBeUndefined();
  });

  it("keeps a Rule's limits as stored until edited, then writes only the Rule's own leaves", () => {
    const stored = {
      who: { roles: ["member"] },
      where: { conversations: ["C1"] },
      limits: { maxConcurrentRuns: 2, maxInputCharacters: "off" },
    };
    const [rule] = routeAudienceDraft({ audience: [stored] });
    expect(audienceRuleFromDraft(rule!)).toBe(stored);
    const changed = edited(rule!, {
      limits: { ...rule!.limits, messagesPerMinute: { mode: "custom", value: "9" } },
    });
    expect(audienceRuleFromDraft(changed).limits).toEqual({
      maxInputCharacters: "off",
      messagesPerMinute: 9,
      maxConcurrentRuns: 2,
    });
    const cleared = edited(rule!, {
      limits: {
        ...rule!.limits,
        maxConcurrentRuns: { mode: "default", value: "" },
        maxInputCharacters: { mode: "default", value: "" },
      },
    });
    expect(audienceRuleFromDraft(cleared)).not.toHaveProperty("limits");
    const bad = edited(rule!, {
      limits: { ...rule!.limits, maxRuntimeSeconds: { mode: "custom", value: "0" } },
    });
    expect(audienceRuleProblem(bad, INHERITED)).toMatch(/Run time/);
  });

  it("writes the follow-up window only as a whole number of minutes", () => {
    const groups = withPlace(newAudienceRule(), "groups");
    const rule = edited(groups, {
      where: { ...groups.where, conversations: "C_HELP" },
      conditions: { requireMention: true, followUpMode: "auto", ttlMinutes: "15" },
    });
    expect(audienceRuleFromDraft(rule).interaction).toEqual({
      requireMention: true,
      followUp: { mode: "auto", ttlMinutes: 15 },
    });
    const fraction = { ...rule, conditions: { ...rule.conditions, ttlMinutes: "1.5" } };
    expect(audienceRuleProblem(fraction, INHERITED)).toBe("Use a whole number of minutes.");
  });

  it("checks the minutes where the field shows, even when auto is inherited", () => {
    const groups = withPlace(newAudienceRule(), "groups");
    const base = edited(groups, { where: { ...groups.where, conversations: "C_HELP" } });
    const inheritedAuto = { ...INHERITED, followUpMode: "auto" as const };
    // The rule sets no mode; the account's auto shows the minutes field.
    const typed = { ...base, conditions: { requireMention: true, ttlMinutes: "0" } };
    expect(audienceRuleProblem(typed, inheritedAuto)).toBe("Use a whole number of minutes.");
    // A field that is hidden (no mention required) never blocks the save.
    const hidden = {
      ...base,
      conditions: { requireMention: false, followUpMode: "auto" as const, ttlMinutes: "x" },
    };
    expect(audienceRuleProblem(hidden, INHERITED)).toBeNull();
  });
});

describe("checks", () => {
  it("needs someone, a chat for a group Rule, and text for a text filter", () => {
    const nobody = edited(newAudienceRule(), {
      who: { roles: [], teams: [], members: [], anyone: false, identities: "" },
      picking: true,
    });
    expect(audienceRuleProblem(nobody, INHERITED)).toBe("Pick at least one person.");
    const emptyFilter = edited(newAudienceRule(), { conditions: { contains: " " } });
    expect(audienceRuleProblem(emptyFilter, INHERITED)).toBe(
      "Type the text a message must contain.",
    );
    expect(audienceRulesComplete([], INHERITED)).toBe(false);
  });
});

describe("summaries", () => {
  it("reads each Rule as place · people · conditions", () => {
    expect(ruleSummary(newAudienceRule(), names, INHERITED)).toBe("DMs · Only owners");
    const support = only({
      who: { teams: ["team-qc"] },
      where: { conversations: ["C_PRIVATE", "C_HELP"] },
      interaction: { followUp: { mode: "auto", ttlMinutes: 10 } },
      contains: "#help",
    });
    // It inherits the mention requirement, and sets its own window.
    expect(ruleSummary(support, names, INHERITED)).toBe(
      "🔒 #qc-private, #help · Team QC · when mentioned, then for 10 min · “#help”",
    );
    const anyone = only({ who: { anyone: true }, where: { groups: "all" } });
    expect(ruleSummary(anyone, names, INHERITED)).toBe(
      "Every chat the bot is in · Anyone in the chat · when mentioned",
    );
  });
});

describe("conversations kept beside a filter", () => {
  it("still counts the conversations an earlier editor kept beside a filter", () => {
    const rule = only({
      who: { roles: ["member"] },
      where: { groups: "public", conversations: ["C_PRIVATE"] },
    });
    expect(extraConversations(rule.where)).toEqual(["C_PRIVATE"]);
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
    const { where } = only({ who: { roles: ["member"] }, where: { groups: "public" } });
    expect(visibilityFilterMatchesNothing(where, false)).toBe(true);
    expect(visibilityFilterMatchesNothing(where, true)).toBe(false);
    expect(visibilityFilterMatchesNothing({ ...where, groups: "all" }, false)).toBe(false);
  });
});
