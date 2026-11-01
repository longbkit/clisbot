import {
  CHAT_COMPOSER_WEB_MIN_INPUT_HEIGHT,
  chatComposerActions,
  type ChatActionPlacement,
} from "./geometry";

/**
 * What the chat layout changes inside `MessageInput` (`composer/input/input.tsx`), resolved in
 * one place so the upstream component only asks.
 */
export interface ChatInputFacts {
  /** The text input's one-line minimum, when the layout sets it. */
  minInputHeight: number | null;
  /** Dictation: the circle unless Send, Stop or Create holds it. */
  micPlacement: ChatActionPlacement;
  /** Send's face: the circle beside the container. */
  sendFaceStyle: typeof chatComposerActions.circleFace | undefined;
  /** The web focus hint has no room inside a phone's container. */
  hideFocusHint: boolean;
  /** Expand shows from the third line on every width, not only on a phone. */
  expandOnEveryWidth: boolean;
}

export function resolveChatInputFacts(input: {
  chatLayout: boolean;
  web: boolean;
  compact: boolean;
  fullscreen: boolean;
  primaryAction: "send" | "active" | "none";
}): ChatInputFacts {
  const { chatLayout } = input;
  const circleFree = input.primaryAction === "none" && !input.fullscreen;
  return {
    minInputHeight: chatLayout && input.web ? CHAT_COMPOSER_WEB_MIN_INPUT_HEIGHT : null,
    micPlacement: circleFree ? "circle" : "inner",
    sendFaceStyle: chatLayout ? chatComposerActions.circleFace : undefined,
    hideFocusHint: chatLayout && input.compact,
    expandOnEveryWidth: chatLayout,
  };
}
