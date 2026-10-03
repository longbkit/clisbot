import { useEffect, useSyncExternalStore } from "react";

// The edit owns its original Hub until it unmounts after save or explicit Cancel.
// Keeping this outside the screen prevents sidebar and header controls disagreeing.
const editors = new Set<symbol>();
const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}
export function isHubSwitchLocked(): boolean {
  return editors.size > 0;
}
export function useHubSwitchLocked(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isHubSwitchLocked,
    () => false,
  );
}
export function useHubEditLock(editing = true): void {
  useEffect(() => {
    if (!editing) return;
    const id = Symbol("Hub editor");
    editors.add(id);
    notify();
    return () => {
      editors.delete(id);
      notify();
    };
  }, [editing]);
}
