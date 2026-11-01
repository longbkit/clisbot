import { StyleSheet } from "react-native-unistyles";
import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";

/**
 * Sizes of the chat composer layout (docs/features/composer-picker/README.md, "Layout"). The
 * pill holds one line of text in a 48px row on every width, so Send, the phone's inner buttons
 * and the text share one vertical center. The buttons beside it keep the composer's action
 * targets (`composer/action-geometry.ts`): 48px on a phone, 28px on a wider window.
 */
export interface ChatComposerGeometry {
  /** Inner height of a one-line pill, also the Send slot's height and width. */
  pillRowHeight: number;
  /** The painted Send circle. */
  sendFace: number;
  /** The buttons beside the pill. */
  outerTarget: number;
  /** Lifts the outer buttons so they center on a one-line pill and stay at its bottom as it grows. */
  outerLift: number;
}

const PILL_BORDER = 1;
const PILL_ROW_HEIGHT = MIN_TOUCH_TARGET_SIZE;
/** A phone's Commands and attach inside the pill: 44px wide, as tall as the pill's row. */
const INNER_TARGET_WIDTH = 44;
/** The composer's painted action face (`composerActionGeometry.face` on a phone). */
const INNER_FACE = 36;

function build(outerTarget: number): ChatComposerGeometry {
  return {
    pillRowHeight: PILL_ROW_HEIGHT,
    sendFace: 40,
    outerTarget,
    outerLift: Math.max(0, (PILL_ROW_HEIGHT + PILL_BORDER * 2 - outerTarget) / 2),
  };
}

const COMPACT = build(MIN_TOUCH_TARGET_SIZE);
const REGULAR = build(28);

export function resolveChatComposerGeometry(compact: boolean): ChatComposerGeometry {
  return compact ? COMPACT : REGULAR;
}

/** One line of text on the web; native keeps its own minimum (`composer/input/input.tsx`). */
export const CHAT_COMPOSER_WEB_MIN_INPUT_HEIGHT = 24;

/** Commands and attach inside a phone's pill: no fill at rest, the hover fill of the composer. */
export const chatComposerInnerAction = StyleSheet.create((theme) => ({
  target: {
    width: INNER_TARGET_WIDTH,
    height: PILL_ROW_HEIGHT,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  face: {
    width: INNER_FACE,
    height: INNER_FACE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  hovered: { backgroundColor: theme.colors.surface2 },
}));

/** Where the chat layout draws Commands and attach: beside the pill, or inside it on a phone. */
export type ChatActionPlacement = "outer" | "inner";

export function resolveChatActionPlacement(
  chatLayout: boolean,
  compact: boolean,
): ChatActionPlacement | null {
  if (!chatLayout) return null;
  return compact ? "inner" : "outer";
}
