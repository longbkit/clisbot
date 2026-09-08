// The channel-owned `message` tool surface (D-ZU-019).
//
// Upstream's adapter is `zalouserMessageActions` in `channel.adapters.ts`,
// carried unchanged next to this file. It advertises exactly ONE action,
// `react`, because that is the only message mutation the personal-account
// client exposes beyond a plain send: `api.addReaction` with the `msgId` +
// `cliMsgId` pair. There is no edit, delete, pin, poll or read-back endpoint to
// expose — `supportsAction` refuses them, so the Hub answers
// `unsupported_action` rather than a transport error.
//
// The only thing this module adds is the drive-time account carrier: the Hub
// passes the connection's fields on `ctx.account` (the same carrier
// `start-account` reads), and upstream's `handleAction` resolves the account out
// of `cfg` alone. Folding the carrier in here keeps `fusion/account-config.ts`
// the single reader of those field names.

import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
} from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import { zalouserMessageActions } from "./channel.adapters.js";
import { mergeAccountCarrier } from "./fusion/account-config.js";
import type { OpenClawConfig } from "./runtime-api.js";

/** The actions this vertical executes, in the Hub's action vocabulary. */
export const ZALOUSER_MESSAGE_ACTIONS = ["react"] as const;

function isSupported(action: ChannelMessageActionName): boolean {
  return (ZALOUSER_MESSAGE_ACTIONS as readonly string[]).includes(action);
}

function withCarrier<T extends { cfg: unknown; accountId?: string | null }>(ctx: T): T {
  const account = (ctx as { account?: Record<string, unknown> }).account;
  if (account === undefined) return ctx;
  return {
    ...ctx,
    cfg: mergeAccountCarrier(ctx.cfg as OpenClawConfig, ctx.accountId ?? "", account),
  };
}

export const zalouserChannelActions: ChannelMessageActionAdapter = {
  ...zalouserMessageActions,
  describeMessageTool: (ctx) =>
    zalouserMessageActions.describeMessageTool?.(withCarrier(ctx)) ?? null,
  supportsAction: ({ action }) => isSupported(action),
  handleAction: async (ctx) => {
    if (!isSupported(ctx.action)) {
      throw new Error(`Action ${ctx.action} is not supported for provider zalouser.`);
    }
    if (zalouserMessageActions.handleAction === undefined) {
      throw new Error("Zalouser actions are not available.");
    }
    return await zalouserMessageActions.handleAction(withCarrier(ctx));
  },
};
