// upstream: extensions/telegram/src/target-writeback.ts@5d8067a4483
// D-TG-016: upstream persists a resolved `@username` -> numeric chat id back
// into the OpenClaw config file (`openclaw/plugin-sdk/config-mutation`) and
// rewrites cron store targets. Fusion's Hub owns channel configuration and
// never lets a vertical write it, so the resolve step stands alone: the caller
// still gets the numeric chat id, nothing is written back.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";

/** No-op in Fusion: chat-id write-back is a Hub-owned config mutation. */
export async function maybePersistResolvedTelegramTarget(params: {
  cfg: OpenClawConfig;
  rawTarget: string;
  resolvedChatId: string;
  verbose?: boolean;
  gatewayClientScopes?: readonly string[];
  trustedInternalWriteback?: boolean;
}): Promise<void> {
  void params;
}
