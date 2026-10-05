// The scopes a Channel limit is counted in, shared by the inbound execution
// limiter and the outbound pacer so both count the same thing. A message
// counts in the Rule that let its sender in as well; outbound posts belong to
// no sender, so they count in the other three.
// docs/audits/2026-09-18-channel-chat-authority-and-limits.md#limits

import { routeFingerprint } from "../bindings/index.js";
import type { CompiledChannelAccount, CompiledRoute } from "../config/compile.js";
import {
  whereCovers,
  type AudienceConversation,
  type CompiledAudienceRule,
} from "../config/audience.js";
import { routeLimits, ruleLimits, type ResolvedLimits } from "../config/limits.js";

export const RATE_WINDOW_MS = 60_000;

export type LimitScopeLabel = "Bot" | "Conversation" | "Route" | "Rule";

export interface LimitScope {
  label: LimitScopeLabel;
  key: string;
  limits: ResolvedLimits;
}

/** The scopes a message in this conversation is counted in, widest first. */
export function limitScopes(target: {
  account: CompiledChannelAccount;
  route: CompiledRoute | undefined;
  /** The root conversation: every thread of a channel counts toward it. */
  conversationId: string;
  /** The rule that let the sender in (`limitRule`); absent for outbound posts. */
  rule?: CompiledAudienceRule | undefined;
}): LimitScope[] {
  const { account, route, conversationId, rule } = target;
  const bot = [account.channel, account.accountId];
  const scopes: LimitScope[] = [];
  if (account.limits?.bot !== undefined) {
    scopes.push({ label: "Bot", key: JSON.stringify(["bot", ...bot]), limits: account.limits.bot });
  }
  if (account.limits?.perConversation !== undefined) {
    scopes.push({
      label: "Conversation",
      key: JSON.stringify(["conversation", ...bot, conversationId]),
      limits: account.limits.perConversation,
    });
  }
  // The open-audience defaults are applied HERE, not compiled into the Route:
  // a default in the compiled block would rewrite its `routeFingerprint`.
  const limits = route === undefined ? undefined : routeLimits(route);
  if (route !== undefined && limits !== undefined) {
    scopes.push({ label: "Route", key: routeScopeKey(account, route), limits });
  }
  const own = route === undefined || rule === undefined ? undefined : ruleLimits(route, rule);
  if (route !== undefined && rule !== undefined && own !== undefined) {
    const key = JSON.stringify([
      "rule",
      routeScopeKey(account, route),
      route.audienceRules.indexOf(rule),
    ]);
    scopes.push({ label: "Rule", key, limits: own });
  }
  return scopes;
}

/**
 * The rule a sender's messages count against, among the covering rules that
 * let them in: one that names them before one that lets anyone in, so a Member
 * is never counted with strangers. `admitting` undefined = let in outside the
 * rules (a role assignment, the legacy `access:` block): they count with the
 * strangers where a covering rule lets anyone in, and in no rule otherwise.
 */
export function limitRule(
  route: Pick<CompiledRoute, "audienceRules">,
  conversation: AudienceConversation,
  admitting: readonly CompiledAudienceRule[] | undefined,
): CompiledAudienceRule | undefined {
  const covering = route.audienceRules.filter((rule) => whereCovers(rule.where, conversation));
  const candidates =
    admitting === undefined ? covering : covering.filter((rule) => admitting.includes(rule));
  if (admitting !== undefined) {
    const named = candidates.find((rule) => !rule.who.anyone);
    if (named !== undefined) return named;
  }
  return candidates.find((rule) => rule.who.anyone);
}

function routeScopeKey(account: CompiledChannelAccount, route: CompiledRoute): string {
  return JSON.stringify([
    "route",
    account.channel,
    account.accountId,
    // -1 for a Workflow run's recorded Route that is no longer in the account;
    // the fingerprint keeps its scope apart.
    account.routes.indexOf(route),
    routeFingerprint(route),
  ]);
}

/** Timestamps inside the rate window that ends at `now`. */
export function inWindow(times: readonly number[] | undefined, now: number): number[] {
  return (times ?? []).filter((time) => time > now - RATE_WINDOW_MS);
}
