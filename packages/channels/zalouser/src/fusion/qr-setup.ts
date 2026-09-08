// Fusion-owned QR setup surface (D-ZU-016).
//
// A Zalo Personal account is linked by scanning a QR code with a phone. There
// is no token an operator can paste, so onboarding is a LIVE, MULTI-STEP flow
// and the Hub/app needs verbs it can drive, not a wizard that owns a terminal.
//
// Upstream's driver is `channel.adapters.ts` `zalouserAuthAdapter.login`: it
// calls `startZaloQrLogin`, writes the PNG to a temp file, prints the path and
// then blocks in `waitForZaloQrLogin` for up to three minutes. That shape is a
// CLI's. This module keeps upstream's state machine — the same
// `startZaloQrLogin` / `waitForZaloQrLogin` / `logoutZaloProfile` in
// `zalo-js.ts`, unchanged — and exposes it as five non-blocking operations the
// Hub can call from an RPC (HUB-WIRING.md §7):
//
//   start   — begin (or re-attach to) a QR login; returns the PNG data URL.
//   poll    — one bounded wait; returns pending / linked / failed.
//   cancel  — abandon the pending QR without touching a stored session.
//   relink  — start over, discarding the stored session first (upstream's
//             `force`, which logs out before generating a fresh QR).
//   logout  — clear the session and leave a durable revocation marker.
//
// The state machine itself is upstream's and is not re-implemented here:
// `pending` (QR generated, not scanned), `scanned` (the phone confirmed and the
// login is finishing), `linked`, `expired` (upstream retries the QR in place
// and only reports expiry when the retry itself fails) and `declined`. This
// module maps those onto one `ZalouserQrStatus` the Hub can render, and it
// FLUSHES the session store before it reports `linked`, so a Hub that restarts
// one tick later still has the credentials.

import { formatErrorMessage } from "@getpaseo/channels-core/plugin-sdk/error-runtime";
import { writeQrDataUrlToTempFile } from "../qr-temp-file.js";
import {
  checkZaloAuthenticated,
  getZaloUserInfo,
  logoutZaloProfile,
  startZaloQrLogin,
  waitForZaloQrLogin,
} from "../zalo-js.js";
import {
  flushZalouserSessions,
  hydrateZalouserSessions,
  withZalouserSessionMint,
} from "./session-store.js";

/** The linking state the Hub renders. */
export type ZalouserQrStatus = "pending" | "linked" | "failed";

export interface ZalouserQrStartResult {
  status: ZalouserQrStatus;
  /** `data:image/png;base64,…` — the QR the operator scans. Absent once linked. */
  qrDataUrl?: string;
  /** The QR written to a private host file, for an operator on the box. */
  qrFilePath?: string;
  /** Upstream's own message text, surfaced unchanged. */
  message: string;
}

export interface ZalouserQrPollResult {
  status: ZalouserQrStatus;
  message: string;
  /** The linked account's identity, once the login completed. */
  user?: { userId: string; displayName: string; avatar?: string };
}

/** Upstream `startZaloQrLogin`'s own start budget. */
const QR_START_TIMEOUT_MS = 35_000;
/** One poll's bounded wait. Short enough for an RPC, long enough to be useful. */
const QR_POLL_TIMEOUT_MS = 15_000;

/**
 * Begins a QR login for `profile`, or re-attaches to the one already running —
 * upstream returns the SAME data URL for a fresh pending login rather than
 * invalidating the code the operator is already looking at.
 *
 * `relink: true` is upstream's `force`: the stored session is logged out first,
 * so an expired or wrong-account link can be replaced without a manual logout.
 */
export async function startZalouserQrLogin(params: {
  profile: string;
  /** The account being linked. Defaults to the one `bindAccountSession` bound;
   * a relink of a profile another account also holds needs it to be explicit. */
  accountId?: string;
  relink?: boolean;
  timeoutMs?: number;
  writeTempFile?: boolean;
}): Promise<ZalouserQrStartResult> {
  return await withZalouserSessionMint(params.accountId, async () => {
    await hydrateZalouserSessions(params.accountId);
    const started = await startZaloQrLogin({
      profile: params.profile,
      ...(params.relink === true ? { force: true } : {}),
      timeoutMs: params.timeoutMs ?? QR_START_TIMEOUT_MS,
    });
    if (started.qrDataUrl === undefined) {
      // No QR means either "already linked" or a start failure; upstream carries
      // the distinction in its message only, so ask the session itself.
      const linked = await checkZaloAuthenticated(params.profile);
      return {
        status: linked ? "linked" : "failed",
        message: started.message,
      };
    }
    const qrFilePath =
      params.writeTempFile === false
        ? undefined
        : ((await writeQrDataUrlToTempFile(started.qrDataUrl, params.profile).catch(() => null)) ??
          undefined);
    return {
      status: "pending",
      qrDataUrl: started.qrDataUrl,
      ...(qrFilePath === undefined ? {} : { qrFilePath }),
      message: started.message,
    };
  });
}

/**
 * One bounded wait on the pending login. `pending` means "call again"; it is
 * also what a scanned-but-not-finished login reports, because upstream's state
 * machine only flips `connected` once the credentials are captured.
 *
 * `linked` is reported ONLY after the session store has been flushed, so the
 * Hub never tells an operator the account is linked while the credentials are
 * still in a write-behind queue.
 */
export async function pollZalouserQrLogin(params: {
  profile: string;
  accountId?: string;
  timeoutMs?: number;
}): Promise<ZalouserQrPollResult> {
  return await withZalouserSessionMint(params.accountId, () => pollOnce(params));
}

async function pollOnce(params: {
  profile: string;
  timeoutMs?: number;
}): Promise<ZalouserQrPollResult> {
  const waited = await waitForZaloQrLogin({
    profile: params.profile,
    timeoutMs: params.timeoutMs ?? QR_POLL_TIMEOUT_MS,
  });
  if (!waited.connected) {
    // Upstream distinguishes "still waiting" (retryable) from a terminal
    // failure by clearing the active login; a cleared login with no stored
    // session is terminal.
    const stillPending = /still waiting|scan|pending/i.test(waited.message);
    return { status: stillPending ? "pending" : "failed", message: waited.message };
  }
  try {
    await flushZalouserSessions();
  } catch (error) {
    return {
      status: "failed",
      message: `Zalo linked but the session could not be persisted: ${formatErrorMessage(error)}`,
    };
  }
  const user = await getZaloUserInfo(params.profile).catch(() => null);
  return {
    status: "linked",
    message: waited.message,
    ...(user === null ? {} : { user }),
  };
}

/** Abandons the pending QR. The stored session, if any, is left alone — this is
 * "I closed the dialog", not "unlink me". */
export async function cancelZalouserQrLogin(params: {
  profile: string;
  accountId?: string;
}): Promise<{ cancelled: boolean; message: string }> {
  return await withZalouserSessionMint(params.accountId, () => cancelOnce(params));
}

async function cancelOnce(params: {
  profile: string;
}): Promise<{ cancelled: boolean; message: string }> {
  const before = await checkZaloAuthenticated(params.profile);
  if (before) {
    // Never let a cancel of a `relink` QR drop a session that is still good.
    return { cancelled: false, message: "Zalo session is still linked; nothing to cancel." };
  }
  const result = await logoutZaloProfile(params.profile);
  await flushZalouserSessions().catch(() => undefined);
  return { cancelled: true, message: result.message };
}

/** Clears the stored session and leaves upstream's durable revocation marker,
 * so a later `doctor`/hydrate cannot resurrect the cleared credentials. */
export async function logoutZalouser(params: {
  profile: string;
  accountId?: string;
}): Promise<{ cleared: boolean; message: string }> {
  return await withZalouserSessionMint(params.accountId, async () => {
    await hydrateZalouserSessions(params.accountId);
    const result = await logoutZaloProfile(params.profile);
    await flushZalouserSessions();
    return { cleared: result.cleared, message: result.message };
  });
}
