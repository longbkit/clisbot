import { useMemo } from "react";
import type { ViewProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { CHAT_CONTAINER_ROW } from "./geometry";

export interface ChatLayoutStyleInput {
  /** The expanded editor: the same layout, the container and its text grown. */
  fullscreen: boolean;
  multiline: boolean;
  hasAttachments: boolean;
  /** Commands sits at the container's left end. */
  hasStart: boolean;
  pillStyle: ViewProps["style"];
  inputOpacity: number;
}

/** The chat layout's styles for one render (docs/features/composer-picker/README.md, "Layout"). */
export function useChatLayoutStyles(input: ChatLayoutStyleInput) {
  const { fullscreen, multiline, hasAttachments, hasStart } = input;
  const { pillStyle, inputOpacity } = input;
  return useMemo(
    () => ({
      root: fullscreen ? styles.rootExpanded : styles.root,
      body: [styles.body, fullscreen && styles.grow, { opacity: inputOpacity }],
      container: [
        styles.container,
        multiline || hasAttachments || fullscreen ? styles.containerBox : styles.containerRound,
        hasAttachments && styles.containerWithAttachments,
        fullscreen && styles.grow,
        pillStyle,
      ],
      containerRow: [styles.containerRow, fullscreen && styles.grow],
      textSurface: fullscreen
        ? [styles.textSurface, styles.textExpanded]
        : [styles.textSurface, hasStart ? styles.textAfterChip : styles.textInsetStart],
      // Expanded, the buttons keep the bottom row's places and the text runs the full width
      // above them.
      startGroup: [chatLayoutStyles.innerGroup, fullscreen && styles.barStart],
      endGroup: [chatLayoutStyles.innerGroup, fullscreen && styles.barEnd],
      circleColumn: [chatLayoutStyles.circleColumn, fullscreen && styles.barCircle],
    }),
    [fullscreen, hasAttachments, hasStart, inputOpacity, multiline, pillStyle],
  );
}

export const chatLayoutStyles = StyleSheet.create((theme) => ({
  innerGroup: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  // The circle and, from the third line, expand above it: pinned to the bottom like ☰.
  circleColumn: { flexShrink: 0, alignItems: "center", alignSelf: "flex-end" },
  topRow: { flexDirection: "row", paddingBottom: theme.spacing[2] },
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
  body: { flexShrink: 1, gap: theme.spacing[1] },
  // The composer is the one input that floats (design.md §5): the same surface, border and
  // shadow as the upstream box, drawn as a pill. The same inset on both ends, so ☰ and the circle
  // sit the same distance from the border.
  container: {
    flexShrink: 1,
    minWidth: 0,
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
  // Expanded, the text runs from the container's top, at the container's own inset, clear of
  // the bottom row.
  textExpanded: {
    alignSelf: "stretch",
    justifyContent: "flex-start",
    minHeight: 0,
    paddingHorizontal: theme.spacing[3],
    paddingBottom: CHAT_CONTAINER_ROW,
  },
  barStart: { position: "absolute", left: 0, bottom: 0 },
  barEnd: { position: "absolute", right: CHAT_CONTAINER_ROW, bottom: 0 },
  barCircle: { position: "absolute", right: 0, bottom: 0 },
}));
