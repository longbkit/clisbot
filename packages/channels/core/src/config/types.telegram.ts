// upstream: src/config/types.telegram.ts@5d8067a4483
// D-CORE-202: upstream composes `TelegramAccountConfig` out of
// `CommonChannelMessagingConfig`, `ChannelReactionConfig`, `ChannelExecApprovalConfig`,
// `ProviderCommandsConfig`, `SecretInput`, `SessionThreadBindingsConfig` and the
// group tool-policy types — i.e. the whole OpenClaw `config.json` type graph.
// Fusion's Hub owns channel configuration, so this file carries the Telegram
// shapes the ported channel code actually reads, structurally compatible with
// upstream, plus an open index signature so unread upstream keys still type.
// Everything below keeps upstream's names, field names and doc comments.
import type { DmPolicy, GroupPolicy, MarkdownConfig } from "./types.base.js";

export type TelegramActionConfig = {
  reactions?: boolean;
  sendMessage?: boolean;
  /** Enable poll creation. Requires sendMessage to also be enabled. */
  poll?: boolean;
  deleteMessage?: boolean;
  editMessage?: boolean;
  /** Enable sticker actions (send and search). */
  sticker?: boolean;
  /** Enable forum topic creation. */
  createForumTopic?: boolean;
  /** Enable forum topic editing (rename / change icon). */
  editForumTopic?: boolean;
};

export type TelegramNetworkConfig = {
  /** Override Node's autoSelectFamily behavior (true = enable, false = disable). */
  autoSelectFamily?: boolean;
  /**
   * DNS result order for network requests ("ipv4first" | "verbatim").
   * Set to "ipv4first" to prioritize IPv4 addresses and work around IPv6 issues.
   * Default: "ipv4first" on Node 22+ to avoid common fetch failures.
   */
  dnsResultOrder?: "ipv4first" | "verbatim";
  /**
   * Dangerous opt-in for Telegram media downloads in trusted fake-IP or
   * transparent-proxy environments that resolve api.telegram.org to
   * private/internal/special-use addresses.
   */
  dangerouslyAllowPrivateNetwork?: boolean;
};

export type TelegramInlineButtonsScope = "off" | "dm" | "group" | "all" | "allowlist";

export type TelegramCapabilitiesConfig =
  | string[]
  | {
      inlineButtons?: TelegramInlineButtonsScope;
    };

/** Tool policy overrides scoped to one group/DM. Upstream types live in `src/config/types.tools.ts`. */
export type GroupToolPolicyConfig = {
  allow?: string[];
  deny?: string[];
  [key: string]: unknown;
};
export type GroupToolPolicyBySenderConfig = Record<string, GroupToolPolicyConfig>;

export type TelegramTopicConfig = {
  requireMention?: boolean;
  /** Emit internal message hooks for mention-skipped topic messages. */
  ingest?: boolean;
  /** Per-topic override for group message policy (open|disabled|allowlist). */
  groupPolicy?: GroupPolicy;
  /** If specified, only load these skills for this topic. Omit = all skills; empty = no skills. */
  skills?: string[];
  /** If false, disable the bot for this topic. */
  enabled?: boolean;
  /** Optional allowlist for topic senders (numeric Telegram user IDs). */
  allowFrom?: Array<string | number>;
  /** Optional system prompt snippet for this topic. */
  systemPrompt?: string;
  /** If true, skip automatic voice-note transcription for mention detection in this topic. */
  disableAudioPreflight?: boolean;
  /** Route this topic to a specific agent (overrides group-level and binding routing). */
  agentId?: string;
  /** Controls outbound error reporting for this topic. */
  errorPolicy?: "always" | "once" | "silent";
  [key: string]: unknown;
};

export type TelegramGroupConfig = {
  requireMention?: boolean;
  /** Emit internal message hooks for mention-skipped group messages. */
  ingest?: boolean;
  /** Per-group override for group message policy (open|disabled|allowlist). */
  groupPolicy?: GroupPolicy;
  /** Optional tool policy overrides for this group. */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  /** If specified, only load these skills for this group (when no topic). Omit = all skills; empty = no skills. */
  skills?: string[];
  /** Per-topic configuration (key is message_thread_id as string, or "*" for topic defaults). */
  topics?: Record<string, TelegramTopicConfig>;
  /** If false, disable the bot for this group (and its topics). */
  enabled?: boolean;
  /** Optional allowlist for group senders (numeric Telegram user IDs). */
  allowFrom?: Array<string | number>;
  /** Optional system prompt snippet for this group. */
  systemPrompt?: string;
  /** If true, skip automatic voice-note transcription for mention detection in this group. */
  disableAudioPreflight?: boolean;
  /** Controls outbound error reporting for this group. */
  errorPolicy?: "always" | "once" | "silent";
  [key: string]: unknown;
};

export type TelegramDirectConfig = {
  /** Per-DM override for DM message policy (open|disabled|allowlist). */
  dmPolicy?: DmPolicy;
  /** Optional tool policy overrides for this DM. */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  /** If specified, only load these skills for this DM (when no topic). Omit = all skills; empty = no skills. */
  skills?: string[];
  /** Per-topic configuration for DM topics (key is message_thread_id as string, or "*" for topic defaults). */
  topics?: Record<string, TelegramTopicConfig>;
  /** If false, disable the bot for this DM (and its topics). */
  enabled?: boolean;
  /** If true, require messages to be from a topic when topics are enabled. */
  requireTopic?: boolean;
  /** Optional allowlist for DM senders (numeric Telegram user IDs). */
  allowFrom?: Array<string | number>;
  /** Optional system prompt snippet for this DM. */
  systemPrompt?: string;
  /** Controls outbound error reporting for this DM. */
  errorPolicy?: "always" | "once" | "silent";
  [key: string]: unknown;
};

export type TelegramAccountConfig = {
  enabled?: boolean;
  name?: string;
  /** Group-chat admission policy for this account. */
  groupPolicy?: GroupPolicy;
  /** Direct-message admission policy for this account. */
  dmPolicy?: DmPolicy;
  botToken?: string;
  /** Path to a regular file containing the bot token; symlinks are rejected. */
  tokenFile?: string;
  groups?: Record<string, TelegramGroupConfig>;
  /** Per-DM configuration for Telegram DM topics (key is chat ID). */
  direct?: Record<string, TelegramDirectConfig>;
  /**
   * Use Telegram Bot API 10.3 rich messages for text sends and edits.
   * When false (default), falls back to HTML/plain text formatting via sendMessage.
   */
  richMessages?: boolean;
  /** Network transport overrides for Telegram. */
  network?: TelegramNetworkConfig;
  proxy?: string;
  /** Per-action tool gating (default: true for all). */
  actions?: TelegramActionConfig;
  /** Controls whether link previews are shown in outbound messages. Default: true. */
  linkPreview?: boolean;
  /** Custom Telegram Bot API root URL, not a /bot<TOKEN> endpoint. */
  apiRoot?: string;
  /** Trusted local filesystem roots for self-hosted Telegram Bot API absolute file_path values. */
  trustedLocalFileRoots?: string[];
  /** Agent-visible native capabilities (inline buttons scope). */
  capabilities?: TelegramCapabilitiesConfig;
  /** Agent reaction capability level. */
  reactionLevel?: "off" | "ack" | "minimal" | "extensive";
  /** Outbound media size cap in MB. */
  mediaMaxMb?: number;
  /** Per-request timeout in seconds for Bot API calls. */
  timeoutSeconds?: number;
  /** Outbound text chunk limit override. */
  textChunk?: { limit?: number; mode?: "length" | "newline" };
  /** Markdown rendering overrides for this account. */
  markdown?: MarkdownConfig;
  [key: string]: unknown;
};

export type TelegramConfig = {
  /** Optional per-account Telegram configuration (multi-account). */
  accounts?: Record<string, TelegramAccountConfig>;
  /** Optional default account id when multiple accounts are configured. */
  defaultAccount?: string;
} & TelegramAccountConfig;
