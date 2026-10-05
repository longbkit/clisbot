import { useCallback, useEffect, useRef } from "react";
import { isWeb } from "@/constants/platform";
import { getOverlayRoot } from "@/lib/overlay-root";

// A desktop Combobox covers the page with a click-to-close backdrop. The wheel
// then landed on the backdrop and the page could not scroll while a list was
// open. These two hooks let the page scroll under an open list, and keep the
// list on its field while it does. Web only: native lists are sheets or modals.

const LINE_PX = 16;

/**
 * Scrolls what sits under the pointer when the wheel turns outside the list.
 * Returns the ref setter for the list's root (a wheel inside it scrolls it).
 */
export function useWheelThroughBackdrop(active: boolean) {
  const list = useRef<unknown>(null);
  const setList = useCallback((value: unknown) => {
    list.current = value;
  }, []);
  useEffect(() => {
    if (!isWeb || !active || typeof document === "undefined") return;
    const onWheel = (event: WheelEvent) => {
      const node = list.current;
      // React Native Web hands back the DOM element as the host ref.
      if (node instanceof Element && event.target instanceof Node && node.contains(event.target)) {
        return;
      }
      scrollUnderPointer(event);
    };
    document.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => document.removeEventListener("wheel", onWheel, { capture: true });
  }, [active]);
  return setList;
}

/** Re-places an open list on its field whenever anything on the page scrolls. */
export function useFollowAnchorOnScroll(active: boolean, follow: () => void) {
  useEffect(() => {
    if (!isWeb || !active || typeof document === "undefined") return;
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        follow();
      });
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [active, follow]);
}

function scrollUnderPointer(event: WheelEvent): void {
  const overlay = getOverlayRoot();
  const below = document
    .elementsFromPoint(event.clientX, event.clientY)
    .find((element) => !overlay.contains(element));
  const target = below === undefined ? null : scrollableAncestor(below);
  if (target === null) return;
  const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_PX : 1;
  target.scrollBy({ left: event.deltaX * scale, top: event.deltaY * scale });
}

/** The nearest element that can scroll in either direction, or the document's. */
function scrollableAncestor(start: Element): Element | null {
  for (let node: Element | null = start; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node);
    const scrollsY =
      /(auto|scroll)/u.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    const scrollsX = /(auto|scroll)/u.test(style.overflowX) && node.scrollWidth > node.clientWidth;
    if (scrollsY || scrollsX) return node;
  }
  return document.scrollingElement;
}
