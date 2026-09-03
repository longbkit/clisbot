import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { registerHostAccessTicketResolver } from "@/runtime/host-session-access";
import type { HubHostManagement } from "@/types/host-connection";
import { useHubAccount } from "./account-provider";
import { HubAccessTicketSchema, HubDaemonsSchema } from "./contracts";
import { hubManagedHostRequiresAccessTicket } from "./managed-host-admission";

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
    queryKey: ["clisbot", "hub", hubOrigin, organizationId, "daemons"],
    queryFn: () => hub.api().get("daemons", HubDaemonsSchema),
    dataShape: "list",
    enabled: organizationId !== null,
    retry: false,
    refetchInterval: 60_000,
    staleTimeMs: 0,
  });

  if (!hub.enabled || signedIn === null || hubOrigin === null || daemons.data === undefined) {
    return null;
  }
  return daemons.data.daemons.flatMap((daemon) =>
    daemon.connectionOffer === null
      ? []
      : [
          <HubHostBinding
            key={`${signedIn.organization.id}:${daemon.id}`}
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
  const hubRef = useRef(hub);
  hubRef.current = hub;
  const synchronizedOffer = useMemo<ConnectionOffer>(
    () => ({
      v: offer.v,
      serverId: offer.serverId,
      daemonPublicKeyB64: offer.daemonPublicKeyB64,
      relay: { endpoint: offer.relay.endpoint, useTls: offer.relay.useTls },
    }),
    [offer.daemonPublicKeyB64, offer.relay.endpoint, offer.relay.useTls, offer.serverId, offer.v],
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
        label,
        management,
      });
      if (profile === null) {
        unregister();
        return;
      }
      if (!disposed && existing) await store.restartHostConnection(synchronizedOffer.serverId);
    }).catch((error: unknown) => {
      unregister();
      if (!disposed) console.warn("[Hub] Failed to synchronize Host connection", error);
    });
    return () => {
      disposed = true;
      unregister();
    };
  }, [
    daemonId,
    hubOrigin,
    issueAccessTicket,
    label,
    managedAccessMode,
    organizationId,
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
