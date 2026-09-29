import { useEffect, type RefObject } from "react";

interface ScrollableList {
  getScrollableNode?: () => unknown;
}

/**
 * Lets a trackpad pinch zoom the page over an inverted list. A pinch arrives as a `wheel` event
 * with `ctrlKey`; react-native-web's inverted VirtualizedList handles every wheel event on its
 * scroll node by scrolling it the other way and calling `preventDefault`, so a pinch scrolled the
 * chat instead of zooming. A capture listener on the same node runs first and keeps the pinch
 * from reaching that handler, leaving the browser's zoom in place. Plain wheel scrolling is
 * untouched.
 */
export function usePinchZoomPassthrough(list: RefObject<ScrollableList | null>): void {
  useEffect(() => {
    const node = list.current?.getScrollableNode?.();
    if (!(node instanceof HTMLElement)) return;
    const letPinchThrough = (event: WheelEvent) => {
      if (event.ctrlKey) event.stopImmediatePropagation();
    };
    node.addEventListener("wheel", letPinchThrough, { capture: true });
    return () => node.removeEventListener("wheel", letPinchThrough, { capture: true });
  }, [list]);
}
