// L4 account lifecycle (blueprint §6.5 L4): resolve the account and its app
// credentials, install the account's ported plugin runtime, probe the bot
// identity, register the L3 inbound processor, then hand off to the L2 transport
// the account is configured for. The startAccount promise resolves only when
// `ctx.abortSignal` fires — "start" is the transport lifetime.
//
// Upstream's equivalent is `monitor.ts` + `monitor.account.ts`: they fan out
// over every enabled account in the process config, open a SQLite ingress queue
// and run OpenClaw's passive account lifecycle with its own reply engine. The
// Hub owns routing, the queue, the agent and the lifecycle, so the L4 here does
// only what the seam contract asks (D-FS-019).

import type { HostRuntime, StartAccountContext } from "@getpaseo/channels-shared";
import { resolveFeishuDriveAccount } from "../fusion/account-config.js";
import type { FeishuAdmissionOptions } from "../fusion/admission.js";
import { setFeishuMediaDownloadDir } from "../fusion/media-resource.js";
import { installFeishuRuntime } from "../fusion/runtime.js";
import type { FeishuStatusSink } from "../fusion/status-sink.js";
import { startFeishuWsSession } from "../fusion/ws-session.js";
import {
  resolveFeishuConnectionMode,
  startFeishuWebhookSession,
} from "../fusion/webhook-session.js";
import { fetchBotIdentityForMonitor } from "../monitor.startup.js";
import { registerAccountInbound, unregisterAccountInbound } from "../runtime-store.js";

/** `plugin.gateway.startAccount` — the drive surface entry. Resolves on abort. */
export async function startFeishuAccount(
  ctx: StartAccountContext,
  hostRuntime: HostRuntime,
): Promise<void> {
  const log = ctx.log;
  const { accountId, abortSignal } = ctx;
  if (ctx.cfg === undefined || ctx.cfg === null) {
    throw new Error("feishu startAccount requires a runtime config (ctx.cfg)");
  }
  const account = resolveFeishuDriveAccount(ctx);
  if (!account.appId || !account.appSecret) {
    throw new Error(
      `feishu account "${accountId}" has no usable app credential (appId/appSecret missing or still an unresolved secret reference)`,
    );
  }
  const mode = resolveFeishuConnectionMode(account);
  if (mode === "webhook" && !account.encryptKey?.trim()) {
    // The ported transport signs every request with the encrypt key, so an
    // account without one cannot authenticate ANY delivery. Fail the start
    // instead of listening on a route that refuses everything.
    throw new Error(
      `feishu account "${accountId}" is in webhook mode but has no encryptKey; no inbound request could be verified`,
    );
  }

  installFeishuRuntime(hostRuntime, accountId);
  // Group G: inbound media downloads land in the account's own directory
  // (`<dataDir>/channels/<accountId>/downloads`, filled by the Hub supervisor).
  // Without this the ported download path falls back to `os.tmpdir()`, where a
  // Lark attachment is world-readable and outlives the turn.
  setFeishuMediaDownloadDir(accountId, resolveMediaDownloadDir(ctx));
  const statusSink: FeishuStatusSink = (patch) => ctx.setStatus({ accountId, ...patch });
  const runtime = {
    log: (...args: unknown[]) => log?.info?.(args.map(String).join(" ")),
    error: (...args: unknown[]) => log?.error?.(args.map(String).join(" ")),
    exit: () => {},
  };

  // The identity probe is a real Lark API call, so a bad credential fails the
  // account start instead of failing every later delivery silently. It also
  // supplies the bot's own open_id, which the normalizer needs to tell an
  // addressed message from an ambient one and to drop the bot's own echo.
  const identity = await fetchBotIdentityForMonitor(account, { runtime, abortSignal });
  if (!identity.botOpenId) {
    unregisterAccountInbound(accountId, hostRuntime);
    throw new Error(
      `feishu: bot identity probe failed for account "${accountId}" (no provider-verified open_id)`,
    );
  }

  const inbound = registerAccountInbound(accountId, identity.botOpenId, hostRuntime);
  const admission: FeishuAdmissionOptions = {
    accountId,
    botOpenId: identity.botOpenId,
    ...(account.config.allowBots === undefined ? {} : { allowBots: account.config.allowBots }),
    handleInbound: (event: Parameters<typeof inbound.handleInbound>[0]) =>
      inbound.handleInbound(event),
    ...(log === undefined ? {} : { logger: log }),
  };

  log?.info?.("feishu account started", { accountId, mode, botOpenId: identity.botOpenId });
  ctx.setStatus({ state: "connected", accountId, mode, botOpenId: identity.botOpenId });
  try {
    if (mode === "webhook") {
      await startFeishuWebhookSession({
        account,
        accountId,
        admission,
        abortSignal,
        runtime,
        statusSink,
        ...(log === undefined ? {} : { logger: log }),
      });
    } else {
      await startFeishuWsSession({
        account,
        accountId,
        admission,
        abortSignal,
        runtime,
        statusSink,
        ...(log === undefined ? {} : { logger: log }),
      });
    }
  } finally {
    unregisterAccountInbound(accountId, hostRuntime);
    setFeishuMediaDownloadDir(accountId, undefined);
    ctx.setStatus({ state: "stopped", accountId });
  }
}

/** The account's inbound-media download dir, as the Hub supervisor supplies it.
 * `undefined` → the ported resolver's process-temp fallback (unit posture). */
function resolveMediaDownloadDir(ctx: StartAccountContext): string | undefined {
  return typeof ctx.mediaDownloadDir === "string" && ctx.mediaDownloadDir !== ""
    ? ctx.mediaDownloadDir
    : undefined;
}
