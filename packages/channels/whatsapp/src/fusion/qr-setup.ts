// Fusion-owned QR setup verbs (D-WA-026): the Hub's five non-blocking operations
// (`packages/hub/src/channels/supervisor/qr-login.ts`) over upstream's QR login.
//
// Upstream exposes the login as an agent tool and a CLI wizard: `login-qr.ts`'s
// `startWebLoginWithQr` / `waitForWebLogin` (carried verbatim) and
// `auth-store.ts`'s `logoutWeb`. The Hub drives the same state machine from the
// app and polls; this module only translates the answers into the shape the Hub
// projects (`status` / `message` / `qrDataUrl` / `user`). The QR code rotates
// while a login is pending; a poll returns the newest image whenever it changed.
//
// Every verb flushes the encrypted auth directory before it answers, so a
// "linked" the operator sees is already durable.
import { resolveWhatsAppAccount } from "../accounts.js";
import { logoutWeb, readWebSelfId } from "../auth-store.js";
import { startWebLoginWithQr, waitForWebLogin } from "../login-qr.js";
import { stopWhatsAppAccountForUnlink } from "../lifecycle/start-account.js";
import type { HostRuntime } from "@clisbot/channels-shared";
import { accountHostRuntime } from "../runtime-store.js";
import { bindWhatsAppAuthDir, flushWhatsAppAuth } from "./auth-fs.js";
import { getRuntimeConfig } from "./runtime-config.js";
import { defaultRuntime } from "./runtime-env.js";

export type WhatsAppQrStatus = "pending" | "linked" | "failed";

export type WhatsAppQrResult = {
  status: WhatsAppQrStatus;
  message: string;
  qrDataUrl?: string;
  user?: { userId: string; displayName: string };
};

/** Last QR image handed out per account, so a poll can tell a refreshed code. */
const lastQrDataUrl = new Map<string, string>();

function linkedUser(accountId: string): WhatsAppQrResult["user"] {
  const account = resolveWhatsAppAccount({ cfg: getRuntimeConfig(), accountId });
  const self = readWebSelfId(account.authDir);
  const userId = self.e164 ?? self.jid ?? undefined;
  return userId ? { userId, displayName: userId } : undefined;
}

/** Logged in. Upstream's own wording ("Linked!", "already linked") is replaced:
 * the Hub calls QR sign-in Login and keeps "link" for a Channel identity. */
function linked(accountId: string): WhatsAppQrResult {
  lastQrDataUrl.delete(accountId);
  const user = linkedUser(accountId);
  return { status: "linked", message: "Logged in to WhatsApp.", ...(user ? { user } : {}) };
}

/** `start` / `relink`: a QR to scan, an existing link, or why neither. */
export async function startWhatsAppQrLogin(params: {
  accountId: string;
  relink?: boolean;
  timeoutMs?: number;
}): Promise<WhatsAppQrResult> {
  const result = await startWebLoginWithQr({
    accountId: params.accountId,
    force: params.relink === true,
    ...(params.timeoutMs === undefined ? {} : { timeoutMs: params.timeoutMs }),
    runtime: defaultRuntime,
  });
  await flushWhatsAppAuth(params.accountId);
  if (result.connected === true || /already linked/i.test(result.message)) {
    return linked(params.accountId);
  }
  if (result.qrDataUrl) {
    lastQrDataUrl.set(params.accountId, result.qrDataUrl);
    return { status: "pending", message: result.message, qrDataUrl: result.qrDataUrl };
  }
  return { status: "failed", message: result.message };
}

/** `poll`: still waiting (maybe with a refreshed code), linked, or failed. */
export async function pollWhatsAppQrLogin(params: {
  accountId: string;
  timeoutMs?: number;
}): Promise<WhatsAppQrResult> {
  const current = lastQrDataUrl.get(params.accountId);
  const result = await waitForWebLogin({
    accountId: params.accountId,
    timeoutMs: params.timeoutMs ?? 1_000,
    runtime: defaultRuntime,
    ...(current === undefined ? {} : { currentQrDataUrl: current }),
  });
  await flushWhatsAppAuth(params.accountId);
  if (result.connected) return linked(params.accountId);
  if (result.qrDataUrl) {
    lastQrDataUrl.set(params.accountId, result.qrDataUrl);
    return { status: "pending", message: result.message, qrDataUrl: result.qrDataUrl };
  }
  if (/still waiting/i.test(result.message)) {
    return { status: "pending", message: result.message, ...(current ? { qrDataUrl: current } : {}) };
  }
  lastQrDataUrl.delete(params.accountId);
  return { status: "failed", message: result.message };
}

/** `cancel`: abandon a pending code. A linked account is left alone. */
export async function cancelWhatsAppQrLogin(params: {
  accountId: string;
}): Promise<{ cancelled: boolean; message: string }> {
  const pending = lastQrDataUrl.delete(params.accountId);
  return pending
    ? { cancelled: true, message: "WhatsApp login cancelled." }
    : { cancelled: false, message: "No WhatsApp login was waiting for a scan." };
}

/** `logout`: stop the running account, then clear its login from the store. */
export async function logoutWhatsApp(params: {
  accountId: string;
  hostRuntime?: HostRuntime;
}): Promise<{ cleared: boolean; message: string }> {
  lastQrDataUrl.delete(params.accountId);
  const stop = await stopWhatsAppAccountForUnlink(params.accountId);
  // Clearing the keys under a session that is still running would leave it
  // reconnecting on an empty login; nothing is cleared until it has stopped.
  if (!stop.stopped) {
    return {
      cleared: false,
      message: "WhatsApp is still stopping this account. Try Log out again in a moment.",
    };
  }
  if (stop.running) {
    // The stopped account released its auth directory; bind it again to clear it.
    await bindWhatsAppAuthDir({
      accountId: params.accountId,
      hostRuntime: accountHostRuntime(params.accountId, params.hostRuntime),
    });
  }
  const account = resolveWhatsAppAccount({ cfg: getRuntimeConfig(), accountId: params.accountId });
  const cleared = await logoutWeb({
    authDir: account.authDir,
    isLegacyAuthDir: false,
    runtime: defaultRuntime,
  });
  await flushWhatsAppAuth(params.accountId);
  if (!cleared) return { cleared: false, message: "No WhatsApp login was stored." };
  if (stop.running && !stop.toldWhatsApp) {
    // The account was between connections, so WhatsApp could not be asked to
    // drop the device; the phone keeps listing it until it is removed there.
    return {
      cleared: true,
      message:
        "Logged out and cleared the login. WhatsApp was reconnecting, so remove this device under Linked devices on the phone.",
    };
  }
  return { cleared: true, message: "Logged out of WhatsApp and cleared the login." };
}
