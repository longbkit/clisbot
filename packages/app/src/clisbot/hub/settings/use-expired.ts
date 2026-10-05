import { useEffect, useState } from "react";

// setTimeout fires at once past this delay, so a far deadline waits in steps.
const MAX_TIMER_MS = 2_147_483_647;

/** True once `expiresAt` has passed; re-renders the caller at that moment. */
export function useExpired(expiresAt: string): boolean {
  const deadline = new Date(expiresAt).getTime();
  const [expired, setExpired] = useState(() => Date.now() >= deadline);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (expired) return;
    const remaining = Math.max(deadline - Date.now(), 0);
    const timer = setTimeout(
      () => (remaining > MAX_TIMER_MS ? setTick((current) => current + 1) : setExpired(true)),
      Math.min(remaining, MAX_TIMER_MS),
    );
    return () => clearTimeout(timer);
  }, [deadline, expired, tick]);
  return expired;
}
