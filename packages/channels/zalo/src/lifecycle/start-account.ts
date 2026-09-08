// L4 account lifecycle (blueprint §6.5 L4, start-account.md): resolve the
// account and its bot token, probe the identity, register the L3 inbound
// processor, then hand off to the L2 session — webhook when the account
// configures a `webhookUrl`, long polling otherwise (upstream's own mode rule,
// `accounts.ts` `inspectZaloAccount`). The startAccount promise resolves only
// when `ctx.abortSignal` fires — "start" is the transport lifetime.
//
// Upstream's equivalent is `channel.runtime.ts`'s `startZaloGatewayAccount` plus
// `monitor.ts`'s `monitorZaloProvider`. Carried from them: the pre-start probe
// (with its warn-but-continue rule and the bot name in the start line), the
// mode split, the webhook preconditions and the status patches. The OpenClaw
// pieces — the gateway HTTP route, the SQLite ingress queue, the pairing
// controller, the reply pipeline and the hosted-media route — are Hub-owned
// (D-ZL-018).

import type { HostRuntime, StartAccountContext } from "@getpaseo/channels-shared";
import { probeZalo } from "../probe.js";
import { resolveZaloProxyFetch } from "../proxy.js";
import { normalizeSecretInputString } from "../secret-input.js";
import { createZaloAdmission } from "../fusion/admission.js";
import { resolveZaloDriveAccount } from "../fusion/account-config.js";
import { startZaloPollingSession } from "../fusion/polling-session.js";
import { resolveZaloWebhookMode, startZaloWebhookSession } from "../fusion/webhook-session.js";
import type { OpenClawConfig } from "../runtime-api.js";
import { registerAccountInbound, unregisterAccountInbound } from "../runtime-store.js";

function resolveMediaDownloadDir(ctx: StartAccountContext): string | undefined {
  return typeof ctx.mediaDownloadDir === "string" && ctx.mediaDownloadDir !== ""
    ? ctx.mediaDownloadDir
    : undefined;
}

/** `plugin.gateway.startAccount` — the drive surface entry. Resolves on abort. */
export async function startZaloAccount(
  ctx: StartAccountContext,
  hostRuntime: HostRuntime,
): Promise<void> {
  const log = ctx.log;
  const { accountId, abortSignal } = ctx;
  if (ctx.cfg === undefined || ctx.cfg === null) {
    throw new Error("zalo startAccount requires a runtime config (ctx.cfg)");
  }
  const account = resolveZaloDriveAccount(ctx);
  const token = account.token.trim();
  if (token === "") {
    throw new Error(
      `zalo account "${accountId}" has no usable bot token (source=${account.tokenSource}, status=${account.tokenStatus ?? "unknown"})`,
    );
  }
  const fetcher = resolveZaloProxyFetch(account.config.proxy);
  // The identity probe is a real Bot API call, so a bad token fails the account
  // start instead of failing every later delivery silently. Upstream only warns
  // here; Fusion's supervisor has no other place to learn the token is dead.
  const probe = await probeZalo(token, 5000, fetcher);
  if (!probe.ok) {
    throw new Error(`zalo: bot token probe failed: ${probe.error ?? "unknown error"}`);
  }
  const botName = probe.bot?.account_name?.trim();
  const inbound = registerAccountInbound(accountId, probe.bot?.id, hostRuntime);
  const downloadDir = resolveMediaDownloadDir(ctx);
  const admission = createZaloAdmission({
    accountId,
    ...(probe.bot?.id === undefined ? {} : { botId: probe.bot.id }),
    botNames: [botName, ...readConfiguredBotNames(account.config)].filter(
      (value): value is string => typeof value === "string" && value !== "",
    ),
    ...(downloadDir === undefined ? {} : { downloadDir }),
    ...(account.config.mediaMaxMb === undefined ? {} : { mediaMaxMb: account.config.mediaMaxMb }),
    ...(log === undefined ? {} : { logger: log }),
    abortSignal,
    handleInbound: (event) => inbound.handleInbound(event),
  });
  const webhook = resolveZaloWebhookMode(account.config);
  const mode = webhook === null ? "polling" : "webhook";
  log?.info?.(`[${accountId}] starting provider${botName ? ` (${botName})` : ""} mode=${mode}`);
  ctx.setStatus({ state: "connected", accountId, mode, ...(probe.bot ? { bot: probe.bot } : {}) });
  try {
    if (webhook === null) {
      await startZaloPollingSession({
        token,
        accountId,
        admission,
        abortSignal,
        ...(fetcher === undefined ? {} : { fetcher }),
        ...(log === undefined ? {} : { logger: log }),
        setStatus: (patch) => ctx.setStatus({ accountId, ...patch }),
      });
      return;
    }
    const webhookSecret = normalizeSecretInputString(account.config.webhookSecret) ?? "";
    if (webhookSecret === "") {
      throw new Error(
        `zalo account "${accountId}" is in webhook mode but has no webhookSecret; Zalo signs every delivery with it and an unverifiable request must be refused`,
      );
    }
    await startZaloWebhookSession({
      account,
      cfg: ctx.cfg as unknown as OpenClawConfig,
      token,
      webhook,
      webhookSecret,
      admission,
      abortSignal,
      runtime: {
        ...(log?.info === undefined ? {} : { log: (message: string) => log.info?.(message) }),
        ...(log?.error === undefined ? {} : { error: (message: string) => log.error?.(message) }),
      },
      ...(log === undefined ? {} : { logger: log }),
      ...(fetcher === undefined ? {} : { fetcher }),
      setStatus: (patch) => ctx.setStatus({ accountId, ...patch }),
    });
  } finally {
    unregisterAccountInbound(accountId, hostRuntime);
    ctx.setStatus({ state: "stopped", accountId });
  }
}

/** Operator-configured mention aliases, when the account names any. The Bot API
 * carries no mention annotation, so these are what a group message is matched
 * against besides the bot's own `account_name` (`fusion/inbound-adapter.ts`). */
function readConfiguredBotNames(config: Record<string, unknown>): string[] {
  const names = config["botNames"];
  if (!Array.isArray(names)) return [];
  return names.filter((value): value is string => typeof value === "string");
}
