// upstream: extensions/slack/src/account-surface-fields.ts@5d8067a4483
// Slack plugin module implements account surface fields behavior.
import type { SlackAccountConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";

export type SlackAccountSurfaceFields = {
  groupPolicy?: SlackAccountConfig["groupPolicy"];
  textChunkLimit?: SlackAccountConfig["textChunkLimit"];
  mediaMaxMb?: SlackAccountConfig["mediaMaxMb"];
  reactionNotifications?: SlackAccountConfig["reactionNotifications"];
  reactionAllowlist?: SlackAccountConfig["reactionAllowlist"];
  replyToMode?: SlackAccountConfig["replyToMode"];
  replyToModeByChatType?: SlackAccountConfig["replyToModeByChatType"];
  actions?: SlackAccountConfig["actions"];
  slashCommand?: SlackAccountConfig["slashCommand"];
  dm?: SlackAccountConfig["dm"];
  channels?: SlackAccountConfig["channels"];
};
