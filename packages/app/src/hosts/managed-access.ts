import type { HostConnection, HostProfile } from "@/types/host-connection";

/** UI text for a Host whose sessions Hub admits with access tickets (managed access `external`). */
export const MANAGED_ACCESS_HOST_LABEL = "Managed access";

/** Hover copy for the shield glyph: how this Host is reached, not a connection status. */
export const MANAGED_ACCESS_HOST_TOOLTIP =
  "Reached through Hub managed access. Sessions on this host require an access ticket.";

/**
 * Whether a Host is reached through Hub managed access. Read from the saved profile so every
 * surface (Host picker, Host overview, Host badge) can tell it apart synchronously, including
 * before Hub sign-in resolves. A Hub-synchronized Host in `off` mode connects like any other.
 */
export function isManagedAccessHost(host: Pick<HostProfile, "management"> | undefined): boolean {
  return host?.management?.kind === "hub" && host.management.managedAccessMode === "external";
}

/** UI text for a connection that Hub supplies and keeps up to date. */
export const HUB_CONNECTION_LABEL = "Provided by Hub";

/**
 * Whether Hub supplies this connection. Hub re-adds its connections on every synchronization, so
 * removing one locally does not stick. On a saved Host that Hub was attached to, the connections
 * the user saved stay theirs.
 */
export function isHubProvidedConnection(
  host: Pick<HostProfile, "management">,
  connection: Pick<HostConnection, "id">,
): boolean {
  if (host.management?.kind !== "hub") return false;
  return !(host.management.manualConnectionIds ?? []).includes(connection.id);
}
