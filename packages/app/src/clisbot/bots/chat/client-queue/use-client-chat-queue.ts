import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ClientInputQueue } from "@/composer/client-input-queue";
import { useResourcePrincipalScope } from "../../data/resource-principal-scope";
import { getClientChatQueue, setChatQueuePrincipal } from "./registry";

/** Principal lifetime is app-wide; route unmount must not abandon pending Chat delivery. */
export function ClientChatQueuePrincipalBinding() {
  const principal = useResourcePrincipalScope();
  useEffect(() => {
    setChatQueuePrincipal(principal);
    return () => setChatQueuePrincipal(null);
  }, [principal]);
  return null;
}
export function useClientChatQueue(serverId: string, chatId: string): ClientInputQueue {
  const principal = useResourcePrincipalScope();
  const owner = useMemo(
    () => getClientChatQueue(principal, serverId, chatId),
    [principal, serverId, chatId],
  );
  const items = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot);
  return useMemo(
    () => ({
      ...owner.local,
      items,
      manualDelivery: owner.manualDelivery,
      remove: owner.remove,
      dispatch: owner.dispatch,
    }),
    [owner, items],
  );
}
