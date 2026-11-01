import { useRef, type ReactNode, type Ref } from "react";
import { Text, View, type ViewProps } from "react-native";
import { useTranslation } from "react-i18next";
import { ComposerFullscreenBody } from "@/composer/dock";
import { useComposerFullscreenChrome } from "@/composer/input/presentation";
import { SPACING } from "@/styles/theme";
import { ComposerFrameProvider } from "./frame-anchor";
import { resolveChatComposerGeometry } from "./geometry";
import {
  chatLayoutStyles as styles,
  resolveOuterStartWidth,
  useChatLayoutStyles,
} from "./layout-styles";
import { ComposerSettingsRow } from "./settings-row";

/** The pieces `MessageInput` builds, placed by the chat layout. */
export interface ChatComposerSlots {
  /**
   * Commands, then attach: beside the pill on its left on a wide window, inside it on its left
   * edge on a phone, where four buttons beside the pill left the text no room.
   */
  commands: ReactNode;
  attach: ReactNode;
  /** Beside the pill on the right while nothing is sendable: dictation, then realtime voice. */
  dictation: ReactNode;
  realtimeVoice: ReactNode;
  /** Something is sendable: Send replaces dictation and voice, inside the pill. */
  sendable: boolean;
  /** Send, Stop while the agent runs, or an always-shown submit (Create); the pill's end. */
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

type LayoutStyles = ReturnType<typeof useChatLayoutStyles>;

function countPresent(...nodes: ReactNode[]): number {
  return nodes.filter((node) => node != null).length;
}

function ChatComposerPill({
  props,
  layout,
  expand,
  collapse,
}: {
  props: ChatComposerPresentationProps;
  layout: LayoutStyles;
  /** From the third line, above Send. */
  expand: ReactNode;
  /** The expanded editor's collapse button, at the text area's top right. */
  collapse: ReactNode;
}) {
  const { compact, slots } = props;
  const innerStart = compact && countPresent(slots.commands, slots.attach) > 0;
  const end = slots.primary ?? null;
  return (
    <View
      ref={props.inputWrapperRef}
      style={layout.pill}
      pointerEvents={props.inputPointerEvents}
      testID="composer-pill"
    >
      {props.attachmentSlot}
      <View style={layout.pillRow}>
        {innerStart ? (
          <View style={layout.innerStart} testID="composer-inner-start">
            {slots.commands}
            {slots.attach}
          </View>
        ) : null}
        <View style={layout.textSurface}>{props.surface}</View>
        {end !== null ? (
          <View style={layout.pillEnd}>
            {expand}
            <View style={layout.endSlot} testID="composer-pill-primary">
              {end}
            </View>
          </View>
        ) : null}
        {collapse ? <View style={styles.collapseSlot}>{collapse}</View> : null}
      </View>
    </View>
  );
}

function useLayout(props: ChatComposerPresentationProps): LayoutStyles {
  const { compact, slots } = props;
  const geometry = resolveChatComposerGeometry(compact);
  const outerStartCount = compact ? 0 : countPresent(slots.commands, slots.attach);
  return useChatLayoutStyles({
    compact,
    fullscreen: props.fullscreen,
    multiline: props.multiline,
    hasAttachments: props.hasAttachments,
    hasInnerStart: compact && countPresent(slots.commands, slots.attach) > 0,
    hasEnd: slots.primary != null,
    outerStartWidth: resolveOuterStartWidth(outerStartCount, geometry.outerTarget, SPACING[1]),
    pillStyle: props.pillStyle,
    inputOpacity: props.inputOpacity,
  });
}

function ExpandedTitle({ style }: { style: ViewProps["style"] }) {
  const { t } = useTranslation();
  return (
    <View style={style}>
      <Text style={styles.title} accessibilityRole="header">
        {t("composer.layout.expandedTitle")}
      </Text>
    </View>
  );
}

/**
 * The chat composer, Telegram-style (docs/features/composer-picker/README.md, "Layout"): a pill
 * that grows with its text, Commands and attach on its left (inside it on a phone), dictation
 * and voice beside it on the right until something is sendable, Send inside it, and the
 * settings row under it. Expanded, it is the same tree with the text area grown to fill the
 * surface, so the editor and every control keep their place.
 */
export function ChatComposerPresentation(props: ChatComposerPresentationProps) {
  const { fullscreen, compact, slots } = props;
  const frameRef = useRef<View>(null);
  const { exitScopeRef, exitButton, enterButton } = useComposerFullscreenChrome({
    ...props,
    inFlow: true,
  });
  const layout = useLayout(props);
  const outerStart = !compact && countPresent(slots.commands, slots.attach) > 0;
  const hasSettings = slots.settings != null || slots.settingsEnd != null;
  return (
    <View
      ref={exitScopeRef}
      style={layout.root}
      testID={fullscreen ? "composer-fullscreen" : "composer-chat-layout"}
    >
      {fullscreen ? <ExpandedTitle style={layout.titleRow} /> : null}
      <ComposerFullscreenBody fullscreen={fullscreen}>
        <View ref={frameRef} collapsable={false} style={layout.body}>
          <ComposerFrameProvider frameRef={frameRef}>
            <View style={layout.outerRow}>
              {outerStart ? (
                <View style={layout.outer} testID="composer-outer-start">
                  {slots.commands}
                  {slots.attach}
                </View>
              ) : null}
              <ChatComposerPill
                props={props}
                layout={layout}
                expand={enterButton}
                collapse={exitButton}
              />
              {slots.sendable ? null : (
                <View style={layout.outer} testID="composer-outer-end">
                  {slots.dictation}
                  {slots.realtimeVoice}
                </View>
              )}
            </View>
            {/* The send error stays with the editor it belongs to; inline it shows above. */}
            {fullscreen ? props.error : null}
            {hasSettings ? (
              <ComposerSettingsRow
                start={slots.settings}
                end={slots.settingsEnd}
                initialNarrow={compact}
                style={layout.settingsRow}
              />
            ) : null}
          </ComposerFrameProvider>
        </View>
      </ComposerFullscreenBody>
      {props.overlay}
    </View>
  );
}
