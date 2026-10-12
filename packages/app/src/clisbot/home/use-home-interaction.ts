import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PointerEvent,
} from "react-native";

/** Pointer, touch, keyboard focus and momentum all protect a reader's current position. */
export function useHomeInteraction() {
  const [hover, setHover] = useState(false);
  const [touch, setTouch] = useState(false);
  const [focus, setFocus] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [active, setActive] = useState(AppState.currentState !== "background");
  const offset = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => {
      subscription.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
    setAtTop(offset.current <= 2);
    setScrolling(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setScrolling(false), 750);
  }, []);
  const onPointerEnter = useCallback((event: PointerEvent) => {
    if (event.nativeEvent.pointerType === "mouse") setHover(true);
  }, []);
  const onPointerLeave = useCallback(() => setHover(false), []);
  const onTouchStart = useCallback(() => setTouch(true), []);
  const onTouchEnd = useCallback(() => setTouch(false), []);
  const onFocus = useCallback(() => setFocus(true), []);
  const onBlur = useCallback(() => setFocus(false), []);
  const handlers = useMemo(
    () => ({
      onPointerEnter,
      onPointerLeave,
      onTouchStart,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
      onFocus,
      onBlur,
    }),
    [onPointerEnter, onPointerLeave, onTouchStart, onTouchEnd, onFocus, onBlur],
  );
  return {
    automatic: active && atTop && !hover && !touch && !focus && !scrolling,
    offset,
    onScroll,
    handlers,
  };
}
