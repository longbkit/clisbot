import { useMemo } from "react";
import type { ViewProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { CHAT_CONTAINER_ROW } from "./geometry";

export interface ChatLayoutStyleInput {
  /** The expanded editor: the text fills the surface, the buttons move to a bottom toolbar. */
  fullscreen: boolean;
  multiline: boolean;
  hasAttachments: boolean;
  /** Commands sits at the container's left edge. */
  hasStart: boolean;
  /** Attach, voice or an inner mic sit at the container's right edge. */
  hasEnd: boolean;
  pillStyle: ViewProps["style"];
  inputOpacity: number;
}

/** The chat layout's styles for one render (docs/features/composer-picker/README.md, "Layout"). */
export function useChatLayoutStyles(input: ChatLayoutStyleInput) {
  const { fullscreen, multiline, hasAttachments, hasStart, hasEnd } = input;
  const { pillStyle, inputOpacity } = input;
  return useMemo(
    () => ({
      root: fullscreen ? styles.rootExpanded : styles.root,
      body: [styles.body, fullscreen && styles.grow, { opacity: inputOpacity }],
      barRow: [styles.barRow, fullscreen && styles.barRowExpanded],
      container: fullscreen
        ? [styles.containerExpanded, pillStyle]
        : [
            styles.container,
            multiline || hasAttachments ? styles.containerBox : styles.containerRound,
            hasAttachments && styles.containerWithAttachments,
            pillStyle,
          ],
      containerRow: fullscreen ? styles.grow : styles.containerRow,
      // Text keeps an inset only where no button already spaces it from the edge.
      textSurface: fullscreen
        ? styles.textExpanded
        : [
            styles.textSurface,
            hasStart ? styles.textAfterChip : styles.textInsetStart,
            !hasEnd && styles.textInsetEnd,
          ],
    }),
    [fullscreen, hasAttachments, hasEnd, hasStart, inputOpacity, multiline, pillStyle],
  );
}

export const chatLayoutStyles = StyleSheet.create((theme) => ({
  innerGroup: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  circleColumn: { flexShrink: 0, alignItems: "center", alignSelf: "flex-end" },
  topRow: { flexDirection: "row", paddingBottom: theme.spacing[2] },
  // The expanded editor's toolbar: the container's look around its buttons, Send beside it.
  toolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[1],
    backgroundColor: theme.colors.surfaceComposer,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderComposer,
    borderRadius: theme.borderRadius.full,
    ...theme.shadow.composer,
  },
  // The settings row starts on the container's left edge; its chips' own padding puts the first
  // glyph on the Commands glyph's rail.
  settingsRow: { paddingHorizontal: theme.spacing[2] },
}));

const styles = StyleSheet.create((theme) => ({
  root: { flexShrink: 1, position: "relative" },
  // The expanded editor paints the composer's own surface over the dock's.
  rootExpanded: {
    flex: 1,
    position: "relative",
    backgroundColor: theme.colors.surfaceComposer,
    padding: theme.spacing[4],
  },
  grow: { flex: 1, minHeight: 0 },
  barRowExpanded: { flex: 1, minHeight: 0, alignItems: "stretch" },
  body: { flexShrink: 1, gap: theme.spacing[1] },
  barRow: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
  },
  // The composer is the one input that floats (design.md §5): the same surface, border and
  // shadow as the upstream box, drawn as a pill. The same inset on both sides.
  container: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "column",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    backgroundColor: theme.colors.surfaceComposer,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderComposer,
    ...theme.shadow.composer,
    ...(isWeb
      ? {
          transitionProperty: "border-color",
          transitionDuration: "200ms",
          transitionTimingFunction: "ease-in-out",
        }
      : {}),
  },
  containerRound: { borderRadius: theme.borderRadius.full },
  // A round end on a tall box reads as a capsule; a grown container keeps the composer's corner.
  containerBox: { borderRadius: theme.borderRadius["2xl"] },
  containerWithAttachments: { paddingTop: theme.spacing[2] },
  // Expanded, the text sits on the page: no frame, the page's padding.
  containerExpanded: { flex: 1, minHeight: 0, gap: theme.spacing[2] },
  containerRow: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    minHeight: CHAT_CONTAINER_ROW,
  },
  // One line sits on the row's center; the last of several lines stays there too.
  textSurface: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    minHeight: CHAT_CONTAINER_ROW,
    justifyContent: "center",
    position: "relative",
    paddingVertical: isWeb ? theme.spacing[3] : theme.spacing[2],
  },
  textInsetStart: { paddingLeft: theme.spacing[3] },
  // The chip's target already spaces it; one step more keeps the text off its fill.
  textAfterChip: { paddingLeft: theme.spacing[1] },
  textInsetEnd: { paddingRight: theme.spacing[3] },
  textExpanded: { flex: 1, minHeight: 0 },
}));
