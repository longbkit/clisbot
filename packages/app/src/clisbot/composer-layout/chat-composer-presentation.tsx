import { useMemo, useRef, type ReactNode, type Ref } from "react";
import { View, type ViewProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ComposerFullscreenBody, ComposerFullscreenFooter } from "@/composer/dock";
import {
  composerFullscreenStyles as fullscreenStyles,
  useComposerFullscreenChrome,
} from "@/composer/input/presentation";
import { isWeb } from "@/constants/platform";
import { ComposerFrameProvider } from "./frame-anchor";
import { resolveChatComposerGeometry } from "./geometry";
import { ComposerSettingsRow } from "./settings-row";

/** The pieces `MessageInput` builds, placed by the chat layout. */
export interface ChatComposerSlots {
  /** Beside the pill on the left: the commands button, then attach. */
  commands: ReactNode;
  attach: ReactNode;
  /**
   * Beside the pill on the right while nothing is sendable: dictation, then realtime voice. A
   * phone has no room for four buttons beside the pill, so voice waits inside it, where Send
   * appears.
   */
  dictation: ReactNode;
  realtimeVoice: ReactNode;
  /** Something is sendable: Send replaces dictation and voice, inside the pill. */
  sendable: boolean;
  /** Send, or Stop while the agent runs; inside the pill, at its end. */
  primary: ReactNode;
  /** Under the pill: Model, Mode and Tools at the start, the context ring at the end. */
  settings: ReactNode;
  settingsEnd: ReactNode;
}

export interface ChatComposerPresentationProps {
  fullscreen: boolean;
  compact: boolean;
  /** More than one line: the pill becomes a rounded box. */
  multiline: boolean;
  /** Attachment chips above the text: a rounded box too. */
  hasAttachments: boolean;
  sendIconSize: number;
  surface: ReactNode;
  /** Send in the fullscreen footer. */
  send: ReactNode;
  error: ReactNode;
  onExit: () => void;
  inputWrapperRef: Ref<View>;
  /** The caller's pill style (compact shadow, read-only border, caller background). */
  pillStyle: ViewProps["style"];
  inputOpacity: number;
  inputPointerEvents: ViewProps["pointerEvents"];
  attachmentSlot: ReactNode;
  showFullscreenButton: boolean;
  onEnter: () => void;
  overlay: ReactNode;
  slots: ChatComposerSlots;
}

/** Send or Stop; on a phone with nothing to send, realtime voice. */
function resolvePillEnd({ fullscreen, compact, slots }: ChatComposerPresentationProps): ReactNode {
  if (fullscreen) return null;
  if (slots.primary != null) return slots.primary;
  return compact && !slots.sendable ? (slots.realtimeVoice ?? null) : null;
}

function useLayoutStyles(props: ChatComposerPresentationProps) {
  const geometry = resolveChatComposerGeometry(props.compact);
  const { multiline, hasAttachments, compact, pillStyle, inputOpacity } = props;
  const hasPrimary = resolvePillEnd(props) !== null;
  return useMemo(
    () => ({
      body: [styles.body, { opacity: inputOpacity }],
      pill: [
        styles.pill,
        compact ? styles.pillCompact : styles.pillRegular,
        multiline || hasAttachments ? styles.pillBox : styles.pillRound,
        hasAttachments && styles.pillWithAttachments,
        hasPrimary && styles.pillWithPrimary,
        pillStyle,
      ],
      pillRow: [styles.pillRow, { minHeight: geometry.pillRowHeight }],
      textSurface: [styles.textSurface, { minHeight: geometry.pillRowHeight }],
      primarySlot: [styles.primarySlot, { height: geometry.pillRowHeight }],
      outer: [styles.outerGroup, { marginBottom: geometry.outerLift }],
    }),
    [compact, geometry, hasAttachments, hasPrimary, inputOpacity, multiline, pillStyle],
  );
}

function ChatComposerPill({
  props,
  layout,
  enterButton,
}: {
  props: ChatComposerPresentationProps;
  layout: ReturnType<typeof useLayoutStyles>;
  enterButton: ReactNode;
}) {
  const { fullscreen } = props;
  const primary = resolvePillEnd(props);
  return (
    <View
      ref={props.inputWrapperRef}
      style={fullscreen ? fullscreenStyles.fullscreenInputWrapper : layout.pill}
      pointerEvents={props.inputPointerEvents}
      testID="composer-pill"
    >
      {fullscreen ? null : props.attachmentSlot}
      <View style={fullscreen ? styles.fill : layout.pillRow}>
        <View style={fullscreen ? fullscreenStyles.fullscreenTextSurface : layout.textSurface}>
          {props.surface}
        </View>
        {primary !== null ? (
          // A grown pill puts the fullscreen button above Send, so the text keeps its width.
          <View style={styles.pillEnd}>
            {enterButton}
            <View style={layout.primarySlot} testID="composer-pill-primary">
              {primary}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The chat composer, Telegram-style (docs/features/composer-picker/README.md, "Layout"): a pill
 * that grows with its text, commands and attach on its left, dictation and voice on its right
 * until something is sendable, Send inside it, and the settings row under it. The editor keeps
 * its place in the tree in both modes, as in `ComposerInputPresentation`, so fullscreen only
 * restyles the wrappers around it.
 */
export function ChatComposerPresentation(props: ChatComposerPresentationProps) {
  const { fullscreen, slots } = props;
  const frameRef = useRef<View>(null);
  const { exitScopeRef, exitButton, enterButton } = useComposerFullscreenChrome({
    ...props,
    enterInFlow: true,
  });
  const layout = useLayoutStyles(props);
  const inline = !fullscreen;
  const hasSettings = inline && (slots.settings != null || slots.settingsEnd != null);
  return (
    <View
      ref={exitScopeRef}
      style={fullscreen ? fullscreenStyles.fullscreen : styles.root}
      testID={fullscreen ? "composer-fullscreen" : "composer-chat-layout"}
    >
      {exitButton}
      <ComposerFullscreenBody fullscreen={fullscreen}>
        <View ref={frameRef} collapsable={false} style={fullscreen ? styles.fill : layout.body}>
          <ComposerFrameProvider frameRef={frameRef}>
            <View style={fullscreen ? styles.fill : styles.outerRow}>
              {inline ? (
                <View style={layout.outer} testID="composer-outer-start">
                  {slots.commands}
                  {slots.attach}
                </View>
              ) : null}
              <ChatComposerPill props={props} layout={layout} enterButton={enterButton} />
              {inline && !slots.sendable ? (
                <View style={layout.outer} testID="composer-outer-end">
                  {slots.dictation}
                  {props.compact ? null : slots.realtimeVoice}
                </View>
              ) : null}
            </View>
            {hasSettings ? (
              <ComposerSettingsRow
                start={slots.settings}
                end={slots.settingsEnd}
                initialNarrow={props.compact}
              />
            ) : null}
          </ComposerFrameProvider>
        </View>
      </ComposerFullscreenBody>
      {fullscreen ? (
        <ComposerFullscreenFooter style={fullscreenStyles.footer}>
          {props.error}
          <View style={fullscreenStyles.sendRow}>{props.send}</View>
        </ComposerFullscreenFooter>
      ) : null}
      {props.overlay}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flexShrink: 1, position: "relative" },
  fill: { flex: 1, minHeight: 0 },
  body: { flexShrink: 1, gap: theme.spacing[1] },
  outerRow: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[1],
  },
  // The targets carry their own padding around the painted faces; a gap would only cost the pill
  // width on a phone, where four of them sit beside it.
  outerGroup: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  // The composer is the one input that floats (design.md §5): the same surface, border and
  // shadow as the upstream box, drawn as a pill.
  pill: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "column",
    gap: theme.spacing[2],
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
  pillCompact: { paddingLeft: theme.spacing[3], paddingRight: theme.spacing[3] },
  pillRegular: { paddingLeft: theme.spacing[4], paddingRight: theme.spacing[4] },
  // Send sits at the pill's end, a few pixels in from the border.
  pillWithPrimary: { paddingRight: theme.spacing[1] },
  pillRound: { borderRadius: theme.borderRadius.full },
  // A round end on a tall box reads as a capsule; a grown pill keeps the composer's corner.
  pillBox: { borderRadius: theme.borderRadius["2xl"] },
  pillWithAttachments: { paddingTop: theme.spacing[2] },
  pillRow: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[1],
  },
  textSurface: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    justifyContent: "center",
    position: "relative",
    paddingVertical: theme.spacing[2],
  },
  pillEnd: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  primarySlot: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
}));
