// Fusion-owned boundary for `src/config/types.slack.ts` (D-CORE-238).
//
// Upstream composes `SlackAccountConfig` out of `CommonChannelMessagingConfig`,
// `ChannelBotInteractionConfig`, `ChannelReactionConfig`,
// `ChannelExecApprovalConfig`, `ChannelImplicitMentionsConfig`,
// `ProviderCommandsConfig`, `SecretInput` and the group tool-policy types —
// i.e. the whole OpenClaw `config.json` type graph. Fusion's Hub owns channel
// configuration, so this file carries the Slack shapes the ported channel code
// actually reads, structurally compatible with upstream, plus an open index
// signature so unread upstream keys still type. Everything below keeps
// upstream's names, field names and doc comments. Mirrors `types.telegram.ts`
// (D-CORE-202).
import type { SecretInput } from "./types.secrets.host-adapter.js";
import type {
  ChannelStreamingConfig,
  ChannelStreamingProgressConfig,
  DmPolicy,
  GroupPolicy,
  ReplyToMode,
} from "./types.base.js";

/** Secret-bearing config input. Upstream types live in `src/config/types.secrets.ts`; the
 * carried contract is in the host adapter for that module (D-CORE-257). */
export type { SecretInput } from "./types.secrets.host-adapter.js";

/** Tool policy overrides scoped to one channel/DM. Upstream types live in `src/config/types.tools.ts`. */
export type GroupToolPolicyConfig = {
  allow?: string[];
  deny?: string[];
  [key: string]: unknown;
};
export type GroupToolPolicyBySenderConfig = Record<string, GroupToolPolicyConfig>;

/** Sliding-window bot-pair loop guard. Upstream: `src/config/types.bot-loop-protection.ts`. */
export type ChannelBotLoopProtectionConfig = {
  enabled?: boolean;
  maxEventsPerWindow?: number;
  windowSeconds?: number;
  cooldownSeconds?: number;
  [key: string]: unknown;
};

/** Implicit mention policy. Upstream: `src/config/types.implicit-mentions.ts`. */
export type ChannelImplicitMentionsConfig = {
  replies?: boolean;
  quotes?: boolean;
  participatedThreads?: boolean;
  [key: string]: unknown;
};

/** Native command registration override. Upstream: `src/config/types.messages.ts`. */
export type ProviderCommandsConfig = boolean | "auto" | { [key: string]: unknown };

/** Exec-approval delivery + approver authorization. Upstream: `src/config/types.channel-messaging-common.ts`. */
export type ChannelExecApprovalTarget = string | { [key: string]: unknown };
export type ChannelExecApprovalConfig = {
  enabled?: boolean;
  target?: ChannelExecApprovalTarget;
  [key: string]: unknown;
};

export type SlackDmConfig = {
  /** If false, ignore all incoming Slack DMs. Default: true. */
  enabled?: boolean;
  /** If true, allow group DMs (default: false). */
  groupEnabled?: boolean;
  /** Optional allowlist for group DM channels (ids or slugs). */
  groupChannels?: Array<string | number>;
};

export type SlackChannelConfig = {
  /** If false, disable the bot in this channel. */
  enabled?: boolean;
  /** Require mentioning the bot to trigger replies. */
  requireMention?: boolean;
  /**
   * Ignore room messages that mention another user or user group but not this bot.
   * Requires a resolved bot user ID. Default: false.
   */
  ignoreOtherMentions?: boolean;
  /** Override Slack reply/thread behavior for this channel. */
  replyToMode?: ReplyToMode;
  /** Optional tool policy overrides for this channel. */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  /** Allow bot-authored messages to trigger replies (default: false). Set to "mentions" to only allow bot messages that @mention this bot. */
  allowBots?: boolean | "mentions";
  /** Sliding-window bot-pair loop guard for accepted bot-authored Slack messages. */
  botLoopProtection?: ChannelBotLoopProtectionConfig;
  /** Allowlist of users that can invoke the bot in this channel. */
  users?: Array<string | number>;
  /** Optional skill filter for this channel. */
  skills?: string[];
  /** Optional system prompt for this channel. */
  systemPrompt?: string;
  /** Slack presence polling and agent wake mode for this channel. */
  presenceEvents?: SlackPresenceEventsConfig;
};

type SlackPresenceEventsMode = "off" | "auto" | "on";

type SlackPresenceEventsConfig = {
  /** Presence wake mode. Default: off. */
  mode?: SlackPresenceEventsMode;
  /** Override the default presence-event guidance. Empty omits guidance. Maximum: 20,000 characters. */
  prompt?: string;
};

export type SlackReactionNotificationMode = "off" | "own" | "all" | "allowlist";
export type SlackStreamingMode = "off" | "partial" | "block" | "progress";
// DO NOT REMOVE OR CHANGE THE COMPACT STYLE WITHOUT APPROVAL FROM SJF OR PASHPASHPASH.
export type SlackStreamingProgressConfig = ChannelStreamingProgressConfig & {
  /** Slack progress presentation. "compact" keeps one editable text draft. Default: "card". */
  style?: "card" | "compact";
  /** Use Slack-native task cards for card-style progress. Default: true. */
  nativeTaskCards?: boolean;
};
export type SlackChannelStreamingConfig = ChannelStreamingConfig<SlackStreamingProgressConfig>;
export type SlackExecApprovalTarget = ChannelExecApprovalTarget;
export type SlackExecApprovalConfig = ChannelExecApprovalConfig;
export type SlackCapabilitiesConfig = string[];

export type SlackActionConfig = {
  reactions?: boolean;
  messages?: boolean;
  pins?: boolean;
  search?: boolean;
  permissions?: boolean;
  memberInfo?: boolean;
  channelInfo?: boolean;
  emojiList?: boolean;
};

export type SlackSlashCommandConfig = {
  /** Enable handling for the configured slash command (default: false). */
  enabled?: boolean;
  /** Slash command name (default: "openclaw"). */
  name?: string;
  /** Session key prefix for slash commands (default: "slack:slash"). */
  sessionPrefix?: string;
  /** Reply ephemerally (default: true). */
  ephemeral?: boolean;
};

export type SlackThreadConfig = {
  /** Scope for thread history context (thread|channel). Default: thread. */
  historyScope?: "thread" | "channel";
  /** If true, thread sessions inherit the parent channel transcript. Default: false. */
  inheritParent?: boolean;
  /** Maximum number of thread messages to fetch as context when starting a new thread session (default: 20). Set to 0 to disable thread history fetching. */
  initialHistoryLimit?: number;
};

export type SlackRelayConfig = {
  /** Full relay websocket URL, including the route path. */
  url?: string;
  /** Bearer token used to authenticate the gateway websocket to the Slack relay. */
  authToken?: SecretInput;
  /** Gateway destination id registered with openclaw-slack-router. */
  gatewayId?: string;
};

export type SlackAccountConfig = {
    /** Post a room-specific introduction when joining a group. Default: true. */
    joinIntro?: boolean;
    /** @deprecated Doctor-only legacy input. */
    identity?: "bot" | "user";
    /** @deprecated Doctor-only legacy input. */
    socketMode?: {
      clientPingTimeout?: number;
      serverPingTimeout?: number;
      pingPongLoggingEnabled?: boolean;
    };
    /** Slack author identity. Default: bot. */
    postAs?: "bot" | "user";
    /** Slack connection mode (socket|http|relay). Default: socket. */
    mode?: "socket" | "http" | "relay";
    /** Slack SDK Socket Mode transport options. Ignored in HTTP mode. */
    /** Relay-delivered Slack event source. Used when mode is "relay". */
    relay?: SlackRelayConfig;
    /** Slack signing secret (required for HTTP mode). */
    signingSecret?: SecretInput;
    /** Slack Events API webhook path (default: /slack/events). */
    webhookPath?: string;
    /** Slack-native exec approval delivery + approver authorization. */
    execApprovals?: SlackExecApprovalConfig;
    /** Override native command registration for Slack (bool or "auto"). */
    commands?: ProviderCommandsConfig;
    botToken?: SecretInput;
    appToken?: SecretInput;
    userToken?: SecretInput;
    /** If true, restrict user token to read operations only. Default: true. */
    userTokenReadOnly?: boolean;
    /** Default mention requirement for channel messages (default: true). */
    requireMention?: boolean;
    /** Implicit mention policy for replies, quotes, and participated threads. */
    implicitMentions?: ChannelImplicitMentionsConfig;
    /** Pass through Slack chat.postMessage link unfurl control. Default: false. */
    unfurlLinks?: boolean;
    /** Pass through Slack chat.postMessage media unfurl control. Omitted by default. */
    unfurlMedia?: boolean;
    /**
     * Optional per-chat-type reply threading overrides.
     * Example: { direct: "all", group: "first", channel: "off" }.
     */
    replyToModeByChatType?: Partial<Record<"direct" | "group" | "channel", ReplyToMode>>;
    /** Thread session behavior. */
    thread?: SlackThreadConfig;
    /** Poll Slack presence and wake the routed agent on away-to-active transitions. Default: off. */
    presenceEvents?: SlackPresenceEventsConfig;
    actions?: SlackActionConfig;
    slashCommand?: SlackSlashCommandConfig;
    dm?: SlackDmConfig;
    channels?: Record<string, SlackChannelConfig>;
    /** Reaction emoji added while processing a reply (e.g. "hourglass_flowing_sand"). Removed when done. Useful as a typing indicator fallback when assistant mode is not enabled. */
    typingReaction?: string;
    enabled?: boolean;
    name?: string;
    /** Group-chat admission policy for this account. */
    groupPolicy?: GroupPolicy;
    /** Direct-message admission policy for this account. */
    dmPolicy?: DmPolicy;
    /** Senders allowed to reach this account. */
    allowFrom?: Array<string | number>;
    /** Default outbound target when a send omits one. */
    defaultTo?: string;
    /** Outbound text chunk ceiling. */
    textChunkLimit?: number;
    /** Outbound media ceiling in megabytes. */
    mediaMaxMb?: number;
    /** Markdown table rendering mode. */
    markdown?: { tableMode?: "off" | "bullets" | "code" | "block"; [key: string]: unknown };
    /** Streaming/progress delivery configuration. */
    streaming?: SlackChannelStreamingConfig;
    /** Reply threading behavior for outbound sends. */
    replyToMode?: ReplyToMode;
    /** Reaction notification mode for inbound reaction events. */
    reactionNotifications?: SlackReactionNotificationMode;
    /** Allowlist consulted when `reactionNotifications` is "allowlist". */
    reactionAllowlist?: string[];
    /** Tool policy overrides for group surfaces. */
    tools?: GroupToolPolicyConfig;
    toolsBySender?: GroupToolPolicyBySenderConfig;
    /** Enterprise Grid name-matching escape hatch; refused for org accounts. */
    dangerouslyAllowNameMatching?: boolean;
    /** Extra mention patterns, scoped by conversation. */
    mentionPatterns?: {
      patterns?: string[];
      allowIn?: string[];
      denyIn?: string[];
      [key: string]: unknown;
    };
    /** Unread upstream keys still type. */
    [key: string]: unknown;
  };

export type SlackConfig = {
  /** Optional per-account Slack configuration (multi-account). */
  accounts?: Record<string, SlackAccountConfig>;
  /** Optional default account id when multiple accounts are configured. */
  defaultAccount?: string;
} & SlackAccountConfig;
