import { Children, useRef, type ReactNode, type Ref } from "react";
import { View, type ViewProps } from "react-native";
import { ComposerFullscreenBody } from "@/composer/dock";
import { useComposerFullscreenChrome } from "@/composer/input/presentation";
import { ComposerFrameProvider } from "./frame-anchor";
import { chatLayoutStyles as styles, useChatLayoutStyles } from "./layout-styles";
import { ComposerSettingsRow } from "./settings-row";

/** The pieces `MessageInput` builds, placed by the chat layout. */
export interface ChatComposerSlots {
  /** The Commands chip at the container's left end. */
  commands: ReactNode;
  /** Attach and realtime voice before the circle, until text is typed. */
  attach: ReactNode;
  realtimeVoice: ReactNode;
  /** Dictation: the circle at the container's right end, or beside it when the circle is taken. */
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
  /** Under the container in both states: Model, Mode and Tools, the context ring at the end. */
  settings: ReactNode;
  settingsEnd: ReactNode;
}

export interface ChatComposerPresentationProps {
  /** The expanded editor: the same layout with the text grown to fill the surface. */
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
  /** Attach, voice and a displaced dictation; empty once text is typed. */
  end: ReactNode[];
}

/** Where dictation goes: the circle unless Send, Stop or Create holds it. */
export function resolvePlacement(slots: ChatComposerSlots): Placement {
  const circle = slots.primary ?? slots.dictation;
  if (slots.typing) return { circle, end: [] };
  const displacedMic = slots.primary != null ? slots.dictation : null;
  const end = [slots.attach, slots.realtimeVoice, displacedMic].filter((node) => node != null);
  return { circle, end };
}

function Group({
  nodes,
  style,
  testID,
}: {
  nodes: ReactNode[];
  style: ViewProps["style"];
  testID: string;
}) {
  return (
    <View style={style} testID={testID}>
      {Children.toArray(nodes)}
    </View>
  );
}

function ChatComposerContainer({
  props,
  layout,
  placement,
  expand,
}: {
  props: ChatComposerPresentationProps;
  layout: ReturnType<typeof useChatLayoutStyles>;
  placement: Placement;
  /** From the third line, above the circle. */
  expand: ReactNode;
}) {
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
        {commands != null ? (
          <Group nodes={[commands]} style={layout.startGroup} testID="composer-inner-start" />
        ) : null}
        <View style={layout.textSurface}>{props.surface}</View>
        {placement.end.length > 0 ? (
          <Group nodes={placement.end} style={layout.endGroup} testID="composer-inner-end" />
        ) : null}
        <View style={layout.circleColumn} testID="composer-circle">
          {expand}
          {placement.circle}
        </View>
      </View>
    </View>
  );
}

/**
 * The chat composer, after Telegram's input (docs/features/composer-picker/README.md, "Layout"):
 * one container holding the Commands chip, the text, attach and voice, and at its right end one
 * circle, dictation until text is typed and Send after; the settings row under it. Expanded, the
 * same layout fills the surface and only the text grows. The editor keeps its place in the tree
 * in both states, as in `ComposerInputPresentation`, so its text, caret and focus survive.
 */
export function ChatComposerPresentation(props: ChatComposerPresentationProps) {
  const { fullscreen, slots } = props;
  const frameRef = useRef<View>(null);
  const { exitScopeRef, exitButton, enterButton } = useComposerFullscreenChrome({
    ...props,
    inFlow: true,
  });
  const placement = resolvePlacement(slots);
  const layout = useChatLayoutStyles({
    fullscreen,
    multiline: props.multiline,
    hasAttachments: props.hasAttachments,
    hasStart: slots.commands != null,
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
            {fullscreen ? props.error : null}
            <ChatComposerContainer
              props={props}
              layout={layout}
              placement={placement}
              expand={enterButton}
            />
            {hasSettings ? (
              <ComposerSettingsRow
                start={slots.settings}
                end={slots.settingsEnd}
                initialNarrow={props.compact}
                style={styles.settingsRow}
              />
            ) : null}
          </ComposerFrameProvider>
        </View>
      </ComposerFullscreenBody>
      {props.overlay}
    </View>
  );
}
