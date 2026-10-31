import type { FrameClock } from "./live-batch";

/** A frame clock the test advances by hand, for the directory's live-update batching. */
export function createManualFrameClock(): FrameClock & { tick: () => void } {
  const pending = new Set<() => void>();
  return {
    request(callback) {
      pending.add(callback);
      return () => pending.delete(callback);
    },
    tick() {
      const callbacks = [...pending];
      pending.clear();
      for (const callback of callbacks) callback();
    },
  };
}
