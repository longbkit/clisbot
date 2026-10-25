import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { activityLayout, activityLayoutChanges } from "./activity-layout";
import type { ActivityBucketOf } from "./activity";

/** Batch structural changes only while Home is idle at the top; live row contents are independent. */
export function useActivityLayout(
  agents: AggregatedAgent[],
  day: string,
  automatic: boolean,
  bucketOf?: ActivityBucketOf,
) {
  const [accepted, setAccepted] = useState(() =>
    activityLayout(agents, new Date(day), [], bucketOf),
  );
  const next = useMemo(
    () => activityLayout(agents, new Date(day), accepted, bucketOf),
    [agents, day, accepted, bucketOf],
  );
  const pending = activityLayoutChanges(accepted, next);
  const latest = useRef(next);
  useEffect(() => {
    latest.current = next;
  }, [next]);
  const accept = useCallback(() => setAccepted(latest.current), []);
  const empty = accepted.length === 0;
  const ready = pending > 0 && (automatic || empty);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(accept, empty ? 0 : 750);
    return () => clearTimeout(timer);
    // The first pending change starts the deadline; later data joins that same batch.
  }, [ready, empty, accept]);
  return { accepted, next, pending, accept };
}
