// The closed enum sets and the privilege catalog for the channel control plane
// (implementation doc §4.3.6–§4.3.7). These are the only values the compiler
// accepts; anything else is a compile error, so a typo cannot silently widen a
// grant.

import { z } from "zod";
import { SUPPORTED_CHANNEL_NAMES } from "../catalog.js";

// --- Channel identity ---------------------------------------------------------

/** The channel names the Hub compiles, starts and routes, as a request/query
 * enum. Derived from the catalog (`catalog.ts`) so a new in-repo vertical is
 * admitted everywhere at once instead of one hand-widened enum at a time. */
export const SupportedChannelNameSchema = z.enum(SUPPORTED_CHANNEL_NAMES);

// --- Session mapping (§4.3.4) -------------------------------------------------

/** `binding.key` — the level at which one agent session is kept. */
export const BindingKeySchema = z.enum(["thread", "channel", "dm"]);
export type BindingKey = z.infer<typeof BindingKeySchema>;

/** `reply.anchor` — where the bot's outbound posts land. `default` follows the
 * inbound marker (a thread marker → that thread, a root marker → the
 * conversation root); `thread` follows the marker too and mints the reply
 * thread on a root-level Slack marker — answering the marker message itself
 * (`thread_ts` = the marker's `ts`; OpenClaw `replyToMode: all`). */
export const ReplyAnchorSchema = z.enum(["default", "thread"]);
export type ReplyAnchor = z.infer<typeof ReplyAnchorSchema>;

// --- Interaction (§4.3.3) -----------------------------------------------------

/** `interaction.followUp.mode` — how unmentioned follow-ups are admitted. */
export const FollowUpModeSchema = z.enum(["auto", "mention-only"]);
export type FollowUpMode = z.infer<typeof FollowUpModeSchema>;

// --- Sync (§4.3.6) ------------------------------------------------------------

/** `sync.threadLink` — which link (if any) opens the session in a client. */
export const ThreadLinkSchema = z.enum(["full", "final-only", "none"]);
export type ThreadLink = z.infer<typeof ThreadLinkSchema>;

/**
 * `sync.streaming.mode` — how much of a running turn the channel shows before
 * the answer is final. Upstream's value set (`extensions/slack/src/
 * streaming-compat.ts` `StreamingMode`), kept verbatim so a channel account
 * authored for OpenClaw compiles here:
 *
 *  * `off` — nothing streams; the turn's final answer is one post (the floor).
 *  * `partial` — the answer streams as a live draft (Slack's native
 *    `chat.startStream` transport when the vertical exposes it, else an
 *    edit-in-place draft message).
 *  * `block` — the same draft, edit-in-place only, never native.
 *  * `progress` — no answer draft; one progress message shows the running
 *    tool activity and is edited in place for the length of the turn.
 */
export const StreamingModeSchema = z.enum(["off", "partial", "block", "progress"]);
export type StreamingMode = z.infer<typeof StreamingModeSchema>;

/** `sync.progress.messageReaction` — the reserved "never react" value. */
export const MESSAGE_REACTION_OFF = "off";

/**
 * A reaction emoji name. Slack's own naming rule (lowercase letters, digits,
 * `_`, `+`, `-`, up to 50 chars — `hourglass_flowing_sand`,
 * `heavy_check_mark`). Custom emoji are created by users, so the value is open
 * and the guard is the NAME SHAPE, not a closed list: a typo fails at compile
 * instead of costing a `bad_emoji` on every turn.
 */
export const EMOJI_NAME_PATTERN = /^[a-z0-9][a-z0-9_+-]{0,49}$/u;

/**
 * `sync.progress.messageReaction` — `"off"` (the floor: never react) or an
 * emoji name. The bot reacts to the SENDER'S OWN message so it is visibly
 * taken, and removes the reaction when the turn ends. Telegram has no reaction
 * surface and ignores the value.
 */
export const MessageReactionSchema = z
  .union([
    z.literal(MESSAGE_REACTION_OFF),
    z.string().regex(EMOJI_NAME_PATTERN, "an emoji name: lowercase, 1-50 chars"),
  ])
  .optional();
export type MessageReaction = z.infer<typeof MessageReactionSchema>;

// --- Outbound (E4/E6) ----------------------------------------------------------

/**
 * `outbound.path` — which channel surface carries the agent's reply. `relay`
 * (the org-floor default) posts the relay's sync-gated text; `tool` attaches
 * the hub's channel-reply MCP tool to the created agent and folds the route's
 * root `sync` knobs off, so the tool post is the only user-visible answer.
 */
export const OutboundPathSchema = z.enum(["relay", "tool"]);
export type OutboundPath = z.infer<typeof OutboundPathSchema>;

/**
 * `defaults.inbound.reactionNotifications` — upstream's channel reaction
 * notification mode, reused verbatim from
 * each channel's `config-schema.ts` (`buildChannelReactionShape({
 * notificationModes })`), so an account authored for OpenClaw compiles here
 * unchanged. Fusion never wakes an agent on a reaction, so the leaf gates
 * whether the event is RECORDED in channel activity: `off` drops it, `own` and
 * `all` both record it (the Hub cannot yet tell whose message was reacted to,
 * so the two upstream modes behave alike).
 */
export const ReactionNotificationsSchema = z.enum(["off", "own", "all"]);
export type ReactionNotifications = z.infer<typeof ReactionNotificationsSchema>;

/**
 * `defaults.inbound.editNotifications` — an inbound message EDIT. Upstream has
 * no config leaf for edits (it routes `message_changed` through its system-event
 * bus unconditionally); the name follows upstream's `*Notifications` family.
 * `off` (the floor) records the edit and stops there; `all` re-runs the edited
 * message as if it had just arrived.
 */
export const EditNotificationsSchema = z.enum(["off", "all"]);
export type EditNotifications = z.infer<typeof EditNotificationsSchema>;

// --- Routes (§4.3.6) ----------------------------------------------------------

/** `routes[].match.kind` — the conversation kind a route matches. */
export const RouteMatchKindSchema = z.enum(["dm", "channel", "thread", "group", "topic"]);
export type RouteMatchKind = z.infer<typeof RouteMatchKindSchema>;

// --- Transport (§4.3.6) -------------------------------------------------------

export const SlackTransportModeSchema = z.enum(["socket", "webhook"]);
export type SlackTransportMode = z.infer<typeof SlackTransportModeSchema>;
export const TelegramTransportModeSchema = z.enum(["polling", "webhook"]);
export type TelegramTransportMode = z.infer<typeof TelegramTransportModeSchema>;
/** Discord has one inbound transport: the persistent gateway WebSocket. The
 * HTTP interactions endpoint is a second one upstream supports; it needs a
 * public URL the Hub does not expose yet, so it is not offered. */
export const DiscordTransportModeSchema = z.enum(["gateway"]);
export type DiscordTransportMode = z.infer<typeof DiscordTransportModeSchema>;
/** Google Chat delivers only by HTTP POST to a public HTTPS URL — there is no
 * polling and no socket mode. The Hub publishes no endpoint of its own, so the
 * operator puts a reverse proxy in front of the account's own listener
 * (`packages/channels/googlechat/HUB-WIRING.md` §6). */
export const GoogleChatTransportModeSchema = z.enum(["webhook"]);
export type GoogleChatTransportMode = z.infer<typeof GoogleChatTransportModeSchema>;
/** Feishu's two upstream modes, under upstream's own `connectionMode` names.
 * `websocket` (the long connection) needs no public URL and is the default. */
export const FeishuTransportModeSchema = z.enum(["websocket", "webhook"]);
export type FeishuTransportMode = z.infer<typeof FeishuTransportModeSchema>;
/** Zalo Personal has one inbound transport and it is not a credential the
 * operator can paste: the account is linked by a QR scan and the resulting
 * session drives a push socket. The mode name is the linking method because
 * that is the only choice the operator makes. */
export const ZalouserTransportModeSchema = z.enum(["qr"]);
export type ZalouserTransportMode = z.infer<typeof ZalouserTransportModeSchema>;
/** Zalo's two upstream modes. `polling` is a plain outbound long poll and needs
 * no public URL; `webhook` additionally needs the signing secret Zalo echoes in
 * `x-bot-api-secret-token`. */
export const ZaloTransportModeSchema = z.enum(["polling", "webhook"]);
export type ZaloTransportMode = z.infer<typeof ZaloTransportModeSchema>;

// --- Access policy (upstream `channels.<channel>.accounts.<id>` names) ---------
//
// `dmPolicy`, `groupPolicy`, `allowFrom` and `groupAllowFrom` keep OpenClaw's
// spelling and semantics (`extensions/*/src/config-schema*.ts`,
// `src/config/types.base.ts`) so an account authored for OpenClaw compiles
// unchanged. The decision itself is upstream's too — the Hub calls the ported
// `resolveDmGroupAccessWithLists` (`@getpaseo/channels-core/security/dm-policy-shared`)
// rather than re-deriving it.

/** `dmPolicy` — who may open a direct conversation with the bot. */
export const DmPolicySchema = z.enum(["open", "pairing", "allowlist", "disabled"]);
export type DmPolicy = z.infer<typeof DmPolicySchema>;

/** `groupPolicy` — who may address the bot in a group/channel conversation. */
export const GroupPolicySchema = z.enum(["open", "allowlist", "disabled"]);
export type GroupPolicy = z.infer<typeof GroupPolicySchema>;

/** Delivery-error surfacing. */
export const ErrorPolicySchema = z.enum(["always", "once", "silent"]);
export type ErrorPolicy = z.infer<typeof ErrorPolicySchema>;

/** P0.5 native approval-card placement (P0 prompts are text + command). */
export const InlineButtonsSchema = z.enum(["off", "dm", "group", "all", "allowlist"]);
export type InlineButtons = z.infer<typeof InlineButtonsSchema>;

// --- Approval rules (§4.3.6) --------------------------------------------------

/** `approval[].mode` — run without asking / always refuse / prompt in-thread. */
export const ApprovalModeSchema = z.enum(["auto-allow", "auto-deny", "require"]);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

/**
 * The closed tool classes an approval `match` may name (§4.3.6/§4.3.7): the
 * `approval.*` privilege leaves without the `approval.` prefix, plus `*` as
 * the wildcard fallback (required whenever rules exist). The policy engine
 * maps a requested tool to one of these; everything the mapper does not
 * recognize falls through to the `*` rule.
 */
export const TOOL_CLASSES = [
  "file",
  "config",
  "command",
  "command.destructive",
  "channel",
] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];

export function isApprovalMatchPattern(match: string): boolean {
  if (match === "*") return true;
  if ((TOOL_CLASSES as readonly string[]).includes(match)) return true;
  return isPrivilegePattern(match);
}

// --- Privilege catalog (§4.3.7, closed) ---------------------------------------

/** The fixed privilege families. A `<family>.*` wildcard covers the family. */
export const PRIVILEGE_FAMILIES = ["bot", "approval", "tool", "channel.tool"] as const;
export type PrivilegeFamily = (typeof PRIVILEGE_FAMILIES)[number];

/** The closed leaf privileges (beyond the family wildcards). */
export const PRIVILEGE_LEAVES = [
  "bot.interact",
  "approval.file",
  "approval.config",
  "approval.command",
  "approval.command.destructive",
  "approval.channel",
] as const;

/**
 * True when `pattern` is a well-formed privilege reference: `*`, a known leaf,
 * a known family (or `<family>.*` wildcard), or `channel.tool.<name>` (open
 * within that family, for P1 channel agent tools). This is the "closed
 * catalog" check — a malformed pattern is a compile error, not a silent no-op.
 */
export function isPrivilegePattern(pattern: string): boolean {
  if (pattern === "*") return true;
  if (PRIVILEGE_LEAVES.includes(pattern as (typeof PRIVILEGE_LEAVES)[number])) return true;
  for (const family of PRIVILEGE_FAMILIES) {
    if (pattern === `${family}.*`) return true;
  }
  // `channel.tool.<name>` is open within its family (P1 channel agent tools).
  const channelTool = "channel.tool.";
  return pattern.startsWith(channelTool) && pattern.length > channelTool.length;
}
