import { useCallback, useEffect, useState } from "react";

export const HOST_WAIT_TIMEOUT_MS = 20_000;

/** Bound the UI wait, without taking reconnect ownership away from the runtime. */
export function useHostWaitTimeout(waiting: boolean, identity: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    if (!waiting) return;
    const timer = setTimeout(() => setExpired(true), HOST_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [waiting, identity, attempt]);
  const reset = useCallback(() => {
    setExpired(false);
    setAttempt((value) => value + 1);
  }, []);
  return { timedOut: waiting && expired, reset };
}
