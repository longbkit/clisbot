// Fusion-owned account-carrier boundary (D-ZU-012).
//
// Upstream resolves a Zalo Personal account out of OpenClaw's process-wide
// `config.json` (`channels.zalouser.accounts.<id>` plus `ZALOUSER_PROFILE` /
// `ZCA_PROFILE`). In Fusion the Hub supervisor owns configuration and hands the
// vertical two carriers on every drive call — the flat `ctx.account` and the
// `cfg.channels.zalouser.accounts.<id>` entry
// (`packages/hub/src/channels/supervisor/account-carriers.ts`). This module is
// the one place that reads those carrier field names, so the Hub wiring slice
// has a single file to match (see `HUB-WIRING.md` §5).
//
// The credential here is NOT a token. A Zalo Personal account is identified by
// its `profile`, and the session bytes behind that profile live in the injected
// session store (`fusion/session-store.ts`, HUB-WIRING.md §6). The carrier
// therefore selects the profile; it never carries a secret.
//
// The ported `accounts.ts` keeps its upstream shape and flow; it just reads the
// merged carrier instead of the OpenClaw config file.

import type { StartAccountContext } from "@getpaseo/channels-shared";
import { resolveZalouserAccountSync } from "../accounts.js";
import type { OpenClawConfig } from "../runtime-api.js";
import type { ResolvedZalouserAccount } from "../types.js";

/** The account fields the Hub connection carries onto the account entry. */
export interface ZalouserConnectionCarrier {
  /** The credential profile the QR session is stored under. */
  profile?: string;
  /** Operator label for the linked Zalo account. */
  name?: string;
}

/** The account the drive call is for. Reads `ctx.cfg` first (the Hub's compiled
 * `cfg.channels.zalouser.accounts.<id>`); the flat `ctx.account` carrier is
 * folded in so a connection field always wins over authored config, the same
 * precedence the Discord, Telegram, Google Chat and Zalo carriers use. */
export function resolveZalouserDriveAccount(
  ctx: Pick<StartAccountContext, "accountId" | "account" | "cfg">,
): ResolvedZalouserAccount {
  return resolveZalouserAccountSync({
    cfg: mergeAccountCarrier(ctx.cfg as unknown as OpenClawConfig, ctx.accountId, ctx.account),
    accountId: ctx.accountId,
  });
}

/** Folds the flat carrier's fields onto the config entry. */
export function mergeAccountCarrier(
  cfg: OpenClawConfig,
  accountId: string,
  account: Record<string, unknown> | undefined,
): OpenClawConfig {
  const carrier = readConnectionCarrier(account);
  if (carrier === undefined) return cfg;
  const section = (cfg.channels?.zalouser ?? {}) as Record<string, unknown>;
  const accounts = (section["accounts"] ?? {}) as Record<string, Record<string, unknown>>;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      zalouser: {
        ...section,
        accounts: {
          ...accounts,
          [accountId]: { ...accounts[accountId], ...carrier },
        },
      },
    },
  } as OpenClawConfig;
}

/** `profile` is the carrier's name for the credential profile; `zcaProfile` is
 * accepted as the spelling the Hub connection may use for the same value, so a
 * second reader never appears somewhere else. */
function readConnectionCarrier(
  account: Record<string, unknown> | undefined,
): ZalouserConnectionCarrier | undefined {
  if (account === undefined) return undefined;
  const carrier: ZalouserConnectionCarrier = {};
  const profile = account["profile"] ?? account["zcaProfile"];
  if (typeof profile === "string" && profile.trim() !== "") carrier.profile = profile.trim();
  const name = account["name"];
  if (typeof name === "string" && name.trim() !== "") carrier.name = name.trim();
  return Object.keys(carrier).length > 0 ? carrier : undefined;
}
