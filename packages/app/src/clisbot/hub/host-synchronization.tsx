import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { recordHostDiagnostic } from "@/runtime/host-diagnostics";
import { registerHostAccessTicketResolver } from "@/runtime/host-session-access";
import type { HubHostManagement } from "@/types/host-connection";
import { useHubAccount } from "./account-provider";
import { HubAccessTicketSchema, HubDaemonsSchema } from "./contracts";
import { hubManagedHostRequiresAccessTicket } from "./managed-host-admission";
import { orphanedManagedHosts } from "./managed-host-reconciliation";
import { hubResourceQueryKey } from "./query-keys";
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

/** The Hub's daemon list for the signed-in account; one cached query shared by every reader. */
function useHubDaemonsQuery() {
  const hub = useHubAccount();
  const signedIn = hub.signedIn;
  const organizationId = signedIn?.organization.id ?? null;
  return useFetchQuery({
    queryKey: hubResourceQueryKey(
      {
        origin: hub.origin,
        organizationId,
        accountId: signedIn?.account.id ?? null,
      },
      "daemons",
    ),
    queryFn: () => hub.api().get("daemons", HubDaemonsSchema),
    dataShape: "value",
    enabled: organizationId !== null,
    retry: false,
    refetchInterval: 60_000,
    staleTimeMs: 0,
  });
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

export function HubHostSynchronization() {
  const hub = useHubAccount();
  const signedIn = hub.signedIn;
  const hubOrigin = hub.origin;
  const organizationId = signedIn?.organization.id ?? null;
  const daemons = useHubDaemonsQuery();
  const hosts = useHosts();
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
          />,
        ],
  );
}

function HubHostBinding({
  daemonId,
  label,
  offer,
  managedAccessMode,
  hubOrigin,
  organizationId,
}: {
  daemonId: string;
  label: string;
  offer: ConnectionOffer;
  managedAccessMode: "off" | "external";
  hubOrigin: string;
  organizationId: string;
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
  const synchronizedOffer = useMemo<ConnectionOffer>(
    () => ({
      v: offer.v,
      serverId: offer.serverId,
      daemonPublicKeyB64: offer.daemonPublicKeyB64,
      relay: { endpoint: offer.relay.endpoint, useTls: offer.relay.useTls },
      ...(offer.direct
        ? {
            direct: {
              endpoint: offer.direct.endpoint,
              useTls: offer.direct.useTls,
            },
          }
        : {}),
    }),
    [
      offer.daemonPublicKeyB64,
      offer.direct,
      offer.relay.endpoint,
      offer.relay.useTls,
      offer.serverId,
      offer.v,
    ],
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
    );
    void enqueueManagedHostMutation(async () => {
      if (disposed) return;
      // Restart any Host already running for this daemon, including a saved one being attached:
      // its client was admitted without this binding, or gave up before it was registered.
      const existing = store
        .getHosts()
        .find((host) => host.serverId === synchronizedOffer.serverId);
      const profile = await store.upsertManagedConnectionFromOffer({
        offer: synchronizedOffer,
        label: labelRef.current,
        management: { ...management, daemonSlug: labelRef.current, managedAccessMode },
      });
      if (profile === null) {
        throw new Error(
          "A saved Host conflicts with this Hub's connection details. Check the Host's Connections settings.",
        );
      }
      if (!disposed && existing) await store.restartHostConnection(synchronizedOffer.serverId);
    }).catch((error: unknown) => {
      unregister();
      if (!disposed) {
        setHubHostSynchronizationFailure(synchronizationKey, {
          message: error instanceof Error ? error.message : "Unable to add this Host to Paseo.",
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
      if (profile === null)
        throw new Error("A saved Host conflicts with this Hub's connection details.");
    }).catch((error: unknown) => {
      if (!disposed) {
        setHubHostSynchronizationFailure(synchronizationKey, {
          message: error instanceof Error ? error.message : "Unable to update the Host name.",
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
  // reload. Repeated removals back off, so a real denial does not turn into a tight loop.
  const hosts = useHosts();
  const registered = hosts.some((host) => host.serverId === synchronizedOffer.serverId);
  const wasRegisteredRef = useRef(false);
  const readdCountRef = useRef(0);
  const registeredSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (registered) {
      wasRegisteredRef.current = true;
      registeredSinceRef.current = Date.now();
      return;
    }
    if (!wasRegisteredRef.current) return;
    wasRegisteredRef.current = false;
    const stableFor = Date.now() - (registeredSinceRef.current ?? 0);
    if (stableFor >= HOST_READD_STABLE_MS) readdCountRef.current = 0;
    const delay = Math.min(
      HOST_READD_MAX_DELAY_MS,
      HOST_READD_BASE_DELAY_MS * 2 ** readdCountRef.current,
    );
    readdCountRef.current += 1;
    recordHostDiagnostic("managed-host-readd-scheduled", {
      serverId: synchronizedOffer.serverId,
      daemonId,
      delayMs: delay,
    });
    const timer = setTimeout(retry, delay);
    return () => clearTimeout(timer);
  }, [daemonId, registered, retry, synchronizedOffer.serverId]);
  return null;
}
