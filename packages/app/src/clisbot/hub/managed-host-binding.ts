import { offerConnections } from "@/device-access/host-profile";
import type { ConnectionOffer } from "@clisbot/protocol/connection-offer";
import type { HostRuntimeStore } from "@/runtime/host-runtime";
import {
  type HostAccessTicketResolver,
  registerHostAccessTicketResolver,
} from "@/runtime/host-session-access";
import type { HubHostManagement } from "@/types/host-connection";
import { i18n } from "@/i18n/i18next";
import type { z } from "zod";
import type { HubDaemonSchema } from "./contracts";
import { type CachedHubDaemonList, cachedListForAccount } from "./hub-daemon-list-cache";
import { hubManagedHostRequiresAccessTicket } from "./managed-host-admission";

type HubDaemon = z.infer<typeof HubDaemonSchema>;

export interface ManagedHostBindingList {
  /** `remembered` until this run reads the list; Hosts are never re-added from it. */
  source: "live" | "remembered";
  accountId: string;
  organizationId: string;
  daemons: readonly HubDaemon[];
}

/**
 * The daemons a Hub account binds to Hosts. A cold start binds the list this account last read,
 * so the restored Hosts connect while the Hub sign-in and list read are still in flight; the live
 * list replaces it with the same binding keys, so nothing reconnects. Removal never acts on it
 * (`useManagedHostReconciliation` waits for the Hub's answer).
 */
export function managedHostBindingList(input: {
  account: {
    enabled: boolean;
    origin: string | null;
    state: unknown;
    signedIn: { account: { id: string }; organization: { id: string } } | null;
  };
  /** The list read in this run; undefined while it is pending, failing or a placeholder. */
  live: { daemons: readonly HubDaemon[] } | undefined;
  remembered: CachedHubDaemonList | undefined;
}): ManagedHostBindingList | null {
  const { account, live } = input;
  if (!account.enabled || account.origin === null) return null;
  if (account.signedIn !== null && live !== undefined) {
    return {
      source: "live",
      accountId: account.signedIn.account.id,
      organizationId: account.signedIn.organization.id,
      daemons: live.daemons,
    };
  }
  const remembered = cachedListForAccount(input.remembered, account);
  if (remembered === undefined) return null;
  return {
    source: "remembered",
    accountId: remembered.accountId,
    organizationId: remembered.organizationId,
    daemons: remembered.daemons,
  };
}

let managedHostMutationTail: Promise<void> = Promise.resolve();

/** Registry changes for Hub-managed Hosts run one at a time, in the order they were asked for. */
export function enqueueManagedHostMutation(operation: () => Promise<void>): Promise<void> {
  const next = managedHostMutationTail.then(operation);
  managedHostMutationTail = next.catch(() => undefined);
  return next;
}

export type ManagedHostBindingStore = Pick<
  HostRuntimeStore,
  | "getHosts"
  | "upsertManagedConnectionFromOffer"
  | "adoptHostConnection"
  | "whenHostRegistryLoaded"
  | "markColdStartPhase"
>;

export interface ManagedHostBinding {
  store: ManagedHostBindingStore;
  offer: ConnectionOffer;
  management: HubHostManagement;
  managedAccessMode: "off" | "external";
  /** Read when the registry is written, so a rename between mount and write is kept. */
  label: () => string;
  issueAccessTicket: HostAccessTicketResolver;
  onFailure: (error: unknown) => void;
}

/**
 * Binds one daemon the Hub lists to its Host: registers the ticket resolver its hello presents,
 * then writes the Hub's offer to the registry and adopts the Host. Returns the unbinding.
 */
export function bindManagedHost(binding: ManagedHostBinding): () => void {
  const { store, offer, management, managedAccessMode } = binding;
  let disposed = false;
  // Even off-mode Hub Hosts need a current account binding. Off skips ticket
  // issuance, not ownership of the app's automatically supplied connection.
  const unregister = registerHostAccessTicketResolver(
    offer.serverId,
    hubManagedHostRequiresAccessTicket(managedAccessMode)
      ? binding.issueAccessTicket
      : async () => undefined,
    management,
    offer.v === 5 ? offerConnections(offer) : undefined,
  );
  store.markColdStartPhase("hubBinding");
  void enqueueManagedHostMutation(async () => {
    // A remembered list binds before the registry has loaded; writing first would replace it.
    await store.whenHostRegistryLoaded();
    if (disposed) return;
    const existing = store.getHosts().find((host) => host.serverId === offer.serverId);
    const label = binding.label();
    const profile = await store.upsertManagedConnectionFromOffer({
      offer,
      label,
      management: { ...management, daemonSlug: label, managedAccessMode },
    });
    if (profile === null) {
      throw new Error(i18n.t("hub.account.synchronization.conflictWithHint"));
    }
    // Adopt, never restart, a Host already running for this daemon (cold start restores it
    // from the registry). Registering the binding above re-ran its admission if the binding
    // or offered routes changed; a changed offer reaches it through the upsert. A Host that
    // gave up (offline, error) gets one immediate attempt.
    if (!disposed && existing) await store.adoptHostConnection(offer.serverId);
  }).catch((error: unknown) => {
    unregister();
    if (!disposed) binding.onFailure(error);
  });
  return () => {
    disposed = true;
    unregister();
  };
}
