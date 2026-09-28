import { useCallback, useEffect, useRef } from "react";

/** A dismissed form may finish its RPC, but must not navigate or dismiss a new form. */
export function useFormLifetime() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}
