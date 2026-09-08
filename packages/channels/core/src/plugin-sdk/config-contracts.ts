// upstream: src/plugin-sdk/config-contracts.ts@5d8067a4483
// Focused public config shape types used by bundled and third-party plugins.

export type { MarkdownConfig, MarkdownTableMode, ReplyToMode } from "../config/types.base.js";
// D-CORE-003: the upstream barrel re-exports the whole `OpenClawConfig` graph
// (gateway origin resolver, per-channel account configs, session scopes, …).
// Fusion's Hub owns channel configuration, so only the markdown-rendering
// contracts the ported formatters read are carried; see upstream-sync.json.

// Slice 9 additions (Telegram send/actions port). The upstream barrel exports
// these from the same subpath; the shapes come from the narrowed
// `config/types.telegram.ts` (D-CORE-202) and the opaque host config
// (D-CORE-010) rather than the full OpenClaw config graph.
export type { StreamingMode, TextChunkMode } from "../config/types.base.js";
// D-CORE-239: the channel-typed view of the host config, so a ported vertical
// reads its own `channels.<id>` section with upstream's types.
export type { OpenClawConfig } from "../config/types.openclaw.channels.js";
export type { DmPolicy, GroupPolicy } from "../config/types.base.js";
export type {
  GroupToolPolicyBySenderConfig,
  GroupToolPolicyConfig,
  TelegramAccountConfig,
  TelegramActionConfig,
  TelegramCapabilitiesConfig,
  TelegramConfig,
  TelegramDirectConfig,
  TelegramGroupConfig,
  TelegramInlineButtonsScope,
  TelegramNetworkConfig,
  TelegramTopicConfig,
} from "../config/types.telegram.js";

// Slice 10b additions (Slack send/actions port). Shapes come from the narrowed
// `config/types.slack.ts` (D-CORE-238).
export type {
  ChannelBotLoopProtectionConfig,
  SlackAccountConfig,
  SlackActionConfig,
  SlackChannelConfig,
  SlackConfig,
  SlackDmConfig,
  SlackReactionNotificationMode,
  SlackSlashCommandConfig,
  SlackThreadConfig,
} from "../config/types.slack.js";

// Slice 13 additions (Discord vertical port). Shapes come from the narrowed
// `config/types.discord.ts` (D-CORE-301).
export type {
  DiscordAccountConfig,
  DiscordActionConfig,
  DiscordAgentComponentsConfig,
  DiscordAutoPresenceConfig,
  DiscordChannelStreamingConfig,
  DiscordConfig,
  DiscordDmConfig,
  DiscordExecApprovalConfig,
  DiscordGuildChannelConfig,
  DiscordGuildEntry,
  DiscordIntentsConfig,
  DiscordMentionAliasesConfig,
  DiscordPluralKitConfig,
  DiscordReactionNotificationMode,
  DiscordSlashCommandConfig,
  DiscordStreamMode,
  DiscordThreadBindingsConfig,
  DiscordThreadConfig,
  DiscordVoiceConfig,
} from "../config/types.discord.js";

// Slice 14 additions (Google Chat vertical port). Shapes come from the narrowed
// `config/types.googlechat.ts` (D-CORE-324).
export type {
  GoogleChatAccountConfig,
  GoogleChatConfig,
  GoogleChatDmConfig,
  GoogleChatGroupConfig,
} from "../config/types.googlechat.js";
