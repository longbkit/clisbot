// The conditions a message meets on its way into a Route, rule by rule
// (docs/audits/2026-10-05-routes-and-rules.md).
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  compileAudienceRule,
  deriveRouteWhere,
  type AudienceConversation,
} from "./config/audience.js";
import type { CompiledRoute } from "./config/compile.js";
import type { AudienceRule } from "./config/schema.js";
import {
  conversationTrigger,
  loosestTrigger,
  mentionTrigger,
  routeApplies,
  rulesFor,
  senderTrigger,
} from "./rule-trigger.js";

const DM: AudienceConversation = { kind: "dm", id: "D1" };
const SUPPORT: AudienceConversation = { kind: "channel", id: "C_SUPPORT" };
const OTHER: AudienceConversation = { kind: "channel", id: "C_OTHER" };

/** A Route from authored rules, inheriting `requireMention: true` and a 60-minute `auto` follow-up. */
function route(rules: AudienceRule[]): Pick<CompiledRoute, "audienceRules" | "where" | "defaults"> {
  const audienceRules = rules.map(compileAudienceRule);
  return {
    audienceRules,
    where: deriveRouteWhere(audienceRules),
    defaults: {
      requireMention: true,
      followUp: { mode: "auto", ttlMinutes: 60 },
    } as CompiledRoute["defaults"],
  };
}

const OWNERS_IN_DMS: AudienceRule = {
  who: { roles: ["owner"] },
  where: { dm: true },
  interaction: { requireMention: false },
};
const MEMBERS_IN_SUPPORT: AudienceRule = {
  who: { roles: ["member"] },
  where: { conversations: ["C_SUPPORT"] },
};
const ANYONE_WITH_HELP: AudienceRule = {
  who: { anyone: true },
  where: { conversations: ["C_SUPPORT"] },
  interaction: { followUp: { mode: "mention-only" } },
  contains: "#help",
};

describe("rule conditions", () => {
  it("gives each conversation the conditions of the rules that cover it", () => {
    const shared = route([OWNERS_IN_DMS, MEMBERS_IN_SUPPORT]);
    // A DM needs no mention, a channel inherits the Route's floor.
    assert.equal(conversationTrigger(shared, DM).requireMention, false);
    assert.deepEqual(conversationTrigger(shared, SUPPORT), {
      requireMention: true,
      followUp: { mode: "auto", ttlMinutes: 60 },
    });
  });

  it("takes the loosest of several covering rules before the sender is known", () => {
    const both = route([MEMBERS_IN_SUPPORT, ANYONE_WITH_HELP]);
    // Members inherit `auto`, Anyone is `mention-only`: a message that either lets in gets in.
    assert.deepEqual(conversationTrigger(both, SUPPORT).followUp, { mode: "auto", ttlMinutes: 60 });
    assert.equal(loosestTrigger([]), undefined);
  });

  it("narrows to the rules that admitted the sender", () => {
    const both = route([MEMBERS_IN_SUPPORT, ANYONE_WITH_HELP]);
    const anyone = [both.audienceRules[1]!];
    // A sender only the Anyone rule admits meets its `mention-only`.
    assert.equal(senderTrigger(both, SUPPORT, anyone).followUp.mode, "mention-only");
    // Admitted outside the rules (a role assignment): the conversation's conditions.
    assert.equal(senderTrigger(both, SUPPORT, undefined).followUp.mode, "auto");
  });

  it("applies a rule's contains only to a conversation the Route does not hold yet", () => {
    const filtered = route([ANYONE_WITH_HELP]);
    assert.equal(routeApplies(filtered, SUPPORT, "can someone look"), false);
    assert.equal(routeApplies(filtered, SUPPORT, "#help the build"), true);
    // A bound conversation is past the filter.
    assert.equal(rulesFor(filtered, SUPPORT).length, 1);
    assert.equal(rulesFor(filtered, SUPPORT, { text: "no tag" }).length, 0);
  });

  it("lets a Route take any text when one covering rule has no contains", () => {
    const mixed = route([MEMBERS_IN_SUPPORT, ANYONE_WITH_HELP]);
    assert.equal(routeApplies(mixed, SUPPORT, "no tag"), true);
    assert.equal(routeApplies(mixed, OTHER, "#help"), false, "no rule covers the conversation");
  });

  it("reads the rules that need a mention for pauses and /followup", () => {
    const noMention: AudienceRule = {
      who: { roles: ["owner"] },
      where: { conversations: ["C_SUPPORT"] },
      interaction: { requireMention: false },
    };
    const mixed = route([noMention, MEMBERS_IN_SUPPORT]);
    // Before the sender is known nothing needs a mention here, but Members do.
    assert.equal(conversationTrigger(mixed, SUPPORT).requireMention, false);
    assert.deepEqual(mentionTrigger(mixed, SUPPORT), {
      requireMention: true,
      followUp: { mode: "auto", ttlMinutes: 60 },
    });
    // Where no rule needs one, it is the conversation's.
    assert.equal(mentionTrigger(route([OWNERS_IN_DMS]), DM).requireMention, false);
  });

  it("falls back to the inherited conditions where no rule covers the conversation any more", () => {
    assert.equal(conversationTrigger(route([OWNERS_IN_DMS]), OTHER).requireMention, true);
  });
});
