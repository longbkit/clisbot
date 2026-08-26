// The drive surface — the object the Hub control plane actually drives
// (blueprint §6.5 hard rule 2, B3-immutable): `plugin.gateway.startAccount`
// + `plugin.outbound.sendText`, exposed under each channel's pinned export
// name (`telegramPlugin` / `slackPlugin`). Declared in-repo; never imported
// from OpenClaw.

import type { StartAccountContext } from "./host.js";

/** The account monitor: `gateway.startAccount(ctx)`. The returned promise
 * resolves only when `ctx.abortSignal` fires — "start" is the transport
 * lifetime; stop = abort (docs/audits/pinned-vertical-contracts/start-account.md). */
export type StartAccountFn = (ctx: StartAccountContext) => Promise<void> | void;

/** The outbound text post: `outbound.sendText(args)`. The Hub's relay posts
 * final answers through it; the args carry the drive-time `cfg` (the token
 * source), the target conversation + optional thread, and the text. The
 * result's `messageId` is the channel-native message id (Slack ts / Telegram
 * numeric id) the ledger confirms with. */
export type SendTextFn = (args: {
  cfg: Record<string, unknown>;
  accountId: string;
  to: string;
  threadId?: string;
  text: string;
  [key: string]: unknown;
}) => Promise<{ messageId: string; [key: string]: unknown }>;

/** The plugin chunk the pin drives. Unknown keys stay open — the vertical's
 * own surface may carry more; the Hub reads only these two. */
export interface ChannelPlugin {
  gateway?: { startAccount?: StartAccountFn | undefined } | undefined;
  outbound?: { sendText?: SendTextFn | undefined } & Record<string, unknown>;
  [key: string]: unknown;
}
