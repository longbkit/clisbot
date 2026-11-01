import { useEffect, useMemo, useState } from "react";
import type { AgentProvider, ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import { orderProviderIds, useProviderRailStore } from "./rail-store";

/**
 * How long a fresh draft waits for the rail's first provider while it loads. Taking whichever
 * answered first would make the default depend on the order providers happen to finish in.
 */
export const DRAFT_DEFAULT_WAIT_MS = 1500;

interface DraftDefaultOrder {
  order: AgentProvider[];
  /** The rail's first provider that can run is still loading. */
  firstIsLoading: boolean;
}

function resolveRailOrder(
  entries: readonly ProviderSnapshotEntry[],
  savedOrder: readonly string[],
): DraftDefaultOrder {
  const order = orderProviderIds(
    entries.map((entry) => entry.provider),
    savedOrder,
  ) as AgentProvider[];
  const first = order
    .map((id) => entries.find((entry) => entry.provider === id))
    .find((entry) => entry?.enabled && (entry.status === "ready" || entry.status === "loading"));
  return { order, firstIsLoading: first?.status === "loading" };
}

/**
 * The providers a draft may settle on now, in rail order: only the first while it is worth
 * waiting for, every one after.
 */
export function resolveDraftDefaultOrder(input: {
  entries: readonly ProviderSnapshotEntry[];
  savedOrder: readonly string[];
  waitOver: boolean;
}): AgentProvider[] {
  const { order, firstIsLoading } = resolveRailOrder(input.entries, input.savedOrder);
  if (!firstIsLoading || input.waitOver) return order;
  const first = order.find((id) => {
    const entry = input.entries.find((candidate) => candidate.provider === id);
    return entry?.enabled && entry.status === "loading";
  });
  return first ? [first] : order;
}

/** `resolveDraftDefaultOrder` with its clock, which starts when the first provider is loading. */
export function useDraftDefaultOrder(
  entries: readonly ProviderSnapshotEntry[],
  serverId: string | null,
): AgentProvider[] {
  const savedOrder = useProviderRailStore((state) => state.order);
  const [waitOverFor, setWaitOverFor] = useState<string | null>(null);
  const waitOver = waitOverFor === serverId;
  const firstIsLoading = useMemo(
    () => resolveRailOrder(entries, savedOrder).firstIsLoading,
    [entries, savedOrder],
  );
  useEffect(() => {
    if (!firstIsLoading || waitOver) return undefined;
    const timer = setTimeout(() => setWaitOverFor(serverId), DRAFT_DEFAULT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [firstIsLoading, serverId, waitOver]);
  return useMemo(
    () => resolveDraftDefaultOrder({ entries, savedOrder, waitOver }),
    [entries, savedOrder, waitOver],
  );
}
