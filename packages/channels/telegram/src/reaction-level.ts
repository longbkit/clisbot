// upstream: extensions/telegram/src/reaction-level.ts@5d8067a4483
// Telegram plugin module implements reaction level behavior.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import {
  resolveReactionLevel,
  type ReactionLevel,
  type ResolvedReactionLevel as BaseResolvedReactionLevel,
} from "@getpaseo/channels-core/plugin-sdk/status-helpers";
import { inspectTelegramAccount } from "./account-inspect.js";

export type TelegramReactionLevel = ReactionLevel;
export type ResolvedReactionLevel = BaseResolvedReactionLevel;

/**
 * Resolve the effective reaction level and its implications.
 */
export function resolveTelegramReactionLevel(params: {
  cfg: OpenClawConfig;
  accountId?: string;
}): ResolvedReactionLevel {
  const account = inspectTelegramAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  return resolveReactionLevel({
    value: account.config.reactionLevel,
    defaultLevel: "minimal",
    invalidFallback: "ack",
  });
}
