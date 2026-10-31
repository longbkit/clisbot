import { useDeferredValue, useState } from "react";

/**
 * The value a hidden retained pane last rendered with. While `active` is false the hook returns
 * the value seen when the pane was hidden, so memoized consumers below it skip every source update;
 * the first active render returns the current value. Pair it with `useRetainedPanelActive`
 * (docs/mobile-panels.md): the tree stays mounted, its inputs stop moving.
 */
export function useHeldWhileInactive<T>(value: T, active: boolean): T {
  const [hidden, setHidden] = useState<HeldValue<T> | null>(active ? null : { value });
  if (active) {
    if (hidden) setHidden(null);
    return value;
  }
  if (hidden) return hidden.value;
  setHidden({ value });
  return value;
}

interface HeldValue<T> {
  value: T;
}

/**
 * `active` for a held pane whose catch-up is too costly for the show's own commit: a show reaches
 * it in a low-priority render after that commit, which input can interrupt; a hide reaches it at
 * once. Never gate the retained panel itself on it (docs/mobile-panels.md#phone-tabs): the panel
 * shows in the press's commit with its held content, and only the catch-up waits.
 */
export function useActiveAfterShow(active: boolean): boolean {
  const deferred = useDeferredValue(active);
  return active && deferred;
}
