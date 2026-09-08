// upstream: extensions/telegram/src/account-owner.ts@5d8067a4483
// D-TG-011: upstream resolves the owning agent through OpenClaw routing
// (`resolveAgentRoute`). Fusion's Hub owns routing and resolves the agent before
// a send reaches the vertical, so account-scoped state is keyed by account id.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { normalizeAccountId } from "@getpaseo/channels-core/plugin-sdk/routing";

/** Resolves the agent that owns account-scoped Telegram runtime state. */
export function resolveTelegramAccountOwnerAgentId(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): string {
  void params.cfg;
  return normalizeAccountId(params.accountId);
}
