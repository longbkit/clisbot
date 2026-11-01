import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { createScrollEdge } from "./scroll-edge";

function scrollTo(y: number) {
  return { nativeEvent: { contentOffset: { x: 0, y } } } as NativeSyntheticEvent<NativeScrollEvent>;
}

describe("scroll edge", () => {
  it("starts at the top and tells its listeners only when it crosses it", () => {
    const edge = createScrollEdge();
    const listener = vi.fn();
    edge.subscribe(listener);
    expect(edge.isScrolled()).toBe(false);
    for (const y of [0, 10, 40, 300]) edge.scrollProps.onScroll?.(scrollTo(y));
    expect(edge.isScrolled()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    for (const y of [120, 0, 0]) edge.scrollProps.onScroll?.(scrollTo(y));
    expect(edge.isScrolled()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignores an overscroll past the top", () => {
    const edge = createScrollEdge();
    edge.scrollProps.onScroll?.(scrollTo(-40));
    expect(edge.isScrolled()).toBe(false);
  });

  it("follows the drags of a list that keeps its scroll events", () => {
    const edge = createScrollEdge();
    edge.dragProps.onScrollBeginDrag?.();
    expect(edge.isScrolled()).toBe(true);
    edge.dragProps.onScrollEndDrag?.(scrollTo(0));
    expect(edge.isScrolled()).toBe(false);
    edge.dragProps.onScrollBeginDrag?.();
    edge.dragProps.onMomentumScrollEnd?.(scrollTo(200));
    expect(edge.isScrolled()).toBe(true);
  });
});
