import { useEffect, useState } from "react";
import { CONNECT_STALL_MS } from "./hosts-strip-model";

/** A Host still connecting or idle: when it entered that status, if known. */
export interface WaitingHost {
  since: number | null;
}

interface Deadline {
  timer: ReturnType<typeof setTimeout>;
  listeners: Set<() => void>;
}

/**
 * One timer per distinct moment. The strip, the rail and More dots and every list's reachability
 * read the same Hosts, so they compute the same deadline and share its timer.
 */
const deadlines = new Map<number, Deadline>();

function subscribeDeadline(at: number, listener: () => void): () => void {
  let entry = deadlines.get(at);
  if (!entry) {
    const listeners = new Set<() => void>();
    const timer = setTimeout(
      () => {
        deadlines.delete(at);
        for (const notify of listeners) notify();
      },
      Math.max(0, at - Date.now()),
    );
    entry = { timer, listeners };
    deadlines.set(at, entry);
  }
  entry.listeners.add(listener);
  const subscribed = entry;
  return () => {
    subscribed.listeners.delete(listener);
    if (subscribed.listeners.size > 0 || deadlines.get(at) !== subscribed) return;
    clearTimeout(subscribed.timer);
    deadlines.delete(at);
  };
}

/** The first moment after `now` at which a waiting Host counts as stalled, if any. */
function nextStall(waiting: readonly WaitingHost[], now: number): number | null {
  let next: number | null = null;
  for (const { since } of waiting) {
    if (since === null) continue;
    const at = since + CONNECT_STALL_MS + 1;
    if (at > now && (next === null || at < next)) next = at;
  }
  return next;
}

/**
 * The time the strip judges stalled first connections by (`effectiveHostStatus`). It moves only
 * when a waiting Host crosses `CONNECT_STALL_MS`, not on a periodic tick.
 */
export function useStallNow(waiting: readonly WaitingHost[]): number {
  const [now, setNow] = useState(() => Date.now());
  const next = nextStall(waiting, now);
  useEffect(() => {
    if (next === null) return;
    return subscribeDeadline(next, () => setNow(Date.now()));
  }, [next]);
  return now;
}
