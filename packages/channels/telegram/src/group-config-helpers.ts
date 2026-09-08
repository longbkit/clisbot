// upstream: extensions/telegram/src/group-config-helpers.ts@5d8067a4483
// D-TG-021: `resolveTelegramGroupIngestEnabled`, `resolveTelegramGroupPromptSettings`
// and `resolveTelegramDirectToolPolicy` are not ported in this slice. They read
// `resolveChannelGroupPolicy` / `resolveToolsBySender` from
// `openclaw/plugin-sdk/channel-policy` (`src/config/group-policy.ts`, 548 lines over
// OpenClaw's account-lookup and session-key routing) and feed the inbound turn's
// skill/tool policy, which the Hub owns in Fusion. The scoped-config reader the send
// path calls is verbatim.
import type { ScopeTree } from "@getpaseo/channels-core/plugin-sdk/channel-policy";
// Telegram helper module supports group config helpers behavior.
import type { TelegramAccountConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";

export function resolveTelegramScopedGroupConfig(
  telegramCfg: TelegramAccountConfig,
  chatId: string | number,
  messageThreadId?: number,
) {
  const resolveTopicConfig = <T extends object>(
    scopedConfig: { topics?: Record<string, T | undefined> } | undefined,
  ): T | undefined => {
    if (!scopedConfig || messageThreadId == null) {
      return undefined;
    }
    const defaultConfig = scopedConfig.topics?.["*"];
    const exactConfig = scopedConfig.topics?.[String(messageThreadId)];
    if (defaultConfig && exactConfig) {
      return { ...defaultConfig, ...exactConfig };
    }
    return exactConfig ?? defaultConfig;
  };
  const chatIdStr = String(chatId);
  const scopedConfigs = chatIdStr.startsWith("-") ? telegramCfg.groups : telegramCfg.direct;
  // Whole-entry selection: an exact chat hides every wildcard field.
  const tree = { scopes: scopedConfigs ?? {} } as ScopeTree;
  const groupKey = Object.hasOwn(tree.scopes, chatIdStr)
    ? chatIdStr
    : Object.hasOwn(tree.scopes, "*")
      ? "*"
      : undefined;
  const path = groupKey ? [groupKey] : [];
  const matchKey = path[0];
  const groupConfig = matchKey ? scopedConfigs?.[matchKey] : undefined;
  const topicConfig = resolveTopicConfig(groupConfig);
  return { groupConfig, topicConfig };
}
