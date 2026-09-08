// The channel-owned `message` tool surface (D-ZL-017).
//
// Upstream's `actions.ts` is the adapter itself and is carried unchanged next to
// this file. It advertises exactly ONE action, `send`, because that is the whole
// Zalo Bot API surface for messages: `sendMessage` (text) and `sendPhoto` (an
// image by URL). There is no edit, delete, reaction, pin, read-back, emoji or
// poll endpoint to expose — `supportsAction` refuses them, so the Hub answers
// `unsupported_action` rather than a transport error.
//
// The only thing this module adds is the drive-time account carrier: the Hub
// passes the connection's credential on `ctx.account` (the same carrier
// `start-account` reads), and upstream's `handleAction` resolves the account out
// of `cfg` alone. Folding the carrier in here keeps
// `fusion/account-config.ts` the single reader of those field names.

import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
} from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { zaloMessageActions } from "./actions.js";
import { mergeAccountCarrier } from "./fusion/account-config.js";

/** The actions this vertical executes, in the Hub's action vocabulary. */
export const ZALO_MESSAGE_ACTIONS = ["send"] as const;

function isSupported(action: ChannelMessageActionName): boolean {
  return (ZALO_MESSAGE_ACTIONS as readonly string[]).includes(action);
}

function withCarrier<T extends { cfg: unknown; accountId?: string | null }>(ctx: T): T {
  const account = (ctx as { account?: Record<string, unknown> }).account;
  if (account === undefined) return ctx;
  return {
    ...ctx,
    cfg: mergeAccountCarrier(ctx.cfg as OpenClawConfig, ctx.accountId ?? "", account),
  };
}

export const zaloChannelActions: ChannelMessageActionAdapter = {
  ...zaloMessageActions,
  describeMessageTool: (ctx) => zaloMessageActions.describeMessageTool?.(withCarrier(ctx)) ?? null,
  supportsAction: ({ action }) => isSupported(action),
  handleAction: async (ctx) => {
    if (!isSupported(ctx.action)) {
      throw new Error(`Action ${ctx.action} is not supported for provider zalo.`);
    }
    if (zaloMessageActions.handleAction === undefined) {
      throw new Error("Zalo actions are not available.");
    }
    return await zaloMessageActions.handleAction(withCarrier(ctx));
  },
};
