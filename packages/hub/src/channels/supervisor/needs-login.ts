// COMPAT(clisbot-channels): telling "this account has never been linked" apart
// from "this account broke".
//
// A QR-auth channel (catalog `auth: "qr"`) has no credential an operator can
// paste. Its vertical fails the account start when the profile has no live
// session — deliberately, because a silently-idle account is the failure mode
// nobody sees — and a personal-account session dies for ordinary reasons: the
// phone signs it out, the provider rotates it. Relink is routine, not
// exceptional (`packages/channels/zalouser/HUB-WIRING.md` §7).
//
// So this failure is not `failed`. It is `needs-login`: a terminal state the
// supervisor does not restart on the same revision, and which the status
// surface answers with "scan the QR again" instead of an error the operator
// cannot act on.
//
// The marker is the vertical's own message text. That coupling is pinned by a
// differential test against the real built vertical
// (`needs-login.test.ts`), the same way the credential probes are pinned to the
// verticals they restate.

import { getChannelCatalogEntry } from "../catalog.js";
import type { ChannelTransportState } from "./types.js";

/**
 * The phrases a QR-auth vertical uses when the start failed only for a missing
 * or dead session. Deliberately narrow: a message that does not match stays a
 * plain failure, because telling an operator to rescan a QR when the real fault
 * was a network error wastes the one action they have.
 */
const NOT_LINKED_MARKERS = [/\bis not linked\b/iu, /\bnot authenticated\b/iu] as const;

/** True when the channel is linked by a live login rather than a pasted token. */
export function channelUsesQrLogin(channel: string): boolean {
  return getChannelCatalogEntry(channel)?.auth === "qr";
}

/** True when this start failure means "no session yet", not "the account broke". */
export function isNeedsLoginFailure(channel: string, detail: string): boolean {
  if (!channelUsesQrLogin(channel)) return false;
  return NOT_LINKED_MARKERS.some((marker) => marker.test(detail));
}

/** The transport state a REJECTED account monitor leaves behind. */
export function monitorFailureTransport(
  channel: string,
  detail: string,
): Extract<ChannelTransportState, "needs-login" | "failed"> {
  return isNeedsLoginFailure(channel, detail) ? "needs-login" : "failed";
}

/**
 * True when reconcile can leave this account alone at the active revision.
 * `started` is the obvious one; `needs-login` is the point of this module —
 * restarting it just re-runs the same failed session probe, and only a human QR
 * scan (or a new revision) changes the answer.
 */
export function isSettledTransport(state: ChannelTransportState): boolean {
  return state === "started" || state === "needs-login";
}
