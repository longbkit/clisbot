import { useCallback, useRef } from "react";
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
const offsets = new Map<string, number>();
/** Wait for measured rows before restoring: an initial contentOffset can be clamped to zero. */
export function useChatScrollPosition<T>(key: string) {
  const ref = useRef<FlatList<T> | null>(null);
  const state = useRef({ key, pending: offsets.get(key) ?? 0, height: 0, contentHeight: 0 });
  if (state.current.key !== key)
    state.current = { key, pending: offsets.get(key) ?? 0, height: 0, contentHeight: 0 };
  const restore = useCallback(() => {
    const current = state.current;
    if (
      current.pending > 0 &&
      current.height > 0 &&
      current.contentHeight - current.height >= current.pending
    ) {
      ref.current?.scrollToOffset({ offset: current.pending, animated: false });
    }
  }, []);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      state.current.height = event.nativeEvent.layout.height;
      restore();
    },
    [restore],
  );
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      state.current.contentHeight = height;
      restore();
    },
    [restore],
  );
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = Math.max(0, event.nativeEvent.contentOffset.y);
      if (state.current.pending > 0 && Math.abs(offset - state.current.pending) > 1) return;
      state.current.pending = 0;
      offsets.delete(key);
      offsets.set(key, offset);
      if (offsets.size > 100) offsets.delete(offsets.keys().next().value!);
    },
    [key],
  );
  const onScrollBeginDrag = useCallback(() => {
    state.current.pending = 0;
  }, []);
  return {
    ref,
    onLayout,
    onContentSizeChange,
    onScroll,
    onScrollBeginDrag,
    scrollEventThrottle: 100,
  };
}
