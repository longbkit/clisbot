import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { offerConnections } from "@/device-access/host-profile";
import type { ConnectionOffer } from "@clisbot/protocol/connection-offer";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { recordHostDiagnostic } from "@/runtime/host-diagnostics";
import { registerHostAccessTicketResolver } from "@/runtime/host-session-access";
import type { HubHostManagement } from "@/types/host-connection";
import { i18n } from "@/i18n/i18next";
import { HubAccountScope, useHubAccount, useHubAccounts } from "./account-provider";
import { HubAccessTicketSchema } from "./contracts";
import { classifyHubFailure } from "./hub-failure";
import { hubManagedHostRequiresAccessTicket } from "./managed-host-admission";
import { orphanedManagedHosts } from "./managed-host-reconciliation";
import { useHubDaemonsQuery } from "./host-inventory";
import { cachedListForAccount, useHubDaemonListCache } from "./hub-daemon-list-cache";
import { deriveHubSourceState, getHubSourceHealthRegistry } from "./hub-source-health";
import {
  hubHostSynchronizationKey,
  setHubHostSynchronizationFailure,
} from "./host-synchronization-status";

const HOST_READD_BASE_DELAY_MS = 1_000;
const HOST_READD_MAX_DELAY_MS = 60_000;
/** A Host registered this long counts as recovered; the next removal backs off from the start. */
const HOST_READD_STABLE_MS = 120_000;

let managedHostMutationTail: Promise<void> = Promise.resolve();

function enqueueManagedHostMutation(operation: () => Promise<void>): Promise<void> {
  const next = managedHostMutationTail.then(operation);
  managedHostMutationTail = next.catch(() => undefined);
  return next;
}

/**
 * Whether the Hub still lists a connectable daemon for `serverId`: `true` while it does (its Host
 * is being registered again), `false` when it does not, `undefined` before the list is known or
 * without a Hub account.
 */
export function useHubListsHost(serverId: string | null): boolean | undefined {
  const daemons = useHubDaemonsQuery();
  if (serverId === null || daemons.data === undefined) return undefined;
  return daemons.data.daemons.some((daemon) => daemon.connectionOffer?.serverId === serverId);
}

/**
 * Registers the Hosts of every saved Hub account, each under its own account, so Hosts from a
 * personal Hub and a company Hub sit side by side and selecting a Hub never removes the others'.
 */
export function HubHostSynchronization() {
  return useHubAccounts().map((account) => (
    <HubAccountScope key={account.origin} account={account}>
      <AccountHostSynchronization />
    </HubAccountScope>
  ));
}

function AccountHostSynchronization() {
  const hub = useHubAccount();
  const signedIn = hub.signedIn;
  const hubOrigin = hub.origin;
  const organizationId = signedIn?.organization.id ?? null;
  const daemons = useHubDaemonsQuery();
  const hosts = useHosts();
  const listCache = useHubDaemonListCache();
  // A Hub that answered (signed out, another account or organization) retires the list this
  // device remembered for it. An unreachable Hub has no state and keeps it.
  const rememberedList = hubOrigin === null ? undefined : listCache.get(hubOrigin);
  useEffect(() => {
    if (!hub.enabled || hubOrigin === null || hub.state === null || rememberedList === undefined)
      return;
    if (cachedListForAccount(rememberedList, hub) === undefined) listCache.forget(hubOrigin);
  }, [hub, hubOrigin, listCache, rememberedList]);
  useHubSourceHealthPublication(hub, daemons, rememberedList?.syncedAt ?? null);
  const projectedDaemonIds = useMemo(
    () =>
      new Set(
        (daemons.data?.daemons ?? [])
          .filter((daemon) => daemon.connectionOffer !== null)
          .map((daemon) => daemon.id),
      ),
    [daemons.data],
  );
  // A Host left by a previous enrollment has no binding to unmount, so its
  // removal never fires. Reconcile the whole Hub-managed set on every Host or
  // projection change instead of relying on unmount alone.
  useEffect(() => {
    if (
      !hub.enabled ||
      organizationId === null ||
      hubOrigin === null ||
      daemons.data === undefined ||
      daemons.isPlaceholderData
    ) {
      return;
    }
    const store = getHostRuntimeStore();
    for (const management of orphanedManagedHosts({
      hosts,
      projectedDaemonIds,
      hubOrigin,
      organizationId,
    })) {
      void enqueueManagedHostMutation(() =>
        store
          .removeManagedHost(management, "Hub no longer lists this Host with a connection offer")
          .then(() => undefined),
      );
    }
  }, [
    daemons.data,
    daemons.isPlaceholderData,
    hosts,
    hub.enabled,
    hubOrigin,
    organizationId,
    projectedDaemonIds,
  ]);

  if (
    !hub.enabled ||
    signedIn === null ||
    hubOrigin === null ||
    daemons.isPlaceholderData ||
    daemons.data === undefined
  ) {
    return null;
  }
  // The list kept from before a 401 or 403 still mounts the bindings, but the Hub refuses this
  // account a ticket too: re-adding a Host it removed would be refused again.
  const hubRefusesAccount =
    daemons.error !== null &&
    daemons.error !== undefined &&
    classifyHubFailure(daemons.error) !== "unreachable";
  return daemons.data.daemons.flatMap((daemon) =>
    daemon.connectionOffer === null
      ? []
      : [
          <HubHostBinding
            key={`${signedIn.account.id}:${signedIn.organization.id}:${daemon.id}`}
            daemonId={daemon.id}
            label={daemon.slug}
            offer={daemon.connectionOffer}
            managedAccessMode={daemon.managedAccessMode}
            hubOrigin={hubOrigin}
            organizationId={signedIn.organization.id}
            readdPaused={hubRefusesAccount}
            refreshList={daemons.refetch}
          />,
        ],
  );
}

/** This account's daemon-list query is the only observer; it reports the Hub's health. */
function useHubSourceHealthPublication(
  hub: ReturnType<typeof useHubAccount>,
  daemons: ReturnType<typeof useHubDaemonsQuery>,
  rememberedSyncedAt: string | null,
): void {
  const origin = hub.origin;
  const state = deriveHubSourceState({
    accountUnresolved: hub.state === null,
    accountLoading: hub.loading,
    signedIn: hub.signedIn !== null,
    listLoaded: daemons.data !== undefined,
    listError: daemons.error,
  });
  const listedAt = daemons.data !== undefined ? daemons.dataUpdatedAt : 0;
  const lastSyncedAt = listedAt > 0 ? new Date(listedAt).toISOString() : rememberedSyncedAt;
  const label = hub.signedIn?.organization.name ?? origin ?? "";
  useEffect(() => {
    if (!hub.enabled || origin === null) return;
    getHubSourceHealthRegistry().publish({ origin, label, state, lastSyncedAt });
  }, [hub.enabled, label, lastSyncedAt, origin, state]);
  useEffect(() => {
    if (origin === null) return;
    return () => getHubSourceHealthRegistry().remove(origin);
  }, [origin]);
}

function HubHostBinding({
  daemonId,
  label,
  offer,
  managedAccessMode,
  hubOrigin,
  organizationId,
  readdPaused,
  refreshList,
}: {
  daemonId: string;
  label: string;
  offer: ConnectionOffer;
  managedAccessMode: "off" | "external";
  hubOrigin: string;
  organizationId: string;
  /** The Hub answered that this account must sign in again or lost access. */
  readdPaused: boolean;
  refreshList: () => unknown;
}) {
  const hub = useHubAccount();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const synchronizationKey = hubHostSynchronizationKey({
    origin: hubOrigin,
    organizationId,
    accountId: hub.signedIn?.account.id ?? null,
    daemonId,
  });
  const hubRef = useRef(hub);
  hubRef.current = hub;
  const labelRef = useRef(label);
  labelRef.current = label;
  const previousLabelRef = useRef(label);
  const serializedOffer = JSON.stringify(offer);
  const synchronizedOffer = useMemo<ConnectionOffer>(
    // HubDaemonsSchema already validates the offer at the API boundary.
    () => JSON.parse(serializedOffer) as ConnectionOffer,
    [serializedOffer],
  );
  const issueAccessTicket = useCallback(
    (clientId: string) =>
      hubRef.current
        .api()
        .post(
          `daemons/${encodeURIComponent(daemonId)}/access-tickets`,
          { clientId },
          HubAccessTicketSchema,
        )
        .then(({ accessTicket }) => accessTicket),
    [daemonId],
  );
  useEffect(() => {
    let disposed = false;
    setHubHostSynchronizationFailure(synchronizationKey, null);
    const store = getHostRuntimeStore();
    const management: HubHostManagement = {
      kind: "hub",
      hubOrigin,
      organizationId,
      daemonId,
    };
    // Even off-mode Hub Hosts need a current account binding. Off skips ticket
    // issuance, not ownership of the app's automatically supplied connection.
    const unregister = registerHostAccessTicketResolver(
      synchronizedOffer.serverId,
      hubManagedHostRequiresAccessTicket(managedAccessMode)
        ? issueAccessTicket
        : async () => undefined,
      management,
      synchronizedOffer.v === 5 ? offerConnections(synchronizedOffer) : undefined,
    );
    void enqueueManagedHostMutation(async () => {
      if (disposed) return;
      const existing = store
        .getHosts()
        .find((host) => host.serverId === synchronizedOffer.serverId);
      const profile = await store.upsertManagedConnectionFromOffer({
        offer: synchronizedOffer,
        label: labelRef.current,
        management: { ...management, daemonSlug: labelRef.current, managedAccessMode },
      });
      if (profile === null) {
        throw new Error(i18n.t("hub.account.synchronization.conflictWithHint"));
      }
      // Adopt, never restart, a Host already running for this daemon (cold start restores it
      // from the registry). Registering the binding above re-ran its admission if the binding
      // or offered routes changed; a changed offer reaches it through the upsert. A Host that
      // gave up (offline, error) gets one immediate attempt.
      if (!disposed && existing) await store.adoptHostConnection(synchronizedOffer.serverId);
    }).catch((error: unknown) => {
      unregister();
      if (!disposed) {
        setHubHostSynchronizationFailure(synchronizationKey, {
          message:
            error instanceof Error
              ? error.message
              : i18n.t("hub.account.synchronization.addFailed"),
          retry,
        });
      }
    });
    return () => {
      disposed = true;
      unregister();
      setHubHostSynchronizationFailure(synchronizationKey, null);
    };
  }, [
    attempt,
    retry,
    synchronizationKey,
    daemonId,
    hubOrigin,
    issueAccessTicket,
    managedAccessMode,
    organizationId,
    synchronizedOffer,
  ]);

  // Updating the shared name must not tear down a healthy admission or connection.
  useEffect(() => {
    if (previousLabelRef.current === label) return;
    previousLabelRef.current = label;
    let disposed = false;
    void enqueueManagedHostMutation(async () => {
      if (disposed) return;
      const profile = await getHostRuntimeStore().upsertManagedConnectionFromOffer({
        offer: synchronizedOffer,
        label,
        management: {
          kind: "hub",
          hubOrigin,
          organizationId,
          daemonId,
          daemonSlug: label,
          managedAccessMode,
        },
      });
      if (profile === null) throw new Error(i18n.t("hub.account.synchronization.conflict"));
    }).catch((error: unknown) => {
      if (!disposed) {
        setHubHostSynchronizationFailure(synchronizationKey, {
          message:
            error instanceof Error
              ? error.message
              : i18n.t("hub.account.synchronization.renameFailed"),
          retry,
        });
      }
    });
    return () => {
      disposed = true;
    };
  }, [
    daemonId,
    hubOrigin,
    label,
    managedAccessMode,
    organizationId,
    retry,
    synchronizationKey,
    synchronizedOffer,
  ]);

  useEffect(() => {
    const store = getHostRuntimeStore();
    const management: HubHostManagement = {
      kind: "hub",
      hubOrigin,
      organizationId,
      daemonId,
    };
    return () => {
      void enqueueManagedHostMutation(() =>
        store.removeManagedHost(management, "Hub Host binding unmounted").then(() => undefined),
      );
    };
  }, [daemonId, hubOrigin, organizationId]);

  // The Hub still lists this daemon, so a Host that left the registry while this binding is
  // mounted (a revocation during a Hub blip) is added back rather than left "Registering" until a
  // reload. Repeated removals back off, so a real denial does not turn into a tight loop. A
  // removal also reads the list again: while the Hub answers 401 or 403 nothing is added back,
  // and the first list it serves again (after signing in) adds the Host back at once.
  const hosts = useHosts();
  const registered = hosts.some((host) => host.serverId === synchronizedOffer.serverId);
  const wasRegisteredRef = useRef(false);
  const readdCountRef = useRef(0);
  const registeredSinceRef = useRef<number | null>(null);
  const readdDelayRef = useRef<number | null>(null);
  const refreshListRef = useRef(refreshList);
  refreshListRef.current = refreshList;
  useEffect(() => {
    if (registered) {
      wasRegisteredRef.current = true;
      registeredSinceRef.current = Date.now();
      readdDelayRef.current = null;
      return;
    }
    if (!wasRegisteredRef.current) return;
    if (readdDelayRef.current === null) {
      readdDelayRef.current = nextReaddDelay(readdCountRef, registeredSinceRef.current);
      void refreshListRef.current();
    }
    if (readdPaused) {
      readdCountRef.current = 0;
      readdDelayRef.current = HOST_READD_BASE_DELAY_MS;
      return;
    }
    const delay = readdDelayRef.current;
    recordHostDiagnostic("managed-host-readd-scheduled", {
      serverId: synchronizedOffer.serverId,
      daemonId,
      delayMs: delay,
    });
    const timer = setTimeout(() => {
      wasRegisteredRef.current = false;
      readdDelayRef.current = null;
      retry();
    }, delay);
    return () => clearTimeout(timer);
  }, [daemonId, readdPaused, registered, retry, synchronizedOffer.serverId]);
  return null;
}

/** The wait before re-adding a removed Host: doubling per removal, reset after a stable spell. */
function nextReaddDelay(count: { current: number }, registeredSince: number | null): number {
  if (Date.now() - (registeredSince ?? 0) >= HOST_READD_STABLE_MS) count.current = 0;
  const delay = Math.min(HOST_READD_MAX_DELAY_MS, HOST_READD_BASE_DELAY_MS * 2 ** count.current);
  count.current += 1;
  return delay;
}
