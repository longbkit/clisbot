import {
  normalizeHostPort,
  normalizeLoopbackToLocalhost,
  shouldUseTlsForDefaultHostedRelay,
} from "@clisbot/protocol/daemon-endpoints";
import type { HostConnection, HubHostManagement } from "@/types/host-connection";

export type HostAccessTicketResolver = (clientId: string) => Promise<string | undefined>;

interface HostSessionAccessBinding {
  resolveAccessTicket: HostAccessTicketResolver;
  management?: HubHostManagement;
  advertisedConnections?: readonly HostConnection[];
}

const GLOBAL_KEY = "__clisbotHostSessionAccessBindings";
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

function registry(): Map<string, HostSessionAccessBinding> {
  const existing = Reflect.get(globalThis, GLOBAL_KEY);
  if (existing instanceof Map) return existing as Map<string, HostSessionAccessBinding>;
  const created = new Map<string, HostSessionAccessBinding>();
  Reflect.set(globalThis, GLOBAL_KEY, created);
  return created;
}

export function registerHostAccessTicketResolver(
  serverId: string,
  resolver: HostAccessTicketResolver,
  management?: HubHostManagement,
  advertisedConnections?: readonly HostConnection[],
): () => void {
  const resolvers = registry();
  const binding: HostSessionAccessBinding = {
    resolveAccessTicket: resolver,
    ...(management === undefined ? {} : { management }),
    ...(advertisedConnections === undefined ? {} : { advertisedConnections }),
  };
  resolvers.set(serverId, binding);
  emitChange();
  return () => {
    if (resolvers.get(serverId) !== binding) return;
    resolvers.delete(serverId);
    emitChange();
  };
}

export function hostRequiresSessionAdmission(serverId: string): boolean {
  return registry().has(serverId);
}

/**
 * The Hub ticket a hello presents. `ownCredential` says this device can sign in to the Host
 * by itself (its device or desktop local credential, managed access off): a ticket then only
 * adds Hub authority, so a stopped or signed-out Hub must not lock the device out.
 */
export async function resolveHostAccessTicket(
  serverId: string,
  clientId: string,
  management?: HubHostManagement,
  ownCredential = false,
): Promise<string | undefined> {
  const binding = registry().get(serverId);
  // A persisted Hub offer is connection information, not a current login.
  if (
    management &&
    (binding?.management?.hubOrigin !== management.hubOrigin ||
      binding?.management?.organizationId !== management.organizationId ||
      binding?.management?.daemonId !== management.daemonId)
  ) {
    if (ownCredential) return undefined;
    throw new Error("Sign in to the Hub managing this Host to connect.");
  }
  return binding?.resolveAccessTicket(clientId);
}

/**
 * Requests a ticket now, while the transport to the Host opens, instead of after it: on a
 * 400 ms VPN that is one round trip off every connect. The first hello takes this ticket; a
 * later hello requests its own, since tickets are single use.
 */
export function prefetchedAccessTicket(
  request: () => Promise<string | undefined>,
): () => Promise<string | undefined> {
  let prefetched: Promise<string | undefined> | null = request();
  // The hello that takes it reports the failure; one that never comes leaves nothing to report.
  prefetched.catch(() => undefined);
  return () => {
    const ticket = prefetched ?? request();
    prefetched = null;
    return ticket;
  };
}

export function hostSessionHubManagement(serverId: string): HubHostManagement | undefined {
  return registry().get(serverId)?.management;
}

export function subscribeHostSessionAccess(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current authenticated offer, not a discovery service or a persisted transport policy. */
export function hostAdvertisedConnections(serverId: string): readonly HostConnection[] | undefined {
  return registry().get(serverId)?.advertisedConnections;
}

/** Stored profiles normalize IDs/loopback names; authorization follows the actual route. */
export function matchesAdvertisedHostConnection(
  current: HostConnection,
  offered: HostConnection,
): boolean {
  if (current.type === "directTcp" && offered.type === "directTcp") {
    return (
      normalizeLoopbackToLocalhost(normalizeHostPort(current.endpoint)) ===
        normalizeLoopbackToLocalhost(normalizeHostPort(offered.endpoint)) &&
      (current.useTls ?? false) === (offered.useTls ?? false)
    );
  }
  if (current.type === "relay" && offered.type === "relay") {
    return (
      normalizeHostPort(current.relayEndpoint) === normalizeHostPort(offered.relayEndpoint) &&
      (current.useTls ?? shouldUseTlsForDefaultHostedRelay(current.relayEndpoint)) ===
        (offered.useTls ?? shouldUseTlsForDefaultHostedRelay(offered.relayEndpoint)) &&
      current.daemonPublicKeyB64 === offered.daemonPublicKeyB64
    );
  }
  return false;
}
