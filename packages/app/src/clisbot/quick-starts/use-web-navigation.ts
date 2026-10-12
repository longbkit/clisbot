import { useEffect, useRef } from "react";
import { isWeb } from "@/constants/platform";
import type { QuickStartView } from "@clisbot/protocol/quick-starts/types";
import type { QuickStartFormState } from "./form-model";
interface Frame {
  open: boolean;
  edit: QuickStartFormState | null;
  menu: QuickStartView | null;
  picker: string | null;
}
// Register before the router's listener. Overlay traversals must be consumed
// before it normalizes history.state or remounts the underlying screen.
const traversals = new Set<(event: PopStateEvent) => boolean>();
if (isWeb && typeof window !== "undefined")
  window.addEventListener(
    "popstate",
    (event) => {
      for (const consume of [...traversals].toReversed()) {
        if (consume(event)) {
          event.stopImmediatePropagation();
          break;
        }
      }
    },
    true,
  );
const CLOSED: Frame = { open: false, edit: null, menu: null, picker: null };
/** History carries opaque positions only. Drafts stay in memory, never in browser history. */
export function useQuickStartWebNavigation(frame: Frame, restoreFrame: (frame: Frame) => void) {
  const depth = frame.open ? 1 + Number(!!frame.edit || !!frame.menu) + Number(!!frame.picker) : 0;
  const state = useRef({
    depth: 0,
    baseUrl: "",
    id: `quick-starts-${Math.random().toString(36).slice(2)}`,
    frames: new Map<number, Frame>(),
  });
  const restore = useRef(restoreFrame);
  restore.current = restoreFrame;
  // Refresh the current position as input changes, without pushing a history entry per keystroke.
  if (depth) state.current.frames.set(depth, frame);
  useEffect(() => {
    if (!isWeb) return;
    const pop = (event: PopStateEvent) => {
      const marker = event.state?.quickStartsOverlay;
      const ownsEntry = marker?.id === state.current.id;
      const returnsToBase =
        state.current.depth > 0 && window.location.href === state.current.baseUrl;
      // Overlay entries share the underlying route. Letting React Navigation consume
      // them would normalize away our marker and desynchronize Back/Forward.
      if (!ownsEntry && !returnsToBase) return false;
      const next = ownsEntry ? marker.depth : 0;
      if (next === state.current.depth) return true;
      state.current.depth = next;
      restore.current(state.current.frames.get(next) ?? CLOSED);
      return true;
    };
    traversals.add(pop);
    return () => {
      traversals.delete(pop);
    };
  }, []);
  useEffect(() => {
    if (!isWeb) return;
    const previous = state.current.depth;
    state.current.depth = depth;
    if (depth > previous) {
      if (previous === 0) state.current.baseUrl = window.location.href;
      for (let level = previous + 1; level <= depth; level++) {
        if (!state.current.frames.has(level))
          state.current.frames.set(level, { ...CLOSED, open: true });
        window.history.pushState(
          {
            ...window.history.state,
            quickStartsOverlay: { id: state.current.id, depth: level },
          },
          "",
        );
      }
    } else if (
      depth < previous &&
      window.history.state?.quickStartsOverlay?.id === state.current.id
    ) {
      window.history.go(depth - previous);
    }
  }, [depth]);
}
