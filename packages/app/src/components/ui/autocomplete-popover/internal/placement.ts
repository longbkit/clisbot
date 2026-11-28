import type { ReactNode } from "react";
import type { View } from "react-native";
import type { AnimatedRef, DerivedValue, SharedValue } from "react-native-reanimated";
import type { AutocompleteOptionsPosition } from "@/components/ui/autocomplete-utils";
import { SPACING } from "@/styles/theme";

const OFFSET_FROM_ANCHOR = SPACING[3];

/** The anchor's resting rect, relative to the portal host the popover renders in. */
export interface AnchorAtRest {
  x: number;
  y: number;
  width: number;
  height: number;
  hostHeight: number;
}

export interface PopoverFrameProps {
  anchorRef: AnimatedRef<View>;
  /** Taken asynchronously; the frame follows the anchor's live size between measurements. */
  anchorAtRest: AnchorAtRest;
  reservedLift: DerivedValue<number>;
  topInset: number;
  /** Clisbot chat layout: the side of the anchor the list opens on. */
  position: AutocompleteOptionsPosition;
  /** Keyboard space reserved at keyboard boundaries; bounds a list that opens below. */
  layoutShift: SharedValue<number>;
  bottomInset: number;
  children: ReactNode;
}

/** Places the popover above an anchor whose top edge is `anchorTop` within the host. */
export function placeAboveAnchor(input: {
  anchorTop: number;
  hostHeight: number;
  reservedLift: number;
  topInset: number;
}): { bottom: number; maxHeight: number } {
  "worklet";
  return {
    bottom: input.hostHeight - input.anchorTop + OFFSET_FROM_ANCHOR,
    maxHeight: Math.max(
      0,
      input.anchorTop - input.reservedLift - input.topInset - OFFSET_FROM_ANCHOR * 2,
    ),
  };
}

/**
 * Clisbot: places the popover below an anchor whose bottom edge is `anchorBottom` within the
 * host, above the keyboard (docs/features/composer-picker/README.md, "Layout").
 */
export function placeBelowAnchor(input: {
  anchorBottom: number;
  hostHeight: number;
  reservedLift: number;
  layoutShift: number;
  bottomInset: number;
}): { top: number; maxHeight: number } {
  "worklet";
  return {
    top: input.anchorBottom + OFFSET_FROM_ANCHOR,
    maxHeight: Math.max(
      0,
      input.hostHeight -
        (input.anchorBottom - input.reservedLift) -
        input.layoutShift -
        input.bottomInset -
        OFFSET_FROM_ANCHOR * 2,
    ),
  };
}

/** Places the popover on the anchor's `position` side. */
export function placeAgainstAnchor(input: {
  position: AutocompleteOptionsPosition;
  anchorTop: number;
  anchorBottom: number;
  hostHeight: number;
  reservedLift: number;
  layoutShift: number;
  topInset: number;
  bottomInset: number;
}): { top: number; maxHeight: number } | { bottom: number; maxHeight: number } {
  "worklet";
  if (input.position === "below-input") {
    return placeBelowAnchor(input);
  }
  return placeAboveAnchor(input);
}
