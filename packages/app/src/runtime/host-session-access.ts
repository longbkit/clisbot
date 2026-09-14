import type { HubHostManagement } from "@/types/host-connection";

export type HostAccessTicketResolver = (clientId: string) => Promise<string | undefined>;

interface HostSessionAccessBinding {
  resolveAccessTicket: HostAccessTicketResolver;
  management?: HubHostManagement;
}

const GLOBAL_KEY = "__paseoHostSessionAccessBindings";
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
): () => void {
  const resolvers = registry();
  const binding: HostSessionAccessBinding = {
    resolveAccessTicket: resolver,
    ...(management === undefined ? {} : { management }),
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

export async function resolveHostAccessTicket(
  serverId: string,
  clientId: string,
  management?: HubHostManagement,
): Promise<string | undefined> {
  const binding = registry().get(serverId);
  // A persisted Hub offer is connection information, not a current login.
  if (
    management &&
    (binding?.management?.hubOrigin !== management.hubOrigin ||
      binding?.management?.organizationId !== management.organizationId ||
      binding?.management?.daemonId !== management.daemonId)
  ) {
    throw new Error("Sign in to the Hub managing this Host to connect.");
  }
  return binding?.resolveAccessTicket(clientId);
}

export function hostSessionHubManagement(serverId: string): HubHostManagement | undefined {
  return registry().get(serverId)?.management;
}

export function subscribeHostSessionAccess(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
