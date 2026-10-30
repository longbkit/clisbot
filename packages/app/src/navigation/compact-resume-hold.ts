import { AppState, type AppStateStatus } from "react-native";
import { isNative } from "@/constants/platform";

/** How long the app must stay active before a size change crosses the compact breakpoint. */
const RESUME_SETTLE_MS = 1_000;

export interface CompactResumeHold {
  /** The compact decision held across a resume, or null to follow the window. */
  get(): boolean | null;
  subscribe(listener: () => void): () => void;
}

/**
 * Keeps the compact decision the app had when it left the foreground until it has been active
 * for `settleMs`. Android can report a passing window size while an activity returns (the
 * launcher's landscape, a transition frame); crossing the breakpoint on it rebuilds the phone tab
 * navigator and every compact surface. A real change (rotated while away) applies once settled.
 */
export function createCompactResumeHold(deps: {
  readCompact: () => boolean;
  listenAppState: (listener: (state: AppStateStatus) => void) => () => void;
  settleMs: number;
}): CompactResumeHold {
  const listeners = new Set<() => void>();
  let held: boolean | null = null;
  let release: ReturnType<typeof setTimeout> | undefined;
  let stopListening: (() => void) | null = null;
  const publish = (next: boolean | null) => {
    if (held === next) return;
    held = next;
    for (const listener of listeners) listener();
  };
  const onAppState = (state: AppStateStatus) => {
    clearTimeout(release);
    if (state !== "active") {
      publish(held ?? deps.readCompact());
      return;
    }
    if (held !== null) release = setTimeout(() => publish(null), deps.settleMs);
  };
  return {
    get: () => held,
    subscribe(listener) {
      listeners.add(listener);
      stopListening ??= deps.listenAppState(onAppState);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stopListening?.();
        stopListening = null;
        clearTimeout(release);
        held = null;
      };
    },
  };
}

const NO_HOLD: CompactResumeHold = { get: () => null, subscribe: () => () => undefined };

/** The app's hold; web has no resume transition, so its window size applies at once. */
export function createAppCompactResumeHold(readCompact: () => boolean): CompactResumeHold {
  if (!isNative) return NO_HOLD;
  return createCompactResumeHold({
    readCompact,
    listenAppState: (listener) => {
      const subscription = AppState.addEventListener("change", listener);
      return () => subscription.remove();
    },
    settleMs: RESUME_SETTLE_MS,
  });
}
