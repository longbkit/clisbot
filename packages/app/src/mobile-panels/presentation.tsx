import { scheduleOnRN } from "react-native-worklets";
import { nativePerformanceTrace, traceInstant } from "@/performance/native-trace";
import { useId, useMemo, useLayoutEffect, type ComponentProps, type ReactNode } from "react";
import { Pressable, StyleSheet, type ViewProps, type GestureResponderEvent } from "react-native";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useAnimatedReaction } from "react-native-reanimated";
import { isWeb } from "@/constants/platform";
import { WindowChromeRootRegion } from "@/utils/desktop-window";
import { usePanelStore, type MobilePanelView } from "@/stores/panel-store";
import { getMobilePanelFrame } from "./model";
import { useIsMobilePanelActive, useMobilePanelsRuntime } from "./provider";

type OverlayPanel = Exclude<MobilePanelView, "agent">;

interface MobilePanelOverlayProps {
  children: ReactNode;
  closeGesture: GestureType;
  panel: OverlayPanel;
  presented?: boolean;
  presentation?: "overlay" | "dock";
  dockVisible?: boolean;
  frameStyle?: ComponentProps<typeof Animated.View>["style"];
  panelStyle?: ComponentProps<typeof Animated.View>["style"];
}

function tracePanelVisual(panel: string, visible: boolean, workletMs: number) {
  traceInstant("clisbot.back.panelVisual", {
    panel,
    visible: String(visible),
    uiMs: String(workletMs),
  });
}

/** Diagnostic-only observer; does not participate in gesture/responder arbitration. */
function PanelHitTrace({
  panel,
  presented,
  isOpen,
}: {
  panel: OverlayPanel;
  presented: boolean;
  isOpen: boolean;
}) {
  const { position } = useMobilePanelsRuntime();
  useAnimatedReaction(
    () => (panel === "agent-list" ? position.value < 0 : position.value > 0),
    (visible, previous) => {
      if (visible !== previous) scheduleOnRN(tracePanelVisual, panel, visible, performance.now());
    },
    [panel],
  );
  useLayoutEffect(() => {
    traceInstant("clisbot.back.panelCommit", {
      panel,
      presented: String(presented),
      open: String(isOpen),
      host: presented ? "box-none" : "none",
      child: !isWeb || isOpen ? "auto" : "none",
    });
  }, [isOpen, panel, presented]);
  return null;
}

function panelTraceProps(panel: OverlayPanel): ViewProps {
  if (!nativePerformanceTrace.isEnabled()) return {};
  const touch = (phase: string) => (event: GestureResponderEvent) => {
    const e = event.nativeEvent;
    traceInstant(`clisbot.back.overlay${phase}`, {
      panel,
      ms: String(e.timestamp),
      tag: String(e.target),
    });
  };
  return {
    onTouchStart: touch("Start"),
    onTouchEnd: touch("End"),
    onTouchCancel: touch("Cancel"),
    onLayout: (event) =>
      event.currentTarget.measureInWindow((x, y, width, height) => {
        traceInstant("clisbot.back.overlayBounds", {
          panel,
          x: String(x),
          y: String(y),
          w: String(width),
          h: String(height),
        });
      }),
  };
}

function overlayHostPointerEvents(
  presented: boolean,
  isOpen: boolean,
): "auto" | "box-none" | "none" {
  if (!presented) return "none";
  if (!isWeb) return "box-none";
  return isOpen ? "auto" : "none";
}

export function MobilePanelOverlay({
  children,
  closeGesture,
  panel,
  panelStyle,
  presented = true,
  presentation = "overlay",
  dockVisible = false,
  frameStyle,
}: MobilePanelOverlayProps) {
  const { position, windowWidth } = useMobilePanelsRuntime();
  const diagnosticProps = useMemo(() => panelTraceProps(panel), [panel]);
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const overlayOpen = useIsMobilePanelActive(panel);
  const docked = presentation === "dock";
  const isOpen = presented && (docked ? dockVisible : overlayOpen);
  const hostId = useId();
  const isLeft = panel === "agent-list";

  const sidebarAnimatedStyle = useAnimatedStyle(() => {
    if (docked) return { transform: [{ translateX: 0 }] };
    const frame = getMobilePanelFrame(position.value, windowWidth);
    return {
      transform: [{ translateX: isLeft ? frame.leftTranslateX : frame.rightTranslateX }],
    };
  }, [docked, isLeft, windowWidth]);

  const backdropAnimatedStyle = useAnimatedStyle(() => {
    const frame = getMobilePanelFrame(position.value, windowWidth);
    return { opacity: isLeft ? frame.leftBackdropOpacity : frame.rightBackdropOpacity };
  }, [isLeft, windowWidth]);

  const overlayAnimatedStyle = useAnimatedStyle(() => {
    if (docked) return { opacity: 1, display: "flex" as const, pointerEvents: "box-none" as const };
    const isVisible = isLeft ? position.value < 0 : position.value > 0;
    if (isWeb) {
      return { display: isVisible ? ("flex" as const) : ("none" as const) };
    }
    // Preserve native scroll ranges while hidden. Collapsing layout makes Android
    // spring retained scroll offsets back to zero on touch cancellation or release.
    return {
      opacity: isVisible ? 1 : 0,
      pointerEvents: isVisible ? ("box-none" as const) : ("none" as const),
    };
  }, [docked, isLeft]);

  const positionedPanelStyle = isLeft ? styles.leftPanel : styles.rightPanel;
  const backdropStyle = useMemo(
    () => [styles.backdrop, backdropAnimatedStyle],
    [backdropAnimatedStyle],
  );
  const combinedPanelStyle = useMemo(
    () => [
      docked ? styles.dockedPanel : styles.panel,
      !docked && positionedPanelStyle,
      !docked && { width: windowWidth },
      panelStyle,
      sidebarAnimatedStyle,
    ],
    [docked, panelStyle, positionedPanelStyle, sidebarAnimatedStyle, windowWidth],
  );
  // Global screens hide retained native chrome without collapsing its scroll ranges.
  // This host guard also wins over a previously settled agent-list worklet position.
  const overlayPointerEvents = overlayHostPointerEvents(presented, isOpen);

  // Native visibility already gates the entire subtree on the UI thread. A second
  // settled React gate can leave visible rows untouchable while its publication waits
  // behind JS work. Keep descendants eligible under that ancestor; global screens
  // still block the host, and activity/accessibility retain their settled policy.
  const childPointerEvents = !isWeb || isOpen ? "auto" : "none";

  return (
    <GestureDetector gesture={closeGesture} touchAction="pan-y">
      {/* Fabric needs an always-mounted native host to attach the close handler while the
          retained panel content is hidden. nativeID keeps that host registered. */}
      <Animated.View
        {...diagnosticProps}
        accessibilityElementsHidden={!isOpen}
        collapsable={false}
        importantForAccessibility={isOpen ? "auto" : "no-hide-descendants"}
        nativeID={`${panel}-gesture-host-${hostId}`}
        pointerEvents={overlayPointerEvents}
        style={[
          docked ? styles.dock : styles.overlay,
          frameStyle,
          !presented && styles.notPresented,
          docked && !dockVisible && { display: "none" },
        ]}
      >
        {nativePerformanceTrace.isEnabled() ? (
          <PanelHitTrace panel={panel} presented={presented} isOpen={isOpen} />
        ) : null}
        <Animated.View style={[docked ? styles.dockedPanel : styles.overlay, overlayAnimatedStyle]}>
          <Pressable
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onPress={showMobileAgent}
            pointerEvents={childPointerEvents}
            style={[StyleSheet.absoluteFill, docked && { display: "none" }]}
            testID={isOpen ? `${panel}-backdrop` : undefined}
          >
            <Animated.View pointerEvents="none" style={backdropStyle} />
          </Pressable>

          <Animated.View pointerEvents={childPointerEvents} style={combinedPanelStyle}>
            <WindowChromeRootRegion corners="both">{children}</WindowChromeRootRegion>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

// Reanimated owns only these static native styles and the derived transform.
// Theme values stay inline at call sites, avoiding Unistyles patching the same
// native node after Fabric commits.
const styles = StyleSheet.create({
  dock: { flexShrink: 0, minHeight: 0 },
  dockedPanel: { flex: 1, minHeight: 0, overflow: "hidden" },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  notPresented: { opacity: 0 },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    overflow: "hidden",
  },
  leftPanel: {
    left: 0,
  },
  rightPanel: {
    right: 0,
  },
});
