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

/** The outbound native-media post: `outbound.sendMedia(args)`. The Hub's relay
 * calls it for the explicit Hub `send_file` MCP tool. One call posts ONE file
 * (the vertical posts one message per file). `filePath` is an absolute path under
 * the agent's home that the vertical reads + uploads. `mediaPosted` is the
 * G11 contract: true when the file was posted natively; false when the
 * vertical refused it (oversized — the G11 gate is size-only; both channels
 * post arbitrary files) and posted the in-channel
 * notice through its text path instead — `messageId` is that notice post's id.
 * Transport faults (missing file, Bot API / Web API failure) THROW; the Hub's
 * failDelivery owns those. */
export type SendMediaFn = (args: {
  cfg: Record<string, unknown>;
  accountId: string;
  to: string;
  threadId?: string;
  /** The local media file's absolute path (under the agent's home). */
  filePath: string;
  [key: string]: unknown;
}) => Promise<{ messageId: string; mediaPosted: boolean; [key: string]: unknown }>;

/** The plugin chunk the pin drives. Unknown keys stay open — the vertical's
 * own surface may carry more; the Hub reads only these (sendText today;
 * sendMedia is the native-media seam, G7–G11). */
export interface ChannelPlugin {
  directory?: { resolveConversation?: ResolveConversationFn | undefined };
  gateway?: { startAccount?: StartAccountFn | undefined } | undefined;
  outbound?: {
    sendText?: SendTextFn | undefined;
    sendMedia?: SendMediaFn | undefined;
  } & Record<string, unknown>;
  [key: string]: unknown;
}

/** Optional, read-only lookup of one known destination; never lists provider directories. */
export interface ChannelConversationMetadata {
  label: string | null;
  kind: "dm" | "channel" | "group";
  visibility: "public" | "private" | "unknown";
}
export type ResolveConversationFn = (args: {
  cfg: Record<string, unknown>;
  accountId: string;
  to: string;
}) => Promise<ChannelConversationMetadata | null>;
