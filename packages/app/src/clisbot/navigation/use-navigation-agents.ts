import { useMemo } from "react";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { listedAgents, quietCachedAgents } from "./source-liveness";
import { useSourceLiveness } from "./use-source-liveness";

/**
 * Navigation V2's sessions: those of listable Hosts, in two views.
 * `observed` is what the Hosts last said, for the issue records, which must not forget an
 * approval because its Host is out of reach. `display` is what may be drawn as happening now.
 */
export function useNavigationAgents(): {
  observed: readonly AggregatedAgent[];
  display: readonly AggregatedAgent[];
  cached: ReadonlySet<string>;
} {
  const { agents } = useAggregatedAgents({ demand: false });
  const { listable, cached } = useSourceLiveness();
  const observed = useMemo(() => listedAgents(agents, listable), [agents, listable]);
  const display = useMemo(() => quietCachedAgents(observed, cached), [observed, cached]);
  return { observed, display, cached };
}
