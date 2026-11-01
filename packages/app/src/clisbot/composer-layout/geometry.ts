import { StyleSheet } from "react-native-unistyles";
import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";

/**
 * Sizes of the chat composer layout (docs/features/composer-picker/README.md, "Layout"), the
 * same on every width. The container's row is the circle plus its inset: a 40px circle in a 48px
 * target, so the buttons inside it and one line of text share one vertical center.
 */
export const CHAT_CONTAINER_ROW = MIN_TOUCH_TARGET_SIZE;
/** Mic, Send or Stop at the container's right end. */
const CIRCLE_FACE = 40;
/** Buttons inside the container: 44px wide, as tall as its row. */
const INNER_TARGET_WIDTH = 44;
/** The composer's painted action face (`composerActionGeometry.face` on a phone). */
const INNER_FACE = 36;

/** One line of text on the web; native keeps its own minimum (`composer/input/input.tsx`). */
export const CHAT_COMPOSER_WEB_MIN_INPUT_HEIGHT = 24;

/** Where the chat layout draws an action: inside the container, or as the circle beside it. */
export type ChatActionPlacement = "inner" | "circle";

export const chatComposerActions = StyleSheet.create((theme) => ({
  innerTarget: {
    width: INNER_TARGET_WIDTH,
    height: CHAT_CONTAINER_ROW,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  innerFace: {
    width: INNER_FACE,
    height: INNER_FACE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  innerHovered: { backgroundColor: theme.colors.surface2 },
  // A resting fill inside the composer is surface2; surface3 is hover, pressed and open
  // (design.md §4). Accent stays Send's (§3).
  chipFace: { backgroundColor: theme.colors.surface2 },
  chipActive: { backgroundColor: theme.colors.surface3 },
  circleTarget: {
    width: CHAT_CONTAINER_ROW,
    height: CHAT_CONTAINER_ROW,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  circleFace: {
    width: CIRCLE_FACE,
    height: CIRCLE_FACE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  circleNeutral: { backgroundColor: theme.colors.surface2 },
  circleHovered: { backgroundColor: theme.colors.surface3 },
}));

const actions = chatComposerActions;

/** Dictation's target: the circle, or a button inside the container. */
export function chatMicTarget(placement: ChatActionPlacement) {
  return placement === "circle" ? actions.circleTarget : actions.innerTarget;
}

/** Dictation's face: a filled circle at rest beside the container, no fill inside it. */
export function chatMicFace(placement: ChatActionPlacement, hovered: boolean) {
  if (placement === "circle") {
    return [actions.circleFace, hovered ? actions.circleHovered : actions.circleNeutral];
  }
  return [actions.innerFace, hovered && actions.innerHovered];
}

/** Attach and realtime voice inside the container. */
export function chatInnerFace(hovered: boolean) {
  return [actions.innerFace, hovered && actions.innerHovered];
}
