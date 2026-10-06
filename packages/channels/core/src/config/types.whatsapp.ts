// Fusion-owned boundary for `src/config/types.whatsapp.ts` (D-CORE-704).
//
// Upstream composes the WhatsApp section out of `CommonChannelMessagingConfig`,
// `ChannelReadReceiptConfig`, `ChannelReactionConfig` and the group tool-policy
// types — the whole OpenClaw `config.json` type graph. As for Slack (D-CORE-238)
// and Telegram (D-CORE-202), this file carries the WhatsApp shapes the ported
// vertical reads, structurally compatible with upstream, with upstream's names,
// field names and doc comments, plus an open index signature so unread upstream
// keys still type.
import type { ReactionLevel } from "../utils/reaction-level.js";
import type {
  ChannelDeliveryStreamingConfig,
  ContextVisibilityMode,
  DmPolicy,
  GroupPolicy,
  MarkdownConfig,
  ReplyToMode,
} from "./types.base.js";
import type { GroupToolPolicyBySenderConfig, GroupToolPolicyConfig } from "./types.slack.js";

export type WhatsAppActionConfig = {
  reactions?: boolean;
  sendMessage?: boolean;
  polls?: boolean;
  /** Enable the experimental requester-bound voice-call tool. Default: false. */
  calls?: boolean;
};

export type WhatsAppReactionLevel = ReactionLevel;

export type WhatsAppGroupConfig = {
  requireMention?: boolean;
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  /** Optional system prompt for this group. */
  systemPrompt?: string;
};

export type WhatsAppDirectConfig = {
  /** Optional system prompt for this direct chat. */
  systemPrompt?: string;
};

export type WhatsAppAckReactionConfig = {
  /** Emoji to use for acknowledgment (e.g., "👀"). Empty = disabled. */
  emoji?: string;
  /** Send reactions in direct chats. Default: true. */
  direct?: boolean;
  /** Send reactions in group chats. Default: "mentions". */
  group?: "always" | "mentions" | "never";
};

/** Upstream `CommonChannelMessagingConfig<string[], string>` + read receipts + reactions. */
type WhatsAppSharedConfig = {
  /** Optional provider capability tags used for agent/runtime guidance. */
  capabilities?: string[];
  /** Markdown formatting overrides (tables). */
  markdown?: MarkdownConfig;
  /** If false, do not start this account. Default: true. */
  enabled?: boolean;
  /** Direct message access policy (default: pairing). */
  dmPolicy?: DmPolicy;
  /** Optional allowlist for inbound DM senders. */
  allowFrom?: string[];
  /** Default delivery target for CLI --deliver when no explicit --reply-to is provided. */
  defaultTo?: string;
  /** Optional allowlist for group/channel senders. */
  groupAllowFrom?: string[];
  /** Group/channel message handling policy. */
  groupPolicy?: GroupPolicy;
  /** Scope configured mention patterns to selected conversations. */
  mentionPatterns?: Record<string, unknown>;
  /** Supplemental context visibility policy for fetched/group context. */
  contextVisibility?: ContextVisibilityMode;
  /** Max group/channel messages to keep as history context (0 disables). */
  historyLimit?: number;
  /** Outbound text chunk size (chars). */
  textChunkLimit?: number;
  /** Delivery streaming config: chunk mode plus block streaming controls. */
  streaming?: ChannelDeliveryStreamingConfig;
  /** Outbound response prefix override for this channel/account. */
  responsePrefix?: string;
  /** Max outbound media size in MB. */
  mediaMaxMb?: number;
  /** Native reply-threading mode for automatic replies. */
  replyToMode?: ReplyToMode;
  sendReadReceipts?: boolean;
  reactionLevel?: WhatsAppReactionLevel;
  ackReaction?: WhatsAppAckReactionConfig;
  /** Same-phone setup (bot uses your personal WhatsApp number). */
  selfChatMode?: boolean;
  groups?: Record<string, WhatsAppGroupConfig>;
  /** Per-direct-chat prompt overrides keyed by user ID or `*` wildcard. */
  direct?: Record<string, WhatsAppDirectConfig>;
  /** @deprecated Doctor-only legacy input. */
  messagePrefix?: string;
  [key: string]: unknown;
};

export type WhatsAppAccountConfig = WhatsAppSharedConfig & {
  /** Optional display name for this account (used in CLI/UI lists). */
  name?: string;
  /** Override auth directory (Baileys multi-file auth state). */
  authDir?: string;
};

export type WhatsAppConfig = WhatsAppSharedConfig & {
  /** Optional per-account WhatsApp configuration (multi-account). */
  accounts?: Record<string, WhatsAppAccountConfig>;
  /** Optional default account id when multiple accounts are configured. */
  defaultAccount?: string;
  /** Per-action tool gating. Calls default to false; existing actions default to true. */
  actions?: WhatsAppActionConfig;
};
