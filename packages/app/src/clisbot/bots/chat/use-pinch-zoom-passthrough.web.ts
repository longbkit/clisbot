import { useEffect, type RefObject } from "react";

interface ScrollableList {
  getScrollableNode?: () => unknown;
}

/**
 * Lets a trackpad pinch zoom the page over an inverted list. A pinch arrives as a `wheel` event
 * with `ctrlKey`; react-native-web's inverted VirtualizedList handles every wheel event on its
 * scroll node by scrolling it the other way and calling `preventDefault`, so a pinch scrolled the
 * chat instead of zooming.
 *
 * The pinch is stopped on its way up, at the content container just inside the scroll node:
 * everything inside a message (a Mermaid diagram zooms on ctrl+wheel) has already handled it, and
 * the scroll node's handler never sees it. A pinch aimed at the scroll node itself, outside the
 * content, is stopped there in the capture phase. Plain wheel scrolling is untouched.
 */
export function usePinchZoomPassthrough(list: RefObject<ScrollableList | null> | undefined): void {
  useEffect(() => {
    const node = list?.current?.getScrollableNode?.();
    if (!(node instanceof HTMLElement)) return;
    const content = node.firstElementChild;
    const stopPinch = (event: WheelEvent) => {
      if (event.ctrlKey) event.stopPropagation();
    };
    const stopPinchOnNode = (event: WheelEvent) => {
      if (event.ctrlKey && event.target === node) event.stopImmediatePropagation();
    };
    content?.addEventListener("wheel", stopPinch as EventListener);
    node.addEventListener("wheel", stopPinchOnNode, { capture: true });
    return () => {
      content?.removeEventListener("wheel", stopPinch as EventListener);
      node.removeEventListener("wheel", stopPinchOnNode, { capture: true });
    };
  }, [list]);
}
