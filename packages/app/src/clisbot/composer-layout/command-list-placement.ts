import type { AutocompleteOptionsPosition } from "@/components/ui/autocomplete-utils";

/**
 * Where the slash command list opens: on the composer's side with more room. A chat's composer
 * sits at the bottom, so the list opens above it; Home's sits near the top, where above it there
 * was room for two rows under the header, so the list opens below it, over the page and above
 * the keyboard (docs/features/composer-picker/README.md, "Layout").
 */
export function resolveCommandListPlacement(input: {
  /** The anchor's top and bottom in the portal host, keyboard closed. */
  anchorTop: number;
  anchorBottom: number;
  hostHeight: number;
  /** How far the anchor rides up with the open keyboard. */
  lift: number;
  /** The settled keyboard height above the bottom safe area; 0 while it is closed. */
  keyboard: number;
  safeTop: number;
  safeBottom: number;
}): AutocompleteOptionsPosition {
  const above = input.anchorTop - input.lift - input.safeTop;
  const below =
    input.hostHeight - input.keyboard - input.safeBottom - (input.anchorBottom - input.lift);
  return below > above ? "below-input" : "above-input";
}

/** On a phone the list may take this share of the screen and scroll inside it. */
const PHONE_LIST_HEIGHT_RATIO = 0.6;
/** Desktop keeps the autocomplete's own height. */
const DESKTOP_LIST_HEIGHT = 220;

export function resolveCommandListMaxHeight(input: {
  compact: boolean;
  windowHeight: number;
}): number {
  return input.compact
    ? Math.round(input.windowHeight * PHONE_LIST_HEIGHT_RATIO)
    : DESKTOP_LIST_HEIGHT;
}
