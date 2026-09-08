// Fusion-owned account-carrier boundary (D-ZL-008).
//
// Upstream resolves a Zalo account out of OpenClaw's process-wide `config.json`
// (`channels.zalo.accounts.<id>` plus `ZALO_BOT_TOKEN`). In Fusion the Hub
// supervisor owns configuration and credentials: it compiles the account's
// config revision and hands the vertical two carriers on every drive call — the
// flat `ctx.account` and the `cfg.channels.zalo.accounts.<id>` entry
// (`packages/hub/src/channels/supervisor/account-carriers.ts`). This module is
// the one place that reads those carrier field names, so the Hub wiring slice
// has a single file to match (see `HUB-WIRING.md`).
//
// The ported `accounts.ts` / `token.ts` keep their upstream shape and flow; they
// just read the carrier instead of the OpenClaw config file.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import type { StartAccountContext } from "@getpaseo/channels-shared";
import { resolveZaloAccount, type ResolvedZaloAccount } from "../accounts.js";

/** The credential fields the Hub connection carries onto the account entry. */
export interface ZaloConnectionCredentials {
  /** The Zalo Bot API token, from the connection's credential envelope. */
  botToken?: string;
  /** The webhook secret token (8–256 chars) Zalo signs deliveries with. */
  webhookSecret?: string;
}

/**
 * The account the drive call is for. Reads `ctx.cfg` first (the Hub's compiled
 * `cfg.channels.zalo.accounts.<id>`); the flat `ctx.account` carrier is folded
 * in so a connection credential always wins over authored config, the same
 * precedence the Discord, Telegram and Google Chat carriers use.
 */
export function resolveZaloDriveAccount(
  ctx: Pick<StartAccountContext, "accountId" | "account" | "cfg">,
): ResolvedZaloAccount {
  return resolveZaloAccount({
    cfg: mergeAccountCarrier(ctx.cfg as unknown as OpenClawConfig, ctx.accountId, ctx.account),
    accountId: ctx.accountId,
  });
}

/** Folds the flat carrier's credential fields onto the config entry. */
export function mergeAccountCarrier(
  cfg: OpenClawConfig,
  accountId: string,
  account: Record<string, unknown> | undefined,
): OpenClawConfig {
  const credentials = readConnectionCredentials(account);
  if (credentials === undefined) return cfg;
  const section = (cfg.channels?.zalo ?? {}) as Record<string, unknown>;
  const accounts = (section["accounts"] ?? {}) as Record<string, Record<string, unknown>>;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      zalo: {
        ...section,
        accounts: {
          ...accounts,
          [accountId]: { ...accounts[accountId], ...credentials },
        },
      },
    },
  } as OpenClawConfig;
}

/** `token` is the flat carrier's name (Telegram/Discord spelling); `botToken`
 * is the config entry's name. Both are accepted so the Hub wiring slice can use
 * either without a second reader appearing somewhere else. */
function readConnectionCredentials(
  account: Record<string, unknown> | undefined,
): ZaloConnectionCredentials | undefined {
  if (account === undefined) return undefined;
  const credentials: ZaloConnectionCredentials = {};
  const token = account["token"] ?? account["botToken"];
  if (typeof token === "string" && token.trim() !== "") credentials.botToken = token;
  const webhookSecret = account["webhookSecret"];
  if (typeof webhookSecret === "string" && webhookSecret.trim() !== "") {
    credentials.webhookSecret = webhookSecret;
  }
  return Object.keys(credentials).length > 0 ? credentials : undefined;
}
