// Fusion-owned account-carrier boundary (D-FS-012).
//
// Upstream resolves a Feishu account out of OpenClaw's process-wide
// `config.json` (`channels.feishu` plus `channels.feishu.accounts.<id>`, with
// `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_VERIFICATION_TOKEN` /
// `FEISHU_ENCRYPT_KEY` as env fallbacks). In Fusion the Hub supervisor owns
// configuration and credentials: it compiles the account's config revision and
// hands the vertical two carriers on every drive call — the flat `ctx.account`
// and the `cfg.channels.feishu.accounts.<id>` entry
// (`packages/hub/src/channels/supervisor/account-carriers.ts`). This module is
// the one place that reads those carrier field names, so the Hub wiring slice
// has a single file to match (see `HUB-WIRING.md`).
//
// The ported `accounts.ts` keeps its upstream shape and flow; it just reads the
// carrier instead of the OpenClaw config file. The env fallbacks are NOT
// carried: a Hub process serves every organization, so an ambient
// `FEISHU_APP_SECRET` would leak one tenant's app into another's account.
import type { StartAccountContext } from "@getpaseo/channels-shared";
import { resolveFeishuAccount } from "../accounts.js";
import type { OpenClawConfig as ClawdbotConfig } from "./runtime-api.js";
import type { ResolvedFeishuAccount } from "../types.js";

/** The credential fields the Hub connection carries onto the account entry. */
export interface FeishuConnectionCredentials {
  /** The Lark custom-app id (`cli_…`). */
  appId?: string;
  /** The Lark custom-app secret. */
  appSecret?: string;
  /** Event-subscription verification token (webhook mode). */
  verificationToken?: string;
  /** Event-subscription encrypt key (webhook mode; also signs the request). */
  encryptKey?: string;
  /** `feishu` (open.feishu.cn) or `lark` (open.larksuite.com). */
  domain?: string;
  /** `websocket` (long connection) or `webhook` (event subscription). */
  connectionMode?: string;
}

const CREDENTIAL_FIELDS = [
  "appId",
  "appSecret",
  "verificationToken",
  "encryptKey",
  "domain",
  "connectionMode",
] as const;

/**
 * The account the drive call is for. Reads `ctx.cfg` first (the Hub's compiled
 * `cfg.channels.feishu.accounts.<id>`); the flat `ctx.account` carrier is folded
 * in so a connection credential always wins over authored config, the same
 * precedence the Discord, Google Chat and Telegram carriers use.
 */
export function resolveFeishuDriveAccount(
  ctx: Pick<StartAccountContext, "accountId" | "account" | "cfg">,
): ResolvedFeishuAccount {
  return resolveFeishuAccount({
    cfg: mergeAccountCarrier(ctx.cfg as unknown as ClawdbotConfig, ctx.accountId, ctx.account),
    accountId: ctx.accountId,
  });
}

/** Folds the flat carrier's credential fields onto the config entry. */
export function mergeAccountCarrier(
  cfg: ClawdbotConfig,
  accountId: string,
  account: Record<string, unknown> | undefined,
): ClawdbotConfig {
  const credentials = readConnectionCredentials(account);
  if (credentials === undefined) return cfg;
  const section = (cfg.channels?.feishu ?? {}) as Record<string, unknown>;
  const accounts = (section["accounts"] ?? {}) as Record<string, Record<string, unknown>>;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      feishu: {
        ...section,
        accounts: {
          ...accounts,
          [accountId]: { ...accounts[accountId], ...credentials },
        },
      },
    },
  } as ClawdbotConfig;
}

function readConnectionCredentials(
  account: Record<string, unknown> | undefined,
): FeishuConnectionCredentials | undefined {
  if (account === undefined) return undefined;
  const credentials: FeishuConnectionCredentials = {};
  for (const field of CREDENTIAL_FIELDS) {
    const value = account[field];
    if (typeof value === "string" && value.trim() !== "") {
      credentials[field] = value;
    }
  }
  return Object.keys(credentials).length > 0 ? credentials : undefined;
}
