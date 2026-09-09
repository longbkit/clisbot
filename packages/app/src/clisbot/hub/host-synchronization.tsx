import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { registerHostAccessTicketResolver } from "@/runtime/host-session-access";
import type { HubHostManagement } from "@/types/host-connection";
import { useHubAccount } from "./account-provider";
import { HubAccessTicketSchema, HubDaemonsSchema } from "./contracts";
import { hubManagedHostRequiresAccessTicket } from "./managed-host-admission";
import { hubResourceQueryKey } from "./query-keys";
import {
  hubHostSynchronizationKey,
  setHubHostSynchronizationFailure,
} from "./host-synchronization-status";

let managedHostMutationTail: Promise<void> = Promise.resolve();

function enqueueManagedHostMutation(operation: () => Promise<void>): Promise<void> {
  const next = managedHostMutationTail.then(operation);
  managedHostMutationTail = next.catch(() => undefined);
  return next;
}

export function HubHostSynchronization() {
  const hub = useHubAccount();
  const signedIn = hub.signedIn;
  const hubOrigin = hub.origin;
  const organizationId = signedIn?.organization.id ?? null;
  const daemons = useFetchQuery({
    queryKey: hubResourceQueryKey(
      { origin: hubOrigin, organizationId, accountId: signedIn?.account.id ?? null },
      "daemons",
    ),
    queryFn: () => hub.api().get("daemons", HubDaemonsSchema),
    dataShape: "value",
    enabled: organizationId !== null,
    retry: false,
    refetchInterval: 60_000,
    staleTimeMs: 0,
  });

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
        ? { direct: { endpoint: offer.direct.endpoint, useTls: offer.direct.useTls } }
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
    const unregister = hubManagedHostRequiresAccessTicket(managedAccessMode)
      ? registerHostAccessTicketResolver(synchronizedOffer.serverId, issueAccessTicket, management)
      : () => undefined;
    void enqueueManagedHostMutation(async () => {
      if (disposed) return;
      const existing = store
        .getHosts()
        .find(
          (host) =>
            host.serverId === synchronizedOffer.serverId &&
            sameManagement(host.management, management),
        );
      const profile = await store.upsertManagedConnectionFromOffer({
        offer: synchronizedOffer,
        label: labelRef.current,
        management: { ...management, daemonSlug: labelRef.current },
      });
      if (profile === null) {
        throw new Error(
          "This connection belongs to another Hub. Check the Host's Connections settings.",
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
        management: { kind: "hub", hubOrigin, organizationId, daemonId, daemonSlug: label },
      });
      if (profile === null) throw new Error("This connection belongs to another Hub.");
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
  }, [daemonId, hubOrigin, label, organizationId, retry, synchronizationKey, synchronizedOffer]);

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
        store.removeManagedHost(management).then(() => undefined),
      );
    };
  }, [daemonId, hubOrigin, organizationId]);
  return null;
}

function sameManagement(left: HubHostManagement | undefined, right: HubHostManagement): boolean {
  return (
    left?.kind === "hub" &&
    left.hubOrigin === right.hubOrigin &&
    left.organizationId === right.organizationId &&
    left.daemonId === right.daemonId
  );
}
