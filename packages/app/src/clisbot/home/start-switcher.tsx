import { useTranslation } from "react-i18next";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Bot, ChevronDown, FolderOpen, MessageCircle } from "lucide-react-native";
import {
  SegmentedControl,
  segmentedLabelStyle,
  segmentedSegmentStyle,
  type SegmentedControlOption,
} from "@/components/ui/segmented-control";
import { segmentedIconSize, type SegmentedControlSize } from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";
import type { StartKind } from "./start-kinds";

/**
 * Where to chat, as one switcher: Quick chat is a single tap; Project and Bot are menu triggers
 * drawn as segments (design.md §4) that name the current choice and open the picker on that group.
 */
export function StartSwitcher({
  kind,
  size,
  disabled,
  label,
  mark,
  anchorRef,
  quickChat = true,
  project = true,
  bot = true,
  compactSegments = false,
  onQuickChat,
  onPick,
}: {
  kind: StartKind;
  size: SegmentedControlSize;
  disabled?: boolean;
  /** The chosen Project or Bot, shown on the selected segment. */
  label: string;
  mark?: ReactNode;
  /** The picker's anchor; set to whichever trigger opened it. */
  anchorRef: RefObject<View | null>;
  /** False when this session may not start a Quick chat on the Host; the segment is left out. */
  quickChat?: boolean;
  /** Navigation V2 Home's mode leaves out the starts it does not offer (Chat: Bot only). */
  project?: boolean;
  bot?: boolean;
  /** Unselected segments show only their icon, so every start fits a 320pt phone. */
  compactSegments?: boolean;
  onQuickChat: () => void;
  onPick: (kind: "project" | "bot") => void;
}) {
  const { t } = useTranslation();
  const quickChatOptions = useQuickChatOption(quickChat);
  const projectRef = useRef<View>(null);
  const botRef = useRef<View>(null);
  const pick = useCallback(
    (next: "project" | "bot") => {
      anchorRef.current = (next === "project" ? projectRef : botRef).current;
      onPick(next);
    },
    [anchorRef, onPick],
  );
  // Keyboard shortcuts open the picker without a tap; anchor it on the current mode's segment.
  useEffect(() => {
    anchorRef.current = (kind === "bot" ? botRef : projectRef).current;
  }, [anchorRef, kind]);
  const pickProject = useCallback(() => pick("project"), [pick]);
  const pickBot = useCallback(() => pick("bot"), [pick]);
  return (
    <SegmentedControl
      options={quickChatOptions}
      value={kind}
      onValueChange={onQuickChat}
      size={size}
      variant="track"
      hideLabels={compactSegments && kind !== "quickChat"}
      trailing={
        <>
          {project ? (
            <DestinationSegment
              ref={projectRef}
              size={size}
              selected={kind === "project"}
              disabled={disabled}
              label={kind === "project" ? label : t("home.start.project")}
              iconOnly={compactSegments && kind !== "project"}
              mark={kind === "project" ? mark : undefined}
              Icon={FolderOpen}
              onPress={pickProject}
              accessibilityLabel={t("home.start.projectLabel")}
              testID="new-workspace-project-picker-trigger"
            />
          ) : null}
          {bot ? (
            <DestinationSegment
              ref={botRef}
              size={size}
              selected={kind === "bot"}
              disabled={disabled}
              label={kind === "bot" ? label : t("home.start.bot")}
              iconOnly={compactSegments && kind !== "bot"}
              mark={kind === "bot" ? mark : undefined}
              Icon={Bot}
              onPress={pickBot}
              accessibilityLabel={t("home.start.botLabel")}
              testID="start-switcher-bot"
            />
          ) : null}
        </>
      }
    />
  );
}

const NO_QUICK_CHAT: SegmentedControlOption<StartKind>[] = [];
const quickChatIcon: SegmentedControlOption<StartKind>["icon"] = ({ color, size }) => (
  <MessageCircle size={size} color={color} />
);

function useQuickChatOption(shown: boolean): SegmentedControlOption<StartKind>[] {
  const { t } = useTranslation();
  const label = t("home.start.quickChat");
  return useMemo(
    () => (shown ? [{ value: "quickChat", label, icon: quickChatIcon }] : NO_QUICK_CHAT),
    [label, shown],
  );
}

interface SegmentProps {
  size: SegmentedControlSize;
  selected: boolean;
  disabled?: boolean;
  label: string;
  iconOnly?: boolean;
  mark?: ReactNode;
  Icon: typeof Bot;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
}

const DestinationSegment = forwardRef<View, SegmentProps>(function DestinationSegment(
  { size, selected, disabled, label, iconOnly, mark, Icon, onPress, accessibilityLabel, testID },
  ref,
) {
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) =>
      segmentedSegmentStyle({
        size,
        variant: "track",
        selected,
        hovered: Boolean(hovered),
        pressed,
        disabled,
      }),
    [size, selected, disabled],
  );
  const iconSize = segmentedIconSize[size];
  const value = useMemo(() => ({ text: label }), [label]);
  return (
    <Pressable
      ref={ref}
      collapsable={false}
      onPress={onPress}
      disabled={disabled}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={value}
      aria-selected={selected}
      testID={testID}
    >
      {mark ?? <ThemedGlyph Icon={Icon} size={iconSize} uniProps={selected ? strong : muted} />}
      {iconOnly ? null : (
        <Text
          style={[
            segmentedLabelStyle({ size, selected, variant: "track" }),
            size === "md" ? styles.nameCompact : styles.name,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
      {/* On a phone only the chosen segment shows its chevron; the row must fit 360pt. */}
      {selected || size !== "md" ? (
        <ThemedGlyph Icon={ChevronDown} size={12} uniProps={muted} />
      ) : null}
    </Pressable>
  );
});

function Glyph({ Icon, size, color }: { Icon: typeof Bot; size: number; color?: string }) {
  return <Icon size={size} color={color} />;
}
const ThemedGlyph = withUnistyles(Glyph);
const strong = (theme: Theme) => ({ color: theme.colors.foreground });
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create({
  // A long project or Bot name truncates instead of pushing the row past the composer; on a
  // phone the three segments must fit 360pt with touch-size padding.
  name: { flexShrink: 1, maxWidth: 160 },
  nameCompact: { flexShrink: 1, maxWidth: 88 },
});
