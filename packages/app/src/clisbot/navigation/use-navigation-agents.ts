import { useMemo } from "react";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSourceHealthEntries, useSourceHealthSummary } from "@/hooks/use-source-health";
import { useHosts } from "@/runtime/host-runtime";
import { cachedServerIds, quietCachedAgents, registeredAgents } from "./source-liveness";

/**
 * Navigation V2's sessions: those of Hosts still in the registry, in two views.
 * `observed` is what the Hosts last said, for the issue records, which must not forget an
 * approval because its Host is out of reach. `display` is what may be drawn as happening now.
 */
export function useNavigationAgents(): {
  observed: readonly AggregatedAgent[];
  display: readonly AggregatedAgent[];
  cached: ReadonlySet<string>;
} {
  const { agents } = useAggregatedAgents({ demand: false });
  const hosts = useHosts();
  const entries = useSourceHealthEntries();
  const { degraded } = useSourceHealthSummary();
  const observed = useMemo(() => registeredAgents(agents, hosts), [agents, hosts]);
  const cachedKey = useMemo(
    () => [...cachedServerIds({ entries, degraded })].sort().join("\n"),
    [entries, degraded],
  );
  const cached = useMemo<ReadonlySet<string>>(
    () => new Set(cachedKey ? cachedKey.split("\n") : []),
    [cachedKey],
  );
  const display = useMemo(() => quietCachedAgents(observed, cached), [observed, cached]);
  return { observed, display, cached };
}
