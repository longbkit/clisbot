import { formatTimeAgo } from "@/utils/time";
import { invitationTeams } from "../../contracts";
import { matchesSearch } from "../search-text";
import type { HubManagedInvitation } from "./types";

const HOUR_MS = 60 * 60 * 1000;
/** Hub invitations live 48 hours; the summary carries only the end of that window. */
export const INVITATION_LIFETIME_MS = 48 * HOUR_MS;
/** Under this much life left an invitation is "Expiring soon". */
const EXPIRING_SOON_MS = 12 * HOUR_MS;

export type InvitationState = "active" | "expiringSoon" | "expired";
export type InvitationFilter = "all" | InvitationState;

export function invitationState(expiresAt: string, now = Date.now()): InvitationState {
  const remaining = Date.parse(expiresAt) - now;
  if (Number.isNaN(remaining) || remaining <= 0) return "expired";
  return remaining < EXPIRING_SOON_MS ? "expiringSoon" : "active";
}

export function invitationStateLabel(state: InvitationState): string {
  return { active: "Pending", expiringSoon: "Expiring soon", expired: "Expired" }[state];
}

/** "Expires in 3 h", "Expiring soon · 40 min", or "Expired". */
export function invitationExpiryLabel(expiresAt: string, now = Date.now()): string {
  const state = invitationState(expiresAt, now);
  if (state === "expired") return "Expired";
  const remaining = Date.parse(expiresAt) - now;
  const hours = Math.floor(remaining / HOUR_MS);
  const clock = hours >= 1 ? `${String(hours)} h` : `${String(Math.floor(remaining / 60_000))} min`;
  return state === "expiringSoon" ? `Expiring soon · ${clock}` : `Expires in ${clock}`;
}

/**
 * When the invitation was sent. Hubs before 2026-09-19 omit `createdAt`; then the start of
 * the 48-hour lifetime that ends at `expiresAt` stands in, which reads "just now" after Renew.
 */
export function invitationSentLabel(
  invitation: { expiresAt: string; createdAt?: string },
  now = Date.now(),
): string {
  const sentAt =
    invitation.createdAt === undefined
      ? Date.parse(invitation.expiresAt) - INVITATION_LIFETIME_MS
      : Date.parse(invitation.createdAt);
  if (Number.isNaN(sentAt)) return "Sent";
  return `Sent ${formatTimeAgo(new Date(sentAt), new Date(now))}`;
}

export function filterInvitations(
  invitations: readonly HubManagedInvitation[],
  filter: InvitationFilter,
  query: string,
  now = Date.now(),
): HubManagedInvitation[] {
  return invitations.filter((invitation) => {
    if (filter !== "all" && invitationState(invitation.expiresAt, now) !== filter) return false;
    return matchesSearch(query, [
      invitation.email,
      ...invitationTeams(invitation).map(({ name }) => name),
    ]);
  });
}
