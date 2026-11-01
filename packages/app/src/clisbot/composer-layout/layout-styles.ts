import { useMemo } from "react";
import type { ViewProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { resolveChatComposerGeometry } from "./geometry";

export interface ChatLayoutStyleInput {
  compact: boolean;
  /** The expanded editor: the text area grows to fill the surface. */
  fullscreen: boolean;
  multiline: boolean;
  hasAttachments: boolean;
  /** Commands and attach sit inside the pill (a phone). */
  hasInnerStart: boolean;
  /** Send, Stop or Create sits at the pill's end. */
  hasEnd: boolean;
  /** How far the settings row starts from the composer's edge: the pill's left edge. */
  outerStartWidth: number;
  pillStyle: ViewProps["style"];
  inputOpacity: number;
}

/** The chat layout's styles for one render (docs/features/composer-picker/README.md, "Layout"). */
export function useChatLayoutStyles(input: ChatLayoutStyleInput) {
  const geometry = resolveChatComposerGeometry(input.compact);
  const { multiline, hasAttachments, hasInnerStart, hasEnd, outerStartWidth } = input;
  const { pillStyle, inputOpacity, fullscreen } = input;
  return useMemo(
    () => ({
      root: fullscreen ? styles.rootExpanded : styles.root,
      body: [styles.body, fullscreen && styles.grow, { opacity: inputOpacity }],
      outerRow: [styles.outerRow, fullscreen && styles.outerRowExpanded],
      pill: [
        styles.pill,
        multiline || hasAttachments || fullscreen ? styles.pillBox : styles.pillRound,
        hasAttachments && styles.pillWithAttachments,
        fullscreen && styles.grow,
        pillStyle,
      ],
      pillRow: [styles.pillRow, { minHeight: geometry.pillRowHeight }, fullscreen && styles.grow],
      // Text keeps an inset only where no button already spaces it from the pill's edge.
      textSurface: [
        styles.textSurface,
        { minHeight: geometry.pillRowHeight },
        !hasInnerStart && styles.textInsetStart,
        !hasEnd && styles.textInsetEnd,
        fullscreen && styles.textSurfaceExpanded,
        fullscreen && { paddingBottom: geometry.pillRowHeight },
      ],
      endSlot: [styles.endSlot, { height: geometry.pillRowHeight }],
      // Expanded, the buttons form the pill's bottom bar and the text fills the space above it.
      innerStart: [chatLayoutStyles.innerStart, fullscreen && styles.barStart],
      pillEnd: [chatLayoutStyles.pillEnd, fullscreen && styles.barEnd],
      titleRow: [chatLayoutStyles.titleRow, { marginLeft: outerStartWidth }],
      outer: [styles.outerGroup, { marginBottom: geometry.outerLift }],
      settingsRow: [styles.settingsRow, { marginLeft: outerStartWidth }],
    }),
    [
      fullscreen,
      geometry,
      hasAttachments,
      hasEnd,
      hasInnerStart,
      inputOpacity,
      multiline,
      outerStartWidth,
      pillStyle,
    ],
  );
}

export const chatLayoutStyles = StyleSheet.create((theme) => ({
  pillEnd: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  innerStart: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  collapseSlot: { position: "absolute", top: 0, right: 0 },
  titleRow: { minHeight: theme.spacing[12], justifyContent: "center" },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
}));

/** The settings row starts on the pill's edge on every width; the outer row's gap is part of it. */
export function resolveOuterStartWidth(count: number, outerTarget: number, gap: number): number {
  return count === 0 ? 0 : count * outerTarget + gap;
}

const styles = StyleSheet.create((theme) => ({
  root: { flexShrink: 1, position: "relative" },
  // The expanded editor paints the composer's own surface over the dock's.
  rootExpanded: {
    flex: 1,
    position: "relative",
    backgroundColor: theme.colors.surfaceComposer,
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  grow: { flex: 1, minHeight: 0 },
  body: { flexShrink: 1, gap: theme.spacing[1] },
  outerRow: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[1],
  },
  // The pill fills the height; the buttons beside it stay at its bottom.
  outerRowExpanded: { flex: 1, minHeight: 0, alignItems: "stretch" },
  // The targets carry their own padding around the painted faces.
  outerGroup: { flexShrink: 0, flexDirection: "row", alignItems: "center", alignSelf: "flex-end" },
  // The composer is the one input that floats (design.md §5): the same surface, border and
  // shadow as the upstream box, drawn as a pill. The same inset on both sides: buttons and Send
  // sit spacing[1] in from the border.
  pill: {
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
  pillRound: { borderRadius: theme.borderRadius.full },
  // A round end on a tall box reads as a capsule; a grown pill keeps the composer's corner.
  pillBox: { borderRadius: theme.borderRadius["2xl"] },
  pillWithAttachments: { paddingTop: theme.spacing[2] },
  pillRow: {
    position: "relative",
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  // One line sits on the row's center; the last of several lines stays there too.
  textSurface: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    justifyContent: "center",
    position: "relative",
    paddingVertical: isWeb ? theme.spacing[3] : theme.spacing[2],
  },
  // Text runs the full width, clear of the collapse button in the top right corner.
  textSurfaceExpanded: {
    alignSelf: "stretch",
    justifyContent: "flex-start",
    minHeight: 0,
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[12],
  },
  barStart: { position: "absolute", left: 0, bottom: 0 },
  barEnd: { position: "absolute", right: 0, bottom: 0 },
  textInsetStart: { paddingLeft: theme.spacing[3] },
  textInsetEnd: { paddingRight: theme.spacing[3] },
  endSlot: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  settingsRow: { paddingHorizontal: theme.spacing[2] },
}));
