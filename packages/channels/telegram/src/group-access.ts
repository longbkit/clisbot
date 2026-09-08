// upstream: extensions/telegram/src/group-access.ts@5d8067a4483
// D-TG-020: upstream's group-access module is the inbound admission gate
// (allow-from matching, chat allowlists, DM pairing, block reasons). Inbound
// admission is Hub-owned in Fusion (goal slices 1-3), so this file carries the
// group-policy precedence the ported send path consults before posting a poll,
// verbatim from upstream.
import type {
  OpenClawConfig,
  TelegramAccountConfig,
  TelegramGroupConfig,
  TelegramTopicConfig,
} from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { resolveOpenProviderRuntimeGroupPolicy } from "@getpaseo/channels-core/config/runtime-group-policy";
import { firstDefined } from "./bot-access.js";

export const resolveTelegramRuntimeGroupPolicy = (params: {
  providerConfigPresent: boolean;
  groupPolicy?: TelegramAccountConfig["groupPolicy"];
  defaultGroupPolicy?: TelegramAccountConfig["groupPolicy"];
}) =>
  resolveOpenProviderRuntimeGroupPolicy({
    providerConfigPresent: params.providerConfigPresent,
    groupPolicy: params.groupPolicy,
    defaultGroupPolicy: params.defaultGroupPolicy,
  });

export const resolveTelegramEffectiveGroupPolicy = (params: {
  cfg: OpenClawConfig;
  telegramCfg: TelegramAccountConfig;
  groupConfig?: TelegramGroupConfig;
  topicConfig?: TelegramTopicConfig;
}) => {
  const channels = params.cfg.channels as unknown as
    | { telegram?: unknown; defaults?: { groupPolicy?: TelegramAccountConfig["groupPolicy"] } }
    | undefined;
  const { groupPolicy: runtimeFallbackPolicy } = resolveTelegramRuntimeGroupPolicy({
    providerConfigPresent: channels?.telegram !== undefined,
    groupPolicy: params.telegramCfg.groupPolicy,
    defaultGroupPolicy: channels?.defaults?.groupPolicy,
  });
  return (
    firstDefined(
      params.topicConfig?.groupPolicy,
      params.groupConfig?.groupPolicy,
      params.telegramCfg.groupPolicy,
      channels?.defaults?.groupPolicy,
    ) ?? runtimeFallbackPolicy
  );
};
