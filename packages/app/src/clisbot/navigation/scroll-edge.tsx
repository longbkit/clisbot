import {
  createContext,
  memo,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

/** Scroll events a list hands over; a nested draggable list on native keeps `onScroll` itself. */
export interface ScrollEdgeProps {
  onScroll?: (event: ScrollEvent) => void;
  onScrollBeginDrag?: () => void;
  onScrollEndDrag?: (event: ScrollEvent) => void;
  onMomentumScrollEnd?: (event: ScrollEvent) => void;
  scrollEventThrottle?: number;
}

/**
 * Whether a list has scrolled off its top. It lives outside React state and tells only the line,
 * only when the answer changes, so scrolling re-renders nothing else.
 */
export interface ScrollEdge {
  isScrolled: () => boolean;
  subscribe: (listener: () => void) => () => void;
  report: (scrolled: boolean) => void;
  /** For a list that reports every scroll. */
  scrollProps: ScrollEdgeProps;
  /** For `NestableScrollContainer`, which overwrites `onScroll`: the line follows the drags. */
  dragProps: ScrollEdgeProps;
}

export function createScrollEdge(): ScrollEdge {
  let scrolled = false;
  const listeners = new Set<() => void>();
  function report(next: boolean) {
    if (next === scrolled) return;
    scrolled = next;
    for (const listener of listeners) listener();
  }
  function reportEvent(event: ScrollEvent) {
    report(event.nativeEvent.contentOffset.y > 0);
  }
  return {
    isScrolled: () => scrolled,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    report,
    scrollProps: { onScroll: reportEvent, scrollEventThrottle: 32 },
    dragProps: {
      onScrollBeginDrag: () => report(true),
      onScrollEndDrag: reportEvent,
      onMomentumScrollEnd: reportEvent,
    },
  };
}

/** One edge per list. */
export function useScrollEdge(): ScrollEdge {
  return useMemo(createScrollEdge, []);
}

const ScrollEdgeContext = createContext<ScrollEdge | null>(null);

/** Lets a list deep in a pane report to the pane's line, without threading a prop through it. */
export function ScrollEdgeProvider({ edge, children }: { edge: ScrollEdge; children: ReactNode }) {
  return <ScrollEdgeContext.Provider value={edge}>{children}</ScrollEdgeContext.Provider>;
}

/** The props for the provider's list; none outside a provider, as in the old sidebar. */
export function useScrollEdgeProps(kind: "scroll" | "drag"): ScrollEdgeProps | undefined {
  const edge = useContext(ScrollEdgeContext);
  if (!edge) return undefined;
  return kind === "drag" ? edge.dragProps : edge.scrollProps;
}

/**
 * The thin line where a section's fixed header ends and its list begins, shown only once the list
 * has scrolled under it, as on iOS and Material. It takes no height, so nothing moves.
 */
export const ScrollEdgeLine = memo(function ScrollEdgeLine({
  edge,
  onPhones = false,
}: {
  edge: ScrollEdge;
  /** A row is pinned under a phone's title, so the title's own line does not separate the list. */
  onPhones?: boolean;
}) {
  const scrolled = useSyncExternalStore(edge.subscribe, edge.isScrolled, edge.isScrolled);
  // A phone's controls scroll with the list and its title keeps its own line.
  const compact = useIsCompactFormFactor();
  if (compact && !onPhones) return null;
  return (
    <View style={styles.anchor} pointerEvents="none">
      {scrolled ? <View style={styles.line} testID="section-scroll-edge" /> : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  anchor: { height: 0, zIndex: 1 },
  line: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: theme.borderWidth[1],
    backgroundColor: theme.colors.borderSubtle,
  },
}));
