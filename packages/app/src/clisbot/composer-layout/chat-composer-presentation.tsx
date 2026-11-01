import { Children, useRef, type ReactNode, type Ref } from "react";
import { View, type ViewProps } from "react-native";
import { ComposerFullscreenBody } from "@/composer/dock";
import { useComposerFullscreenChrome } from "@/composer/input/presentation";
import { ComposerFrameProvider } from "./frame-anchor";
import { chatLayoutStyles as styles, useChatLayoutStyles } from "./layout-styles";
import { ComposerSettingsRow } from "./settings-row";

/** The pieces `MessageInput` builds, placed by the chat layout. */
export interface ChatComposerSlots {
  /** The Commands chip at the container's left edge. */
  commands: ReactNode;
  /** Attach and realtime voice at the container's right edge, until something is sendable. */
  attach: ReactNode;
  realtimeVoice: ReactNode;
  /** Dictation: the circle beside the container, or inside it when the circle is taken. */
  dictation: ReactNode;
  /** Something is sendable: the circle becomes Send. */
  sendable: boolean;
  /**
   * Text is typed: attach, voice and dictation hide, as Telegram's. Attachments alone keep them,
   * so another file or a spoken message can join them.
   */
  typing: boolean;
  /** Send, Stop while the agent runs, or an always-shown submit (Create): the circle. */
  primary: ReactNode;
  /** Under the container: Model, Mode and Tools at the start, the context ring at the end. */
  settings: ReactNode;
  settingsEnd: ReactNode;
}

export interface ChatComposerPresentationProps {
  /** The expanded editor: the text fills the surface, the buttons move to a bottom toolbar. */
  fullscreen: boolean;
  compact: boolean;
  /** More than one line: the container becomes a rounded box. */
  multiline: boolean;
  /** Attachment chips above the text: a rounded box too. */
  hasAttachments: boolean;
  sendIconSize: number;
  surface: ReactNode;
  error: ReactNode;
  onExit: () => void;
  inputWrapperRef: Ref<View>;
  /** The caller's container style (compact shadow, read-only border, caller background). */
  pillStyle: ViewProps["style"];
  inputOpacity: number;
  inputPointerEvents: ViewProps["pointerEvents"];
  attachmentSlot: ReactNode;
  showFullscreenButton: boolean;
  onEnter: () => void;
  overlay: ReactNode;
  slots: ChatComposerSlots;
}

interface Placement {
  circle: ReactNode;
  /** Attach, voice and an inner dictation; empty once something is sendable. */
  end: ReactNode[];
}

/** Where dictation goes: the circle unless Send, Stop or Create holds it. */
export function resolvePlacement(slots: ChatComposerSlots): Placement {
  const circle = slots.primary ?? slots.dictation;
  if (slots.typing) return { circle, end: [] };
  const innerMic = slots.primary != null ? slots.dictation : null;
  const end = [slots.attach, slots.realtimeVoice, innerMic].filter((node) => node != null);
  return { circle, end };
}

function Group({ nodes, testID }: { nodes: ReactNode[]; testID: string }) {
  return (
    <View style={styles.innerGroup} testID={testID}>
      {Children.toArray(nodes)}
    </View>
  );
}

/** Expanded, Send always holds the circle and the toolbar keeps ☰, 📎, voice and the mic. */
function ExpandedToolbar({ slots, placement }: { slots: ChatComposerSlots; placement: Placement }) {
  const buttons = [slots.commands, slots.attach, slots.realtimeVoice, slots.dictation];
  return (
    <View style={styles.toolbarRow} testID="composer-expanded-toolbar">
      <View style={styles.toolbar}>
        <Group nodes={buttons.filter((node) => node != null)} testID="composer-toolbar-buttons" />
      </View>
      <View style={styles.circleColumn} testID="composer-circle">
        {placement.circle}
      </View>
    </View>
  );
}

function ChatComposerContainer({
  props,
  layout,
  placement,
}: {
  props: ChatComposerPresentationProps;
  layout: ReturnType<typeof useChatLayoutStyles>;
  placement: Placement;
}) {
  const inline = !props.fullscreen;
  const { commands } = props.slots;
  return (
    <View
      ref={props.inputWrapperRef}
      style={layout.container}
      pointerEvents={props.inputPointerEvents}
      testID="composer-pill"
    >
      {props.attachmentSlot}
      <View style={layout.containerRow}>
        {inline && commands != null ? (
          <Group nodes={[commands]} testID="composer-inner-start" />
        ) : null}
        <View style={layout.textSurface}>{props.surface}</View>
        {inline && placement.end.length > 0 ? (
          <Group nodes={placement.end} testID="composer-inner-end" />
        ) : null}
      </View>
    </View>
  );
}

/**
 * The chat composer, after Telegram's input (docs/features/composer-picker/README.md, "Layout"):
 * one container with the Commands chip at its left edge, the text, then attach and voice at its
 * right edge; beside it one circle, dictation until something is sendable and Send after; the
 * settings row under it. Expanded, the text fills the surface and the buttons form a toolbar
 * at the bottom. The editor keeps its place in the tree in both modes, as in
 * `ComposerInputPresentation`, so its text, caret and focus survive the switch.
 */
export function ChatComposerPresentation(props: ChatComposerPresentationProps) {
  const { fullscreen, slots } = props;
  const frameRef = useRef<View>(null);
  const { exitScopeRef, exitButton, enterButton } = useComposerFullscreenChrome({
    ...props,
    inFlow: true,
  });
  const placement = resolvePlacement(slots);
  const inline = !fullscreen;
  const layout = useChatLayoutStyles({
    fullscreen,
    multiline: props.multiline,
    hasAttachments: props.hasAttachments,
    hasStart: slots.commands != null,
    hasEnd: placement.end.length > 0,
    pillStyle: props.pillStyle,
    inputOpacity: props.inputOpacity,
  });
  const hasSettings = slots.settings != null || slots.settingsEnd != null;
  return (
    <View
      ref={exitScopeRef}
      style={layout.root}
      testID={fullscreen ? "composer-fullscreen" : "composer-chat-layout"}
    >
      {fullscreen ? <View style={styles.topRow}>{exitButton}</View> : null}
      <ComposerFullscreenBody fullscreen={fullscreen}>
        <View ref={frameRef} collapsable={false} style={layout.body}>
          <ComposerFrameProvider frameRef={frameRef}>
            <View style={layout.barRow}>
              <ChatComposerContainer props={props} layout={layout} placement={placement} />
              {inline ? (
                // From the third line the expand button sits above the circle.
                <View style={styles.circleColumn} testID="composer-circle">
                  {enterButton}
                  {placement.circle}
                </View>
              ) : null}
            </View>
            {fullscreen ? props.error : null}
            {hasSettings ? (
              <ComposerSettingsRow
                start={slots.settings}
                end={slots.settingsEnd}
                initialNarrow={props.compact}
                style={styles.settingsRow}
              />
            ) : null}
            {fullscreen ? <ExpandedToolbar slots={slots} placement={placement} /> : null}
          </ComposerFrameProvider>
        </View>
      </ComposerFullscreenBody>
      {props.overlay}
    </View>
  );
}
