import { useCallback, useRef, type ReactNode } from "react";
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useActivityViewport } from "@/clisbot/home/activity-viewport";

/** At the top the reader sees the change happen; further down it must not move their rows. */
const AT_TOP = 2;

/**
 * Content above Home's feed that can appear or change height on its own — the connection notice,
 * the Show updates line. When it does while the reader is scrolled into the feed, the scroll moves
 * by the same amount, so no row moves under them (acceptance S1).
 */
export function HoldReadingPosition({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { scroll, offset } = useActivityViewport();
  const height = useRef<number | null>(null);
  const layout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout.height;
      const previous = height.current;
      height.current = next;
      if (previous === null || previous === next || offset.current <= AT_TOP) return;
      const y = offset.current + next - previous;
      offset.current = y;
      scroll.current?.scrollTo({ y, animated: false });
    },
    [offset, scroll],
  );
  return (
    <View style={style} onLayout={layout}>
      {children}
    </View>
  );
}
