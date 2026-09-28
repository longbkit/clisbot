// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { useChatScrollPosition } from "./use-chat-scroll-position";
const scroll = (y: number) =>
  ({ nativeEvent: { contentOffset: { y } } }) as NativeSyntheticEvent<NativeScrollEvent>;
const layout = (height: number) => ({ nativeEvent: { layout: { height } } }) as LayoutChangeEvent;
it("restores after rows measure, ignoring the initial zero scroll event on returning from cowork", () => {
  const first = renderHook(() => useChatScrollPosition("cowork-roundtrip"));
  first.result.current.onScroll(scroll(120));
  first.unmount();
  const restored = renderHook(() => useChatScrollPosition("cowork-roundtrip"));
  const scrollToOffset = vi.fn();
  restored.result.current.ref.current = { scrollToOffset } as unknown as FlatList<unknown>;
  restored.result.current.onScroll(scroll(0));
  restored.result.current.onLayout(layout(615));
  restored.result.current.onContentSizeChange(390, 100);
  expect(scrollToOffset).not.toHaveBeenCalled();
  restored.result.current.onContentSizeChange(390, 1176);
  expect(scrollToOffset).toHaveBeenCalledWith({ offset: 120, animated: false });
  restored.result.current.onScroll(scroll(120));
  restored.result.current.onContentSizeChange(390, 1400);
  expect(scrollToOffset).toHaveBeenCalledTimes(1);
  restored.result.current.onScroll(scroll(80));
  restored.unmount();
  const again = renderHook(() => useChatScrollPosition("cowork-roundtrip"));
  again.result.current.ref.current = { scrollToOffset } as unknown as FlatList<unknown>;
  again.result.current.onLayout(layout(615));
  again.result.current.onContentSizeChange(390, 1176);
  expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 80, animated: false });
});
it("respects an intentional drag while waiting for rows", () => {
  const first = renderHook(() => useChatScrollPosition("drag-restore"));
  first.result.current.onScroll(scroll(120));
  first.unmount();
  const restored = renderHook(() => useChatScrollPosition("drag-restore"));
  const scrollToOffset = vi.fn();
  restored.result.current.ref.current = { scrollToOffset } as unknown as FlatList<unknown>;
  restored.result.current.onScrollBeginDrag();
  restored.result.current.onScroll(scroll(30));
  restored.result.current.onLayout(layout(615));
  restored.result.current.onContentSizeChange(390, 1176);
  expect(scrollToOffset).not.toHaveBeenCalled();
});
