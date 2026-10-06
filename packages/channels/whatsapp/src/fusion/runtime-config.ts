// Fusion-owned `plugin-sdk/runtime-config-snapshot` (D-WA-020).
//
// Upstream's QR login reads the process-wide OpenClaw config snapshot to find
// the account it is linking. In Fusion each account's config arrives with its
// start (or its QR verb) from the Hub, so the snapshot is assembled from the
// accounts this process holds: `channels.whatsapp.accounts.<id>` per bound
// account. Only the WhatsApp section exists; nothing else reads it.
import type { OpenClawConfig } from "@clisbot/channels-core/plugin-sdk/config-contracts";

const accountConfigs = new Map<string, Record<string, unknown>>();

export function setWhatsAppAccountRuntimeConfig(
  accountId: string,
  accountConfig: Record<string, unknown> | undefined,
): void {
  if (accountConfig === undefined) accountConfigs.delete(accountId);
  else accountConfigs.set(accountId, accountConfig);
}

/** Upstream `getRuntimeConfig()`: the WhatsApp accounts this Hub process holds. */
export function getRuntimeConfig(): OpenClawConfig {
  return {
    channels: { whatsapp: { accounts: Object.fromEntries(accountConfigs) } },
  } as OpenClawConfig;
}
