// Fusion-owned host adapter for `src/infra/outbound/message-account-selection.ts` (D-CORE-037).
//
// Upstream validates an explicitly requested account against OpenClaw's channel
// account config (enabled flags, secret-owner availability, per-channel default
// accounts) and plans broadcast fan-out across them. In Fusion the Hub owns
// Connections and the reply capability names exactly one account, so the check
// reduces to normalization: an explicit account is passed through, an absent one
// means "use the account the Hub bound".
import { normalizeOptionalAccountId } from "../../routing/account-id.js";
import type { ChannelId, ChannelPlugin, OpenClawConfig } from "../../channels/plugins/types.public.js";

export type MessageBroadcastAccountPlan = {
  accountId?: string;
  candidateChannels: readonly ChannelId[];
};

export function validateExplicitMessageAccountSelection(params: {
  cfg: OpenClawConfig;
  channel?: ChannelId;
  accountId?: string | null;
  plugin?: ChannelPlugin;
  checkResolvedAccount?: boolean;
}): string | undefined {
  return normalizeOptionalAccountId(params.accountId) ?? undefined;
}

export function resolveMessageBroadcastAccountPlan(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): MessageBroadcastAccountPlan | undefined {
  const accountId = normalizeOptionalAccountId(params.accountId) ?? undefined;
  return accountId === undefined ? undefined : { accountId, candidateChannels: [] };
}
