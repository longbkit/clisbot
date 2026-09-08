// Fusion-owned account-carrier boundary (D-GC-007).
//
// Upstream resolves a Google Chat account out of OpenClaw's process-wide
// `config.json` (`channels.googlechat.accounts.<id>` plus the
// `GOOGLE_CHAT_SERVICE_ACCOUNT*` env vars). In Fusion the Hub supervisor owns
// configuration and credentials: it compiles the account's config revision and
// hands the vertical two carriers on every drive call — the flat `ctx.account`
// and the `cfg.channels.googlechat.accounts.<id>` entry
// (`packages/hub/src/channels/supervisor/account-carriers.ts`). This module is
// the one place that reads those carrier field names, so the Hub wiring slice
// has a single file to match (see `HUB-WIRING.md`).
//
// The ported `accounts.ts` keeps its upstream shape and flow; it just reads the
// carrier instead of the OpenClaw config file.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import type { StartAccountContext } from "@getpaseo/channels-shared";
import { resolveGoogleChatAccount, type ResolvedGoogleChatAccount } from "../accounts.js";

/** The credential fields the Hub connection carries onto the account entry. */
export interface GoogleChatConnectionCredentials {
  /** Service-account JSON, inline (a JSON string or an already-parsed object). */
  serviceAccount?: string | Record<string, unknown>;
  /** Absolute path to a service-account JSON file, when the operator uses one. */
  serviceAccountFile?: string;
}

/**
 * The account the drive call is for. Reads `ctx.cfg` first (the Hub's compiled
 * `cfg.channels.googlechat.accounts.<id>`); the flat `ctx.account` carrier is
 * folded in so a connection credential always wins over authored config, the
 * same precedence the Discord and Telegram carriers use.
 */
export function resolveGoogleChatDriveAccount(
  ctx: Pick<StartAccountContext, "accountId" | "account" | "cfg">,
): ResolvedGoogleChatAccount {
  return resolveGoogleChatAccount({
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
  const section = cfg.channels?.googlechat ?? {};
  const accounts = section.accounts ?? {};
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      googlechat: {
        ...section,
        accounts: {
          ...accounts,
          [accountId]: { ...accounts[accountId], ...credentials },
        },
      },
    },
  };
}

function readConnectionCredentials(
  account: Record<string, unknown> | undefined,
): GoogleChatConnectionCredentials | undefined {
  if (account === undefined) return undefined;
  const serviceAccount = account["serviceAccount"];
  const serviceAccountFile = account["serviceAccountFile"];
  const credentials: GoogleChatConnectionCredentials = {};
  if (typeof serviceAccount === "string" && serviceAccount.trim() !== "") {
    credentials.serviceAccount = serviceAccount;
  } else if (serviceAccount !== null && typeof serviceAccount === "object") {
    credentials.serviceAccount = serviceAccount as Record<string, unknown>;
  }
  if (typeof serviceAccountFile === "string" && serviceAccountFile.trim() !== "") {
    credentials.serviceAccountFile = serviceAccountFile;
  }
  return Object.keys(credentials).length > 0 ? credentials : undefined;
}
