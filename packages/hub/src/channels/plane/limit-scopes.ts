// The three scopes a Channel limit is counted in, shared by the inbound
// execution limiter and the outbound pacer so both count the same thing.
// docs/audits/2026-09-18-channel-chat-authority-and-limits.md#limits

import { routeFingerprint } from "../bindings/index.js";
import type { CompiledChannelAccount, CompiledRoute } from "../config/compile.js";
import { routeLimits, type ResolvedLimits } from "../config/limits.js";

export const RATE_WINDOW_MS = 60_000;

export type LimitScopeLabel = "Bot" | "Conversation" | "Route";

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
}): LimitScope[] {
  const { account, route, conversationId } = target;
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
  return scopes;
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
