import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { ScrollView, View, useWindowDimensions, type ScrollViewProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { useHomeInteraction } from "./use-home-interaction";
import { useActivityAnchor } from "./use-activity-anchor";
import { openPreloads } from "@/open-preload/live";

type ActivityViewport = ReturnType<typeof useActivityAnchor> &
  Pick<ReturnType<typeof useHomeInteraction>, "automatic" | "onScroll" | "offset">;
const Context = createContext<ActivityViewport | null>(null);
export function useActivityViewport() {
  const value = useContext(Context);
  if (!value) throw new Error("Home activity requires its viewport");
  return value;
}

export function ActivityViewportProvider({ children }: { children: ReactNode }) {
  const { automatic, offset, onScroll, handlers } = useHomeInteraction();
  const { scroll, viewport, register, apply, onUserScroll } = useActivityAnchor(offset);
  const value = useMemo(
    () => ({ automatic, onScroll, offset, scroll, viewport, register, apply, onUserScroll }),
    [automatic, onScroll, offset, scroll, viewport, register, apply, onUserScroll],
  );
  return (
    <Context.Provider value={value}>
      <View style={styles.fill} {...handlers}>
        {children}
      </View>
    </Context.Provider>
  );
}

export function ActivityScrollView(props: ScrollViewProps) {
  const { scroll, viewport, onScroll, onUserScroll } = useActivityViewport();
  const webHandlers = isWeb ? { onWheel: onUserScroll, onKeyDown: onUserScroll } : {};
  // A drag means the touch that pressed a row in was a scroll, not a tap.
  const beginDrag = useCallback(() => {
    onUserScroll();
    openPreloads.cancelQueued();
  }, [onUserScroll]);
  return (
    <View ref={viewport} collapsable={false} style={styles.fill}>
      <ScrollView
        {...props}
        {...webHandlers}
        style={[styles.scroll, props.style]}
        ref={scroll}
        onScroll={onScroll}
        onTouchStart={onUserScroll}
        onPointerDown={onUserScroll}
        onScrollBeginDrag={beginDrag}
        scrollEventThrottle={32}
      />
    </View>
  );
}

export function ActivityAnchor({ identity, children }: { identity: string; children: ReactNode }) {
  const { register } = useActivityViewport();
  const { fontScale } = useWindowDimensions();
  const style = useMemo(() => [styles.row, { height: 56 * fontScale }], [fontScale]);
  const ref = useCallback((view: View | null) => register(identity, view), [identity, register]);
  return (
    <View ref={ref} collapsable={false} style={style} testID={`home-activity-slot-${identity}`}>
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Home restores its own cross-section anchor; browser anchoring would move it a second time.
  scroll: { flex: 1, ...(isWeb ? { overflowAnchor: "none" as const } : {}) },
  row: { height: 56, justifyContent: "center" },
});
