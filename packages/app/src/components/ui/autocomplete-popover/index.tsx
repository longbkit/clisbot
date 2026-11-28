import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Portal } from "@gorhom/portal";
import { useAnimatedReaction, useAnimatedRef } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Autocomplete,
  type AutocompleteOption,
  type AutocompleteStatus,
} from "@/components/ui/autocomplete";
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
import { useRetainedPanelActive } from "@/components/retained-panel";
import { KeyboardTranslateView, useKeyboardAnchor, useKeyboardShift } from "@/keyboard/shift";
import { PopoverFrame } from "./internal/frame";
import type { AnchorAtRest } from "./internal/placement";

interface AutocompletePopoverProps {
  visible: boolean;
  children: ReactNode;
  anchorStyle?: StyleProp<ViewStyle>;
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  status?: AutocompleteStatus | null;
  /**
   * Clisbot chat layout: the list opens on the anchor's side with more room, and the caller
   * orders its options for that side (the best match next to the composer).
   */
  onPositionChange?: (position: AutocompleteOptionsPosition) => void;
  /**
   * Clisbot: the caller shows this list with no row selected on purpose (a Chat's bare `/`), so
   * the popover measures without waiting for a selection. Upstream lists always have one.
   */
  selectionOptional?: boolean;
}

/** The keyboard as it was when the anchor was last measured at rest. */
interface KeyboardAtRest {
  /** Keyboard height above the bottom safe area; 0 while it is closed. */
  shift: number;
  /** How far the anchor rides up with that keyboard. */
  lift: number;
}

/** The chat layout's list opens where there is more room; upstream's always above. */
function resolveListPosition(input: {
  anchorAtRest: AnchorAtRest | null;
  keyboardAtRest: KeyboardAtRest;
  safeTop: number;
  safeBottom: number;
}): AutocompleteOptionsPosition | null {
  if (!COMPOSER_LAYOUT_ENABLED) return "above-input";
  const { anchorAtRest, keyboardAtRest } = input;
  // Unmeasured: the caller keeps the side it was last told.
  if (!anchorAtRest) return null;
  return resolveCommandListPlacement({
    anchorTop: anchorAtRest.y,
    anchorBottom: anchorAtRest.y + anchorAtRest.height,
    hostHeight: anchorAtRest.hostHeight,
    lift: keyboardAtRest.lift,
    keyboard: keyboardAtRest.shift,
    safeTop: input.safeTop,
    safeBottom: input.safeBottom,
  });
}

export function AutocompletePopover({
  visible,
  children,
  anchorStyle,
  options,
  selectedIndex,
  onSelect,
  status,
  onPositionChange,
  selectionOptional = false,
}: AutocompletePopoverProps): ReactElement | null {
  "use no memo";
  // React Compiler memoizes effect captures by reading SharedValue.value during render.
  const anchorRef = useAnimatedRef<View>();
  // The animated ref returns its native handle, which React 19 would call as a ref cleanup.
  // The anchor stays a plain View: its style is the caller's Unistyles style.
  const setAnchorElement = useCallback(
    (element: View | null) => {
      anchorRef(element);
    },
    [anchorRef],
  );
  const [anchorAtRest, setAnchorAtRest] = useState<AnchorAtRest | null>(null);
  const [keyboardAtRest, setKeyboardAtRest] = useState<KeyboardAtRest>({ shift: 0, lift: 0 });
  const windowDimensions = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const portalHostName = useFloatingPanelPortalHostName();
  const { isMoving, layoutShift } = useKeyboardShift();
  const isCompact = useIsCompactFormFactor();
  const anchor = useKeyboardAnchor();
  const { measureAtRest, reservedLift } = anchor;
  const measurementGeneration = useRef(0);
  // A retained panel stays mounted while hidden; its anchor cannot be measured until it shows.
  const isPanelActive = useRetainedPanelActive();
  const canMeasure =
    isPanelActive && visible && (options.length === 0 || selectedIndex >= 0 || selectionOptional);

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
      setAnchorAtRest({
        x: anchorRect.x - hostRect.x,
        y: anchorRect.y - hostRect.y,
        width: anchorRect.width,
        height: anchorRect.height,
        hostHeight: hostRect.height,
      });
      // Clisbot: remeasured when keyboard motion ends, so these are the settled values.
      const shift = layoutShift.value;
      const lift = reservedLift.value;
      setKeyboardAtRest((current) =>
        current.shift === shift && current.lift === lift ? current : { shift, lift },
      );
      return undefined;
    });
  }, [anchorRef, canMeasure, layoutShift, measureAtRest, portalHostName, reservedLift]);

  useEffect(() => {
    measurementGeneration.current += 1;
    if (!canMeasure) {
      setAnchorAtRest(null);
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

  const measuredPosition = resolveListPosition({
    anchorAtRest,
    keyboardAtRest,
    safeTop: safeAreaInsets.top,
    safeBottom: safeAreaInsets.bottom,
  });
  useEffect(() => {
    if (measuredPosition) onPositionChange?.(measuredPosition);
  }, [onPositionChange, measuredPosition]);
  const position = measuredPosition ?? "above-input";
  // The chat layout's list may take most of a phone screen; upstream keeps its own height.
  const listMaxHeight = COMPOSER_LAYOUT_ENABLED
    ? resolveCommandListMaxHeight({ compact: isCompact, windowHeight: windowDimensions.height })
    : undefined;

  // The layer covers the host and rides the anchor's keyboard translation; the frame inside it
  // places the popover. A layer that spans the host keeps the popover inside its parent's bounds,
  // which Android hit-testing requires.
  return (
    <View ref={setAnchorElement} onLayout={remeasure} style={anchorStyle} collapsable={false}>
      {children}
      {canMeasure && anchorAtRest ? (
        <Portal hostName={portalHostName}>
          <KeyboardTranslateView
            {...anchor.translation}
            style={StyleSheet.absoluteFill}
            pointerEvents="box-none"
          >
            <PopoverFrame
              anchorRef={anchorRef}
              anchorAtRest={anchorAtRest}
              reservedLift={anchor.reservedLift}
              topInset={safeAreaInsets.top}
              position={position}
              layoutShift={layoutShift}
              bottomInset={safeAreaInsets.bottom}
            >
              <Autocomplete
                options={options}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                status={status}
                optionsPosition={position}
                maxHeight={listMaxHeight}
              />
            </PopoverFrame>
          </KeyboardTranslateView>
        </Portal>
      ) : null}
    </View>
  );
}
