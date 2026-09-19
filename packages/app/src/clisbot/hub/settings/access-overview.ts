import { z } from "zod";
import {
  audienceWhereLabel,
  routeAudienceDraft,
  type AudienceNames,
} from "./channel-route-audience";

const routeSchema = z.object({
  enabled: z.boolean().optional(),
  workflow: z.string().optional(),
  agent: z.string().optional(),
});
const accountSchema = z.object({
  channel: z.string(),
  accountId: z.string(),
  enabled: z.boolean().optional(),
  routes: z.array(z.unknown()),
});

/** The Access page names places by their ids; Channels resolves them to room names. */
const ID_NAMES: AudienceNames = {
  teamName: (id) => id,
  memberName: (id) => id,
  conversationLabel: (id) => id,
};

/**
 * Routes with a rule whose Who is Anyone, and where those rules apply.
 * Published Route configuration stays authoritative; this is only an Access projection.
 */
export function publicAccessRoutes(accounts: Record<string, unknown>[]) {
  return accounts.flatMap((value) => {
    const account = accountSchema.safeParse(value);
    if (!account.success) return [];
    return account.data.routes.flatMap((routeValue, index) => {
      const route = routeSchema.safeParse(routeValue);
      if (!route.success) return [];
      const rules = routeAudienceDraft(routeValue as Record<string, unknown>).rules;
      const open = rules.filter((rule) => rule.who.anyone);
      if (open.length === 0) return [];
      return [
        {
          key: `${account.data.channel}:${account.data.accountId}:${String(index)}`,
          account: `${account.data.channel} · ${account.data.accountId}`,
          enabled: account.data.enabled !== false && route.data.enabled !== false,
          conversations: open.map((rule) => audienceWhereLabel(rule.where, ID_NAMES)).join("; "),
          target: route.data.workflow ?? route.data.agent ?? "Target unavailable",
        },
      ];
    });
  });
}
