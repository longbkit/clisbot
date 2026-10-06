// L4 account lifecycle (D-WA-027): bind the encrypted auth directory, refuse an
// unlinked account, register the L3 inbound processor, then run the L2 listener
// session until `ctx.abortSignal` fires — "start" is the transport lifetime.
//
// Upstream's equivalent is `channel.ts`'s gateway `startAccount` →
// `auto-reply/monitor.ts` `monitorWebChannel`. Its agent half is the Hub's; its
// transport half is `fusion/listener-session.ts`.
//
// ONE BEHAVIOUR CHANGE: an account with no login FAILS the start, with "is not
// logged in" in the message. Upstream lets the monitor wait and prints a CLI hint;
// the Hub supervisor turns this failure into `needs-login`, which is how the app
// learns to offer the QR code instead of a retry loop.
import type { HostRuntime, StartAccountContext } from "@clisbot/channels-shared";
import { readWebAuthExistsForDecision, readWebSelfId } from "../auth-store.js";
import { accountSection, resolveWhatsAppDriveAccount } from "../fusion/account-config.js";
import { bindWhatsAppAuthDir, unbindWhatsAppAuthDir } from "../fusion/auth-fs.js";
import {
  startWhatsAppListenerSession,
  WhatsAppNotLinkedError,
  type WhatsAppLiveSessionControl,
} from "../fusion/listener-session.js";
import { openWhatsAppPollStore } from "../fusion/polls.js";
import { openWhatsAppCardStore } from "../fusion/reaction-cards.js";
import { clearWhatsAppQuotes } from "../fusion/quotes.js";
import { setWhatsAppAccountRuntimeConfig } from "../fusion/runtime-config.js";
import {
  registerAccountInbound,
  rememberAccountHostRuntime,
  unregisterAccountInbound,
} from "../runtime-store.js";

/** Running accounts: their session control and a promise settled once fully stopped. */
const liveAccounts = new Map<
  string,
  { control?: WhatsAppLiveSessionControl; stopped: Promise<void> }
>();
const UNLINK_STEP_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms).unref?.()),
  ]);
}

/** What stopping an account for Log out achieved. */
export interface WhatsAppLogoutStop {
  /** An account was running. */
  running: boolean;
  /** It has stopped and released its auth directory; only then may its keys be cleared. */
  stopped: boolean;
  /** WhatsApp was asked to remove the linked device (needs a live socket). */
  toldWhatsApp: boolean;
}

/**
 * Log out, upstream's order (`openclaw channels logout` stops the live listener
 * before clearing auth): ask WhatsApp to remove this linked device when a socket
 * is up, end the session as logged out — whether it is connected, connecting or
 * waiting to reconnect — and wait until it has stopped and released its auth
 * directory. The account start then fails with "is not logged in" and the Hub
 * parks it in `needs-login`.
 */
export async function stopWhatsAppAccountForUnlink(accountId: string): Promise<WhatsAppLogoutStop> {
  const live = liveAccounts.get(accountId);
  if (!live) return { running: false, stopped: true, toldWhatsApp: false };
  const sock = live.control?.getSock();
  const toldWhatsApp = sock
    ? (await withTimeout(sock.logout().then(() => true, () => false), UNLINK_STEP_TIMEOUT_MS)) === true
    : false;
  live.control?.forceLoggedOut();
  const stopped = (await withTimeout(live.stopped.then(() => true), UNLINK_STEP_TIMEOUT_MS)) === true;
  return { running: true, stopped, toldWhatsApp };
}

/** True when the stored creds carry the linked device's own identity. */
async function isLinked(authDir: string): Promise<boolean> {
  const auth = await readWebAuthExistsForDecision(authDir);
  if (auth.outcome !== "stable" || !auth.exists) return false;
  return readWebSelfId(authDir).jid !== null;
}

/** `plugin.gateway.startAccount` — the drive surface entry. Resolves on abort. */
export async function startWhatsAppAccount(
  ctx: StartAccountContext,
  hostRuntime: HostRuntime,
): Promise<void> {
  if (ctx.cfg === undefined || ctx.cfg === null) {
    throw new Error("whatsapp startAccount requires a runtime config (ctx.cfg)");
  }
  const { accountId, abortSignal } = ctx;
  const { cfg, account } = resolveWhatsAppDriveAccount(ctx);
  setWhatsAppAccountRuntimeConfig(accountId, accountSection(cfg, accountId));
  rememberAccountHostRuntime(accountId, hostRuntime);
  await bindWhatsAppAuthDir({ accountId, hostRuntime });
  if (!(await isLinked(account.authDir))) {
    await unbindWhatsAppAuthDir(accountId);
    throw new WhatsAppNotLinkedError(accountId, "no WhatsApp login is stored");
  }
  const inbound = registerAccountInbound(accountId, hostRuntime);
  let markStopped = () => {};
  const live: { control?: WhatsAppLiveSessionControl; stopped: Promise<void> } = {
    stopped: new Promise<void>((resolve) => {
      markStopped = resolve;
    }),
  };
  liveAccounts.set(accountId, live);
  ctx.log?.info?.(`[${accountId}] starting WhatsApp provider mode=linked-device`);
  ctx.setStatus({ state: "connecting", accountId, mode: "linked-device" });
  try {
    await startWhatsAppListenerSession({
      cfg,
      account,
      admit: (event) => inbound.handleInbound(event),
      polls: openWhatsAppPollStore(hostRuntime),
      cards: openWhatsAppCardStore(hostRuntime),
      ...(typeof ctx.mediaDownloadDir === "string" && ctx.mediaDownloadDir !== ""
        ? { mediaDownloadDir: ctx.mediaDownloadDir }
        : {}),
      abortSignal,
      ...(ctx.log === undefined ? {} : { logger: ctx.log }),
      setStatus: (patch) => ctx.setStatus({ accountId, ...patch }),
      onLive: (control) => {
        live.control = control;
      },
    });
  } finally {
    unregisterAccountInbound(accountId, hostRuntime);
    clearWhatsAppQuotes(accountId);
    await unbindWhatsAppAuthDir(accountId).catch(() => undefined);
    setWhatsAppAccountRuntimeConfig(accountId, undefined);
    if (liveAccounts.get(accountId) === live) liveAccounts.delete(accountId);
    markStopped();
    ctx.setStatus({ state: "stopped", accountId });
  }
}
