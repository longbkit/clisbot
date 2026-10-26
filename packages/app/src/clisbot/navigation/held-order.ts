import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const RELEASE_MS = 1500;

/**
 * Keeps a list still while the reader is on it (brief C3: no jumpy reorder while reading). A
 * touch or a scroll holds the order on every platform; it is released a moment after.
 */
export function useHeldOrder(visibleKeys: readonly string[]) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshot = useRef<readonly string[] | null>(null);
  const latest = useRef(visibleKeys);
  latest.current = visibleKeys;
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  const hold = useCallback(() => {
    clear();
    if (!snapshot.current) snapshot.current = latest.current;
    setHolding(true);
  }, []);
  const release = useCallback(() => {
    clear();
    timer.current = setTimeout(() => {
      snapshot.current = null;
      setHolding(false);
    }, RELEASE_MS);
  }, []);
  const held = holding ? snapshot.current : null;
  const handlers = useMemo(
    () => ({
      onTouchStart: hold,
      onTouchEnd: release,
      onScrollBeginDrag: hold,
      onMomentumScrollEnd: release,
    }),
    [hold, release],
  );
  return { held, handlers };
}
