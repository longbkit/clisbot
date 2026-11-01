import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";

/**
 * Sizes of the chat composer layout. The pill holds one line of text and the Send button; the
 * buttons beside it keep the composer's action targets (`composer/action-geometry.ts`): 48px on
 * a phone, 28px on a wider window.
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

function build(pillRowHeight: number, sendFace: number, outerTarget: number): ChatComposerGeometry {
  return {
    pillRowHeight,
    sendFace,
    outerTarget,
    outerLift: Math.max(0, (pillRowHeight + PILL_BORDER * 2 - outerTarget) / 2),
  };
}

// On a phone Send inside the pill is a full thumb target (design.md §4), so the pill is a
// border taller than the buttons beside it.
const COMPACT = build(MIN_TOUCH_TARGET_SIZE, 40, MIN_TOUCH_TARGET_SIZE);
const REGULAR = build(44, 36, 28);

export function resolveChatComposerGeometry(compact: boolean): ChatComposerGeometry {
  return compact ? COMPACT : REGULAR;
}

/** One line of text on the web; native keeps its own minimum (`composer/input/input.tsx`). */
export const CHAT_COMPOSER_WEB_MIN_INPUT_HEIGHT = 24;
