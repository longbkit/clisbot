import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { View, useWindowDimensions } from "react-native";
import { Portal } from "@gorhom/portal";
import Animated, { useAnimatedReaction, useAnimatedStyle } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Autocomplete, type AutocompleteOption } from "@/components/ui/autocomplete";
import type { AutocompleteOptionsPosition } from "@/components/ui/autocomplete-utils";
import {
  resolveCommandListMaxHeight,
  resolveCommandListPlacement,
} from "@/clisbot/composer-layout/command-list-placement";
import { COMPOSER_LAYOUT_ENABLED } from "@/clisbot/composer-layout/feature";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  measureFloatingPanelPortalHost,
  useFloatingPanelPortalHostName,
} from "@/components/ui/floating-panel-portal";
import {
  KeyboardTranslateView,
  resolveKeyboardLift,
  useKeyboardAnchor,
  useKeyboardShift,
  useSettledKeyboardShift,
} from "@/keyboard/shift";
import { SPACING } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

const OFFSET_FROM_ANCHOR = SPACING[3];

interface RelativeAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
  hostHeight: number;
}

interface AutocompletePopoverProps {
  visible: boolean;
  anchorRef: RefObject<View | null>;
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
  /**
   * Clisbot chat layout: the list opens on the anchor's side with more room, and the caller
   * orders its options for that side (the best match next to the composer).
   */
  onPositionChange?: (position: AutocompleteOptionsPosition) => void;
}

/** The chat layout's list opens where there is more room; upstream's always above. */
function useListPosition(
  rect: RelativeAnchorRect | null,
  translation: { enabled: boolean; bottomClearance: number },
): AutocompleteOptionsPosition | null {
  const safeAreaInsets = useSafeAreaInsets();
  const keyboard = useSettledKeyboardShift();
  if (!COMPOSER_LAYOUT_ENABLED) return "above-input";
  // Unmeasured: the caller keeps the side it was last told.
  if (!rect) return null;
  return resolveCommandListPlacement({
    anchorTop: rect.y,
    anchorBottom: rect.y + rect.height,
    hostHeight: rect.hostHeight,
    lift: resolveKeyboardLift({ shift: keyboard, ...translation }),
    keyboard,
    safeTop: safeAreaInsets.top,
    safeBottom: safeAreaInsets.bottom,
  });
}

export function AutocompletePopover({
  visible,
  anchorRef,
  options,
  selectedIndex,
  onSelect,
  isLoading,
  errorMessage,
  loadingText,
  emptyText,
  onPositionChange,
}: AutocompletePopoverProps): ReactElement | null {
  "use no memo";
  // React Compiler memoizes effect captures by reading SharedValue.value during render.
  const [relativeAnchorRect, setRelativeAnchorRect] = useState<RelativeAnchorRect | null>(null);
  const windowDimensions = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const portalHostName = useFloatingPanelPortalHostName();
  const { isMoving, layoutShift } = useKeyboardShift();
  const isCompact = useIsCompactFormFactor();
  const anchor = useKeyboardAnchor();
  const { measureAtRest } = anchor;
  const measurementGeneration = useRef(0);
  const canMeasure = visible && (options.length === 0 || selectedIndex >= 0);

  const remeasure = useCallback(() => {
    if (!canMeasure) return;
    const anchorElement = anchorRef.current;
    if (!anchorElement) return;
    const generation = measurementGeneration.current;
    void Promise.all([
      measureAtRest(anchorElement),
      measureFloatingPanelPortalHost(portalHostName),
    ]).then(([anchorRect, hostRect]) => {
      if (generation !== measurementGeneration.current || !anchorRect || !hostRect) {
        return undefined;
      }
      setRelativeAnchorRect({
        x: anchorRect.x - hostRect.x,
        y: anchorRect.y - hostRect.y,
        width: anchorRect.width,
        height: anchorRect.height,
        hostHeight: hostRect.height,
      });
      return undefined;
    });
  }, [anchorRef, canMeasure, measureAtRest, portalHostName]);

  useEffect(() => {
    measurementGeneration.current += 1;
    if (!canMeasure) {
      setRelativeAnchorRect(null);
      return;
    }

    remeasure();
    const raf = requestAnimationFrame(remeasure);

    return () => {
      measurementGeneration.current += 1;
      cancelAnimationFrame(raf);
    };
  }, [canMeasure, remeasure, windowDimensions.width, windowDimensions.height]);

  useAnimatedReaction(
    () => isMoving.value,
    (moving, wasMoving) => {
      if (wasMoving && !moving) {
        scheduleOnRN(remeasure);
      }
    },
    [isMoving, remeasure],
  );

  const measuredPosition = useListPosition(relativeAnchorRect, anchor.translation);
  useEffect(() => {
    if (measuredPosition) onPositionChange?.(measuredPosition);
  }, [onPositionChange, measuredPosition]);
  const position = measuredPosition ?? "above-input";
  const below = position === "below-input";

  // Lay out at the anchor's resting position; the KeyboardTranslateView below lifts
  // it with the anchor. Height changes only at keyboard boundaries.
  const baseStyle = useMemo(() => {
    if (!relativeAnchorRect) return null;
    const { x, y, width, height, hostHeight } = relativeAnchorRect;
    const edge = below
      ? { top: y + height + OFFSET_FROM_ANCHOR }
      : { bottom: hostHeight - y + OFFSET_FROM_ANCHOR };
    return inlineUnistylesStyle({ position: "absolute" as const, left: x, width, ...edge });
  }, [below, relativeAnchorRect]);

  const anchorY = relativeAnchorRect?.y ?? 0;
  const anchorBottom = anchorY + (relativeAnchorRect?.height ?? 0);
  const hostHeight = relativeAnchorRect?.hostHeight ?? 0;
  const reservedLift = anchor.reservedLift;
  const safeTop = safeAreaInsets.top;
  const safeBottom = safeAreaInsets.bottom;
  const heightStyle = useAnimatedStyle(
    () => ({
      maxHeight: Math.max(
        0,
        below
          ? hostHeight -
              (anchorBottom - reservedLift.value) -
              layoutShift.value -
              safeBottom -
              OFFSET_FROM_ANCHOR * 2
          : anchorY - reservedLift.value - safeTop - OFFSET_FROM_ANCHOR * 2,
      ),
    }),
    [below, anchorY, anchorBottom, hostHeight, layoutShift, reservedLift, safeTop, safeBottom],
  );
  // The chat layout's list may take most of a phone screen; upstream keeps its own height.
  const listMaxHeight = COMPOSER_LAYOUT_ENABLED
    ? resolveCommandListMaxHeight({ compact: isCompact, windowHeight: windowDimensions.height })
    : undefined;

  if (!visible || !relativeAnchorRect || !baseStyle) return null;
  if (options.length > 0 && selectedIndex < 0) return null;

  // The translate view is the popover's own frame, so it lifts only the popover.
  return (
    <Portal hostName={portalHostName}>
      <KeyboardTranslateView {...anchor.translation} style={baseStyle}>
        <Animated.View testID="composer-autocomplete-popover" style={heightStyle}>
          <Autocomplete
            options={options}
            optionsPosition={position}
            maxHeight={listMaxHeight}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            isLoading={isLoading}
            errorMessage={errorMessage}
            loadingText={loadingText}
            emptyText={emptyText}
          />
        </Animated.View>
      </KeyboardTranslateView>
    </Portal>
  );
}
