import { Platform } from "react-native";
import { batchSessionStoreUpdates } from "@/stores/session-store";

/**
 * Clisbot: live `agent_update` / `workspace_update` messages from every Host land once per frame as
 * one store commit, instead of one or more commits per message. Off applies each on arrival.
 */
export const DIRECTORY_FRAME_BATCHING_ENABLED = true;

// Android can hold frames back while its JS thread is busy; a burst still lands within this.
const ANDROID_FRAME_CAP_MS = 250;

export interface FrameClock {
  /** Calls `callback` at the next frame; the returned function cancels it. */
  request(callback: () => void): () => void;
}

/** The app's frame clock for live directory updates, shared by every Host; null while off. */
export function createDirectoryFrameClock(): FrameClock | null {
  return DIRECTORY_FRAME_BATCHING_ENABLED ? shareFrames({ request: requestFrame }) : null;
}

/**
 * One frame for every Host: callbacks requested before it fires run together, in request order,
 * inside one session-store batch, so a frame publishes one commit however many Hosts sent updates.
 * A callback cancelled before the frame (its Host flushed early) does not run.
 */
export function shareFrames(clock: FrameClock): FrameClock {
  const pending = new Set<() => void>();
  let cancelFrame: (() => void) | null = null;
  function runFrame(): void {
    cancelFrame = null;
    const callbacks = [...pending];
    pending.clear();
    batchSessionStoreUpdates(() => {
      for (const callback of callbacks) callback();
    });
  }
  return {
    request(callback) {
      pending.add(callback);
      cancelFrame ??= clock.request(runFrame);
      return () => {
        // A callback the frame already took is no longer pending; it must not cancel the next frame.
        if (!pending.delete(callback) || pending.size > 0 || !cancelFrame) return;
        cancelFrame();
        cancelFrame = null;
      };
    },
  };
}

function requestFrame(callback: () => void): () => void {
  let settled = false;
  const frame = requestAnimationFrame(run);
  const cap = Platform.OS === "android" ? setTimeout(run, ANDROID_FRAME_CAP_MS) : null;
  function cancel(): void {
    settled = true;
    cancelAnimationFrame(frame);
    if (cap !== null) clearTimeout(cap);
  }
  function run(): void {
    if (settled) return;
    cancel();
    callback();
  }
  return cancel;
}

export interface LiveUpdateBatch<T> {
  /** Holds `update` until the next frame, or applies it now when there is no frame clock. */
  push(update: T): void;
  /** Applies everything held, in arrival order, now. */
  flush(): void;
}

export function createLiveUpdateBatch<T>(
  clock: FrameClock | null,
  apply: (updates: readonly T[]) => void,
): LiveUpdateBatch<T> {
  let held: T[] = [];
  let cancel: (() => void) | null = null;
  function flush(): void {
    cancel?.();
    cancel = null;
    if (held.length === 0) return;
    const updates = held;
    held = [];
    apply(updates);
  }
  return {
    push(update) {
      if (!clock) {
        apply([update]);
        return;
      }
      held.push(update);
      cancel ??= clock.request(flush);
    },
    flush,
  };
}
