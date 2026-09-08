// upstream: extensions/telegram/src/sent-message-cache.legacy-state.ts@5d8067a4483
// D-TG-019: upstream derives the cache scope from the OpenClaw session store
// path (`openclaw/plugin-sdk/session-store-paths`) and migrates a legacy
// `.telegram-sent-messages.json` file off disk. Fusion's Hub owns state
// location, so the scope key is the account owner and the legacy file reader is
// not carried. Constants, entry-key hashing and the persisted shape are verbatim.
import { createHash } from "node:crypto";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { resolveTelegramAccountOwnerAgentId } from "./account-owner.js";

export const TTL_MS = 24 * 60 * 60 * 1000;
export const TELEGRAM_SENT_MESSAGE_CACHE_NAMESPACE = "telegram.sent-messages";
export const TELEGRAM_SENT_MESSAGE_CACHE_MAX_ENTRIES = 10_000;

export type PersistedSentMessage = {
  scopeKey: string;
  chatId: string;
  messageId: string;
  timestamp: number;
};

export type SentMessageConfig = OpenClawConfig;

function resolveSentMessageAgentId(
  cfg?: SentMessageConfig,
  owner?: { accountId?: string; agentId?: string },
): string {
  return (
    owner?.agentId?.trim() ||
    (cfg
      ? resolveTelegramAccountOwnerAgentId({
          cfg,
          accountId: owner?.accountId,
        })
      : "main")
  );
}

function sentMessageScopeKeyForStorePath(storePath: string): string {
  return createHash("sha256").update(storePath, "utf8").digest("hex").slice(0, 24);
}

export function resolveSentMessageScopeKey(
  cfg?: SentMessageConfig,
  owner?: { accountId?: string; agentId?: string },
): string {
  // This 24-hour cache follows the current agent owner. Do not revive a prior owner's
  // transient bucket when the configured default changes.
  return sentMessageScopeKeyForStorePath(resolveSentMessageAgentId(cfg, owner));
}

export function sentMessageEntryKey(scopeKey: string, chatId: string, messageId: string): string {
  return createHash("sha256")
    .update(`${scopeKey}\0${chatId}\0${messageId}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}
