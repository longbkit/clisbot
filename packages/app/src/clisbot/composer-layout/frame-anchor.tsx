import { createContext, useContext, type ReactNode, type RefObject } from "react";
import type { View } from "react-native";

/**
 * The whole chat composer's frame, for panels opened from its settings row. The settings row
 * sits under the pill, so a panel anchored to its chip opens over the text being written;
 * anchored to the frame it opens above the composer.
 */
const ComposerFrameContext = createContext<RefObject<View | null> | null>(null);

export function ComposerFrameProvider({
  frameRef,
  children,
}: {
  frameRef: RefObject<View | null>;
  children: ReactNode;
}) {
  return <ComposerFrameContext.Provider value={frameRef}>{children}</ComposerFrameContext.Provider>;
}

/** The composer's frame when the chat layout renders the caller, else the caller's own anchor. */
export function useComposerFrameAnchor(fallback: RefObject<View | null>): RefObject<View | null> {
  return useContext(ComposerFrameContext) ?? fallback;
}
