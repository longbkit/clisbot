import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { useNavigationContainerRef } from "expo-router";
import { useNavigationState, useRoute } from "expo-router/react-navigation";
import { useReadRoutePath } from "@/navigation/route-source";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { useHorizontalScrollOptional } from "@/contexts/horizontal-scroll-context";
import { resolveMobilePanelGestureIntent } from "@/mobile-panels/gesture-intent";
import { canBeginMobilePanelGesture } from "@/mobile-panels/model";
import { useMobilePanelsRuntime } from "@/mobile-panels/provider";
import {
  backSwipeOffset,
  backSwipeScrimOpacity,
  resolveBackSwipeRelease,
} from "./detail-back-swipe-motion";
import { useDetailBack, useUsesPhoneTabs } from "./mobile-navigation";
import { holdsRoute, isDetailOnPhoneTabs } from "./phone-tab-routes";

/**
 * Android phones only. The root stack presents the host route as a transparent modal there, so the
 * retained tabs stay attached underneath and the swipe can show them. iOS keeps its native stack.
 */
export const DETAIL_BACK_SWIPE_SUPPORTED = NAVIGATION_V2_ENABLED && Platform.OS === "android";

const SETTLE_EASING = Easing.out(Easing.cubic);
/** If Back did not pop this detail, bring it home instead of leaving it off to the side. */
const UNPOPPED_RESET_MS = 1000;

/**
 * The phone's back swipe on a detail above the tabs: the detail follows the finger to the right
 * with the tabs underneath, then slides off and goes Back, or slides home
 * (docs/mobile-panels.md#detail-back-swipe).
 */
export function DetailBackSwipe({ children }: { children: ReactNode }) {
  if (!DETAIL_BACK_SWIPE_SUPPORTED) return children;
  return <DetailBackSwipeSurface>{children}</DetailBackSwipeSurface>;
}

function useDetailBackSwipeEnabled(): boolean {
  const phoneTabs = useUsesPhoneTabs();
  const route = useRoute();
  const onTabs = useNavigationState((state) => isDetailOnPhoneTabs(state, route.key));
  return phoneTabs && onTabs;
}

/** Always the same tree, enabled or not: re-wrapping the host navigator would remount it. */
function DetailBackSwipeSurface({ children }: { children: ReactNode }) {
  const enabled = useDetailBackSwipeEnabled();
  const { width } = useWindowDimensions();
  const offset = useSharedValue(0);
  const finish = useCommitBack(offset);
  const gesture = useBackSwipeGesture({ enabled, width, offset, onCommit: finish });
  const detailStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: backSwipeScrimOpacity(offset.value, width),
  }));
  return (
    <View style={styles.fill}>
      <Animated.View pointerEvents="none" style={[styles.scrim, scrimStyle]} />
      <GestureDetector gesture={gesture}>
        <Animated.View collapsable={false} style={[styles.fill, detailStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * Back runs once the detail is off screen. The pop's render may land much later on a busy JS
 * thread; the detail only comes home if the route is still in the navigation state.
 */
function useCommitBack(offset: SharedValue<number>) {
  const routeKey = useRoute().key;
  const root = useNavigationContainerRef();
  const back = useDetailBack(useReadRoutePath());
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  return useCallback(() => {
    back();
    setTimeout(() => {
      if (mounted.current && holdsRoute(root.getRootState(), routeKey))
        offset.value = withTiming(0, { easing: SETTLE_EASING });
    }, UNPOPPED_RESET_MS);
  }, [back, offset, root, routeKey]);
}

interface BackSwipeGestureInput {
  enabled: boolean;
  width: number;
  offset: SharedValue<number>;
  onCommit: () => void;
}

/**
 * The panels' horizontal arbitration, pointed right: it waits while an Explorer panel is open or
 * moving, while a terminal blocks open gestures, and while a horizontal scroller sits off its
 * start. After activation the begin checks stop running, as the panel gestures do.
 */
function useBackSwipeGesture({ enabled, width, offset, onCommit }: BackSwipeGestureInput) {
  const { motionState, openGesturesBlocked, position } = useMobilePanelsRuntime();
  const horizontalScroll = useHorizontalScrollOptional();
  const touchStart = useSharedValue({ x: 0, y: 0 });
  const active = useSharedValue(false);
  return useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .manualActivation(true)
        .onTouchesDown((event) => {
          const touch = event.changedTouches[0];
          if (!touch) return;
          touchStart.value = { x: touch.absoluteX, y: touch.absoluteY };
        })
        .onTouchesMove((event, stateManager) => {
          if (active.value) return;
          const touch = event.changedTouches[0];
          if (!touch || event.numberOfTouches !== 1) {
            stateManager.fail();
            return;
          }
          const intent = resolveMobilePanelGestureIntent({
            deltaX: touch.absoluteX - touchStart.value.x,
            deltaY: touch.absoluteY - touchStart.value.y,
            direction: 1,
            openGesturesBlocked: openGesturesBlocked.value,
          });
          const panelsAtRest = canBeginMobilePanelGesture(
            motionState.value,
            "agent",
            position.value,
          );
          if (intent === "fail" || !panelsAtRest || horizontalScroll?.isAnyScrolledRight.value) {
            stateManager.fail();
            return;
          }
          if (intent === "activate") stateManager.activate();
        })
        .onStart(() => {
          active.value = true;
        })
        .onUpdate((event) => {
          offset.value = backSwipeOffset(event.translationX, width);
        })
        .onEnd((event, success) => {
          settleBackSwipe(offset, width, onCommit, {
            translationX: event.translationX,
            velocityX: event.velocityX,
            success,
          });
        })
        .onFinalize(() => {
          active.value = false;
        }),
    [
      active,
      enabled,
      horizontalScroll?.isAnyScrolledRight,
      motionState,
      offset,
      onCommit,
      openGesturesBlocked,
      position,
      touchStart,
      width,
    ],
  );
}

/** Slide the detail off and go Back, or slide it home (`resolveBackSwipeRelease`). */
function settleBackSwipe(
  offset: SharedValue<number>,
  width: number,
  onCommit: () => void,
  input: { translationX: number; velocityX: number; success: boolean },
) {
  "worklet";
  const release = resolveBackSwipeRelease({ ...input, width });
  const timing = { duration: release.durationMs, easing: SETTLE_EASING };
  if (!release.commit) {
    offset.value = withTiming(0, timing);
    return;
  }
  offset.value = withTiming(width, timing, (finished) => {
    if (finished) scheduleOnRN(onCommit);
  });
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "#000" },
});
