// The closed enum sets and the privilege catalog for the channel control plane
// (implementation doc §4.3.6–§4.3.7). These are the only values the compiler
// accepts; anything else is a compile error, so a typo cannot silently widen a
// grant.

import { z } from "zod";

// --- Session mapping (§4.3.4) -------------------------------------------------

/** `binding.key` — the level at which one agent session is kept. */
export const BindingKeySchema = z.enum(["thread", "channel", "dm"]);
export type BindingKey = z.infer<typeof BindingKeySchema>;

/** `reply.anchor` — where the bot's outbound posts land. */
export const ReplyAnchorSchema = z.enum(["thread", "channel"]);
export type ReplyAnchor = z.infer<typeof ReplyAnchorSchema>;

// --- Interaction (§4.3.3) -----------------------------------------------------

/** `interaction.followUp.mode` — how unmentioned follow-ups are admitted. */
export const FollowUpModeSchema = z.enum(["auto", "mention-only"]);
export type FollowUpMode = z.infer<typeof FollowUpModeSchema>;

// --- Sync (§4.3.6) ------------------------------------------------------------

/** `sync.threadLink` — which link (if any) opens the session in a client. */
export const ThreadLinkSchema = z.enum(["full", "final-only", "none"]);
export type ThreadLink = z.infer<typeof ThreadLinkSchema>;

// --- Routes (§4.3.6) ----------------------------------------------------------

/** `routes[].match.kind` — the conversation kind a route matches. */
export const RouteMatchKindSchema = z.enum(["dm", "channel", "thread", "group", "topic"]);
export type RouteMatchKind = z.infer<typeof RouteMatchKindSchema>;

// --- Transport (§4.3.6) -------------------------------------------------------

export const SlackTransportModeSchema = z.enum(["socket", "webhook"]);
export type SlackTransportMode = z.infer<typeof SlackTransportModeSchema>;
export const TelegramTransportModeSchema = z.enum(["polling", "webhook"]);
export type TelegramTransportMode = z.infer<typeof TelegramTransportModeSchema>;

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
