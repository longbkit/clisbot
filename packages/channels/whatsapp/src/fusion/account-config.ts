// Fusion-owned account carrier reader (D-WA-025).
//
// Upstream resolves a WhatsApp account from OpenClaw's config file
// (`accounts.ts` `resolveWhatsAppAccount`, carried verbatim). The Hub hands the
// account two ways (`packages/hub/src/channels/supervisor/account-carriers.ts`):
// the flat carrier on `ctx.account` and the compiled section under
// `cfg.channels.whatsapp.accounts.<id>`. This module folds the carrier over the
// compiled entry so a Connection field wins, and it is the single place that
// decides the account's auth directory: always the account's virtual directory
// in the encrypted store (`fusion/auth-fs.ts`). An authored `authDir` would
// point Baileys at a real path on the Hub's disk, so it is replaced, not merged.
import type { StartAccountContext } from "@clisbot/channels-shared";
import type { OpenClawConfig } from "@clisbot/channels-core/plugin-sdk/config-contracts";
import { resolveWhatsAppAccount, type ResolvedWhatsAppAccount } from "../accounts.js";
import { whatsAppAuthDirFor } from "./auth-fs.js";

/** The carrier fields the Hub sends for a WhatsApp account. */
const CARRIER_FIELDS = ["name"] as const;

function carrierFields(account: Record<string, unknown> | undefined): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of CARRIER_FIELDS) {
    const value = account?.[key];
    if (typeof value === "string" && value.trim() !== "") fields[key] = value.trim();
  }
  return fields;
}

/** `cfg` with this account's carrier folded in and its auth dir pinned. */
export function mergeAccountCarrier(
  cfg: OpenClawConfig | undefined,
  accountId: string,
  account?: Record<string, unknown>,
): OpenClawConfig {
  const base = cfg ?? ({} as OpenClawConfig);
  const section = base.channels?.whatsapp ?? {};
  const accounts = section.accounts ?? {};
  return {
    ...base,
    channels: {
      ...base.channels,
      whatsapp: {
        ...section,
        accounts: {
          ...accounts,
          [accountId]: {
            ...accounts[accountId],
            ...carrierFields(account),
            authDir: whatsAppAuthDirFor(accountId),
          },
        },
      },
    },
  } as OpenClawConfig;
}

/** The account the start context describes, resolved by upstream's reader. */
export function resolveWhatsAppDriveAccount(ctx: StartAccountContext): {
  cfg: OpenClawConfig;
  account: ResolvedWhatsAppAccount;
} {
  const cfg = mergeAccountCarrier(ctx.cfg as OpenClawConfig, ctx.accountId, ctx.account);
  return { cfg, account: resolveWhatsAppAccount({ cfg, accountId: ctx.accountId }) };
}

/** The compiled section of one account, for the runtime-config snapshot. */
export function accountSection(cfg: OpenClawConfig, accountId: string): Record<string, unknown> {
  return (cfg.channels?.whatsapp?.accounts?.[accountId] ?? {}) as Record<string, unknown>;
}
