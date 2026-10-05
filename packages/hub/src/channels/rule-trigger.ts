// When a message reaches a Route: the trigger conditions of its Rules
// (docs/audits/2026-10-05-routes-and-rules.md). A Route is where messages go;
// each Rule is one way in, with its own Where, Who and conditions (a mention,
// how an unmentioned follow-up continues, the text a new conversation must
// contain). A condition a Rule does not author is inherited from the
// `defaults:` layers (`route.defaults`, folded organization < account); the
// Route itself carries none.
//
// One definition for every gate: route selection, the mention gate, the
// follow-up window, `/followup`, the configuration warnings. Pure, no IO.

import {
  whereCovers,
  type AudienceConversation,
  type CompiledAudienceRule,
} from "./config/audience.js";
import type { CompiledRoute } from "./config/compile.js";
import type { FollowUpMode } from "./config/enums.js";

/** The conditions a message meets on its way into a Route. */
export interface Trigger {
  requireMention: boolean;
  followUp: { mode: FollowUpMode; ttlMinutes: number };
}

type RouteConditions = Pick<CompiledRoute, "audienceRules" | "defaults">;

/** One rule's conditions, its own leaves over the Route's. */
export function ruleTrigger(
  route: Pick<CompiledRoute, "defaults">,
  rule: CompiledAudienceRule,
): Trigger {
  const own = rule.trigger;
  return {
    requireMention: own?.requireMention ?? route.defaults.requireMention,
    followUp: {
      mode: own?.followUp?.mode ?? route.defaults.followUp.mode,
      ttlMinutes: own?.followUp?.ttlMinutes ?? route.defaults.followUp.ttlMinutes,
    },
  };
}

/**
 * The rules a message in this conversation can come in through. `text` is
 * given while a NEW conversation is being routed: a rule's `contains` then
 * applies. A conversation already bound to the Route is past that check, as
 * a conversation already owned by a binding always was.
 */
export function rulesFor(
  route: Pick<CompiledRoute, "audienceRules">,
  conversation: AudienceConversation,
  text?: { text: string | undefined },
): CompiledAudienceRule[] {
  return route.audienceRules.filter((rule) => {
    if (!whereCovers(rule.where, conversation)) return false;
    if (text === undefined) return true;
    const contains = rule.trigger?.contains;
    return contains === undefined || (text.text !== undefined && text.text.includes(contains));
  });
}

/**
 * The loosest of several rules' conditions: a message any one of them lets in
 * gets in. No mention is needed when some rule needs none; an unmentioned
 * follow-up continues when some rule continues it, for the longest window.
 */
export function loosestTrigger(triggers: readonly Trigger[]): Trigger | undefined {
  if (triggers.length === 0) return undefined;
  const auto = triggers.filter(({ followUp }) => followUp.mode === "auto");
  return {
    requireMention: triggers.every(({ requireMention }) => requireMention),
    followUp:
      auto.length > 0
        ? { mode: "auto", ttlMinutes: Math.max(...auto.map(({ followUp }) => followUp.ttlMinutes)) }
        : {
            mode: "mention-only",
            ttlMinutes: Math.max(...triggers.map(({ followUp }) => followUp.ttlMinutes)),
          },
  };
}

/**
 * The conditions a message meets in this conversation before the sender is
 * known: the loosest of the rules that cover it. When those rules agree (every
 * Route migrated from Route-level conditions) this is exactly what the Route
 * used to apply. A conversation no rule covers any more (a binding
 * recorded before the Route's Where changed) meets the inherited conditions.
 */
export function conversationTrigger(
  route: RouteConditions,
  conversation: AudienceConversation,
  text?: { text: string | undefined },
): Trigger {
  const rules = rulesFor(route, conversation, text);
  return loosestTrigger(rules.map((rule) => ruleTrigger(route, rule))) ?? routeTrigger(route);
}

/**
 * The conditions where a mention matters: the loosest of the covering rules
 * that require one. A follow-up pause and `/followup` act on exactly those
 * rules' senders, so they read this, not the conversation's loosest; where no
 * covering rule requires a mention it is the conversation's (no mention needed).
 */
export function mentionTrigger(
  route: RouteConditions,
  conversation: AudienceConversation,
  text?: { text: string | undefined },
): Trigger {
  const needing = rulesFor(route, conversation, text)
    .map((rule) => ruleTrigger(route, rule))
    .filter(({ requireMention }) => requireMention);
  return loosestTrigger(needing) ?? conversationTrigger(route, conversation, text);
}

/**
 * The conditions for this sender: the loosest of the covering rules that
 * admitted them. `admitting` undefined = admitted outside the rules (a role
 * assignment, the legacy `access:` block), which meets the conversation's.
 */
export function senderTrigger(
  route: RouteConditions,
  conversation: AudienceConversation,
  admitting: readonly CompiledAudienceRule[] | undefined,
  text?: { text: string | undefined },
): Trigger {
  if (admitting === undefined) return conversationTrigger(route, conversation, text);
  const covering = new Set(rulesFor(route, conversation, text));
  const own = admitting.filter((rule) => covering.has(rule));
  return (
    loosestTrigger(own.map((rule) => ruleTrigger(route, rule))) ??
    conversationTrigger(route, conversation, text)
  );
}

/**
 * Does the Route take a NEW conversation here with this text? Its Where (the
 * union of its rules') covers the conversation, and one of the rules covering
 * it lets the text in. Rules never narrow below the Route's Where, so a Route
 * whose covering rules author no `contains` takes every message.
 */
export function routeApplies(
  route: Pick<CompiledRoute, "audienceRules" | "where">,
  conversation: AudienceConversation,
  text: string | undefined,
): boolean {
  if (!whereCovers(route.where, conversation)) return false;
  const covering = rulesFor(route, conversation);
  return covering.length === 0 || rulesFor(route, conversation, { text }).length > 0;
}

/** The inherited conditions (account < organization), as a rule with none of its own meets them. */
export function routeTrigger(route: Pick<CompiledRoute, "defaults">): Trigger {
  return { requireMention: route.defaults.requireMention, followUp: route.defaults.followUp };
}

/** Two triggers decide every message alike. */
export function sameTrigger(left: Trigger, right: Trigger): boolean {
  return (
    left.requireMention === right.requireMention &&
    left.followUp.mode === right.followUp.mode &&
    left.followUp.ttlMinutes === right.followUp.ttlMinutes
  );
}
