// upstream: extensions/telegram/src/token.ts@5d8067a4483
// D-TG-029: credential resolution is a Fusion boundary. Upstream reads the
// OpenClaw config graph through `openclaw/plugin-sdk/account-core`, resolves
// `tokenFile` with `tryReadSecretFileSync` (symlink rejection, diagnostics) and
// resolves `SecretRef` values against `secrets.providers` / `secrets.defaults`.
// Fusion's Hub owns channel credentials: the drive-time `cfg` a vertical is
// handed already carries the resolved `channels.telegram[.accounts.<id>]` block,
// and `./account-inspect.ts` (D-TG-010) already implements upstream's precedence
// decisions against it — account tokenFile → account botToken → channel tokenFile
// → channel botToken → env for the default account, with the multi-account
// fallback rule. This module keeps upstream's `resolveTelegramToken` signature
// and result shape and answers from that inspection, so every ported caller is
// unchanged. `credentialDiagnostics` has no Fusion producer and is not carried.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { inspectTelegramAccount } from "./account-inspect.js";

type TelegramTokenSource = "env" | "tokenFile" | "config" | "none";

export type TelegramTokenResolution = {
  token: string;
  source: TelegramTokenSource;
};

type ResolveTelegramTokenOpts = {
  envToken?: string | null;
  accountId?: string | null;
  logMissingFile?: (message: string) => void;
};

export function resolveTelegramToken(
  cfg?: OpenClawConfig,
  opts: ResolveTelegramTokenOpts = {},
): TelegramTokenResolution {
  if (!cfg) {
    return { token: "", source: "none" };
  }
  const account = inspectTelegramAccount({
    cfg,
    accountId: opts.accountId ?? null,
    envToken: opts.envToken ?? null,
  });
  if (account.tokenStatus === "configured_unavailable") {
    opts.logMissingFile?.(
      `channels.telegram: the ${account.accountId} bot token is configured but unavailable`,
    );
    // Upstream reports the source it failed to read so callers can name it.
    return { token: "", source: account.tokenSource === "tokenFile" ? "tokenFile" : "none" };
  }
  return { token: account.token, source: account.tokenSource };
}
