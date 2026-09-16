import { useCallback, useEffect, useRef } from "react";

/**
 * Whether the caller that started an async confirmation is still on screen.
 * Each surface holds its own scope: cancelling the grant editor must discard a
 * late confirmation even though the Access screen around it stays mounted.
 */
export function useMountedAccessScope() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}
