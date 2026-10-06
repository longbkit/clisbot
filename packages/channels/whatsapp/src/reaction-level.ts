// upstream: extensions/whatsapp/src/reaction-level.ts@3928bad9bad
// Whatsapp plugin module implements reaction level behavior.
import type { OpenClawConfig } from "@clisbot/channels-core/plugin-sdk/config-contracts";
import {
  resolveReactionLevel,
  type ResolvedReactionLevel,
} from "@clisbot/channels-core/plugin-sdk/status-helpers";
import { resolveMergedWhatsAppAccountConfig } from "./account-config.js";

/** Resolve the effective reaction level and its implications for WhatsApp. */
export function resolveWhatsAppReactionLevel(params: {
  cfg: OpenClawConfig;
  accountId?: string;
}): ResolvedReactionLevel {
  const account = resolveMergedWhatsAppAccountConfig({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  return resolveReactionLevel({
    value: account.reactionLevel,
    defaultLevel: "minimal",
    invalidFallback: "minimal",
  });
}
