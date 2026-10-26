import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  MoreVertical,
  PencilLine,
  Send,
  Trash2,
  type LucideIcon,
} from "lucide-react-native";
import type { InputQueueView } from "@clisbot/protocol/input-queue";
import type { ComposerAttachment } from "@/attachments/types";
import type { ImageLightboxSource } from "@/components/attachment-lightbox";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  type DropdownMenuTriggerProps,
} from "@/components/ui/dropdown-menu";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { ICON_SIZE } from "@/styles/theme";
import { QueueImages, type QueueImage } from "./queue-row-images";

type HostQueueItem = InputQueueView["items"][number];

export interface QueueRowItem {
  id: string;
  text: string;
  state: "queued" | "sending" | "needs_review";
  /** A Host item's agent attachments, or a client item's composer attachments. */
  attachments?: readonly (NonNullable<HostQueueItem["attachments"]>[number] | ComposerAttachment)[];
  /** A Host item's inline images. */
  images?: HostQueueItem["images"];
}

export interface QueueRowActions {
  edit(): void;
  send(): void;
  remove(): void;
  sendLabel: string;
  pending: boolean;
}

/** How many images and attachments a queued message carries. */
export function queueAttachmentCount(item: QueueRowItem): number {
  return (item.images?.length ?? 0) + (item.attachments?.length ?? 0);
}

/**
 * The images a queued message carries: a Host item's inline images (base64), a client item's
 * composer image attachments. Other attachments are counted, not shown.
 */
export function queueImages(item: QueueRowItem): QueueImage[] {
  const sources: ImageLightboxSource[] = [];
  for (const image of item.images ?? [])
    sources.push({ type: "uri", uri: `data:${image.mimeType};base64,${image.data}` });
  for (const attachment of item.attachments ?? []) {
    if ("kind" in attachment && attachment.kind === "image")
      sources.push({ type: "attachment", metadata: attachment.metadata });
  }
  // The same image may be attached twice, so its position is part of its key.
  return sources.map((source, index) => ({
    key: `${index}:${source.type === "attachment" ? source.metadata.id : source.uri.slice(-32)}`,
    source,
  }));
}

/** One action slot; the hover actions are three of them. */
const ACTION = 44;

/**
 * One queued message. Send is the one action always in sight; on desktop, hovering the row or
 * moving keyboard focus into it shows View, Edit and Delete over the end of the first line (the
 * text never moves), and a cut-off text shows in full as a tooltip. A phone shows Send and ⋯
 * (View, Edit, Delete). View expands the row to the full message and its images; an image opens
 * large.
 */
export function QueueRow({
  item,
  actions,
  attachmentCount,
  badges,
  sendingLabel,
}: {
  item: QueueRowItem;
  actions: QueueRowActions;
  attachmentCount: number;
  /** Manual / Outcome unknown badges and the attachment count, before the actions. */
  badges: ReactNode;
  sendingLabel: string;
}) {
  const compact = useIsCompactFormFactor() || isNative;
  const { revealed, handlers } = useRevealOnHoverOrFocus(compact);
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((open) => !open), []);
  const images = useMemo(() => queueImages(item), [item]);
  const sending = item.state === "sending";
  const hoverActions = !sending && !compact;
  return (
    <View style={styles.frame} {...handlers} testID={`host-queue-${item.id}`}>
      <View style={[styles.row, revealed && styles.rowRevealed]}>
        <View style={styles.textColumn}>
          <QueueText
            item={item}
            attachmentCount={attachmentCount}
            expanded={expanded}
            reserveActions={hoverActions}
            onExpand={toggle}
          />
          {hoverActions ? (
            <QueueHoverActions
              visible={revealed}
              expanded={expanded}
              onToggle={toggle}
              actions={actions}
            />
          ) : null}
        </View>
        <View style={styles.trailing}>
          {badges}
          {sending ? <Text style={styles.hint}>{sendingLabel}</Text> : null}
          {!sending && item.state === "queued" ? (
            <QueueIconAction
              label={actions.sendLabel}
              Icon={Send}
              disabled={actions.pending}
              onPress={actions.send}
            />
          ) : null}
          {!sending && compact ? (
            <QueueMoreMenu expanded={expanded} onToggle={toggle} actions={actions} />
          ) : null}
        </View>
      </View>
      {expanded && images.length ? <QueueImages images={images} /> : null}
    </View>
  );
}

/**
 * Desktop only: the row's actions show while the pointer is on it (docs/hover.md) or keyboard
 * focus is inside it. A mouse click focuses the button it lands on too; only a keyboard focus
 * counts, or the actions would stay up after the pointer leaves.
 */
function useRevealOnHoverOrFocus(compact: boolean) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const handlers = useMemo(
    () =>
      compact
        ? {}
        : {
            onPointerEnter: () => setHovered(true),
            onPointerLeave: () => setHovered(false),
            onFocus: (event: { target: unknown }) => setFocused(isKeyboardFocus(event.target)),
            onBlur: () => setFocused(false),
          },
    [compact],
  );
  return { revealed: !compact && (hovered || focused), handlers };
}

function isKeyboardFocus(target: unknown): boolean {
  if (!isWeb || !(target instanceof HTMLElement)) return false;
  return target.matches(":focus-visible");
}

/** Web only: whether a one-line text is cut off, measured on layout so the first hover knows. */
function useTruncated(label: string) {
  const ref = useRef<Text>(null);
  const [truncated, setTruncated] = useState(false);
  const measure = useCallback(() => {
    if (!isWeb) return;
    const element: unknown = ref.current;
    if (element instanceof HTMLElement) setTruncated(element.scrollWidth > element.clientWidth + 1);
  }, []);
  useLayoutEffect(measure, [measure, label]);
  return { ref, truncated, measure };
}

/**
 * The message. Collapsed, a tap expands it; expanded, it is selectable text and collapses only
 * through View/Collapse, so selecting text never collapses the row. The tap target is a pointer
 * shortcut: assistive tech reads the message as text and reaches View through the actions.
 */
function QueueText({
  item,
  attachmentCount,
  expanded,
  reserveActions,
  onExpand,
}: {
  item: QueueRowItem;
  attachmentCount: number;
  expanded: boolean;
  /** Keeps the expanded text clear of the hover actions over its first line. */
  reserveActions: boolean;
  onExpand(): void;
}) {
  const { t } = useTranslation();
  const label = item.text || t("composer.hostQueue.attachments", { count: attachmentCount });
  const { ref, truncated, measure } = useTruncated(label);
  if (expanded)
    return (
      <View style={[styles.textBox, reserveActions && styles.textClearOfActions]}>
        <Text style={styles.text} testID="queue-row-text-label" selectable>
          {label}
        </Text>
      </View>
    );
  return (
    <Tooltip delayDuration={400} enabledOnDesktop={truncated}>
      <TooltipTrigger asChild>
        <PressHighlight
          onPress={onExpand}
          tabIndex={-1}
          accessibilityHint={t("composer.hostQueue.view")}
          style={styles.textBox}
          testID="queue-row-text"
        >
          <Text
            ref={ref}
            onLayout={measure}
            style={styles.text}
            testID="queue-row-text-label"
            numberOfLines={1}
          >
            {label}
          </Text>
        </PressHighlight>
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.tooltip}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * View, Edit and Delete over the end of the first line, on the row's own surface. Always
 * mounted so keyboard and screen-reader users reach them; invisible and pointer-transparent
 * until the row is hovered or focused.
 */
function QueueHoverActions({
  visible,
  expanded,
  onToggle,
  actions,
}: {
  visible: boolean;
  expanded: boolean;
  onToggle(): void;
  actions: QueueRowActions;
}) {
  const { t } = useTranslation();
  return (
    <View
      style={[styles.overlay, !visible && styles.overlayHidden]}
      testID="queue-row-hover-actions"
    >
      <QueueIconAction
        label={t(expanded ? "composer.hostQueue.collapse" : "composer.hostQueue.view")}
        Icon={expanded ? ChevronUp : ChevronDown}
        disabled={false}
        onPress={onToggle}
      />
      <QueueIconAction
        label={t("composer.hostQueue.edit")}
        Icon={PencilLine}
        disabled={actions.pending}
        onPress={actions.edit}
      />
      <QueueIconAction
        label={t("composer.hostQueue.delete")}
        Icon={Trash2}
        disabled={actions.pending}
        onPress={actions.remove}
      />
    </View>
  );
}

const moreTriggerStyle: DropdownMenuTriggerProps["style"] = ({ hovered, pressed, open }) => [
  styles.iconTarget,
  styles.more,
  (hovered || pressed || open) && styles.moreActive,
];

/** The phone's row kebab (docs/design.md: rows): View, Edit and Delete. */
function QueueMoreMenu({
  expanded,
  onToggle,
  actions,
}: {
  expanded: boolean;
  onToggle(): void;
  actions: QueueRowActions;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("composer.hostQueue.more")}
        style={moreTriggerStyle}
        testID="queue-row-more"
      >
        <ThemedMoreVertical size={ICON_SIZE.sm} uniProps={mutedIconColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={onToggle}
          leading={expanded ? collapseIcon : viewIcon}
          testID="queue-row-view"
        >
          {t(expanded ? "composer.hostQueue.collapse" : "composer.hostQueue.view")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={actions.edit}
          disabled={actions.pending}
          leading={editIcon}
          testID="queue-row-edit"
        >
          {t("composer.hostQueue.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={actions.remove}
          disabled={actions.pending}
          destructive
          leading={deleteIcon}
          testID="queue-row-delete"
        >
          {t("composer.hostQueue.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QueueIconAction({
  label,
  Icon,
  disabled,
  onPress,
}: {
  label: string;
  Icon: LucideIcon;
  disabled: boolean;
  onPress(): void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="md"
          variant="ghost"
          accessibilityLabel={label}
          disabled={disabled}
          onPress={onPress}
          style={styles.iconTarget}
          leftIcon={Icon}
        />
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.tooltip}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronUp = withUnistyles(ChevronUp);
const ThemedPencilLine = withUnistyles(PencilLine);
const ThemedTrash2 = withUnistyles(Trash2);
// Menu items lead with a small muted icon (docs/design.md: kebab menus).
const viewIcon = <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedIconColorMapping} />;
const collapseIcon = <ThemedChevronUp size={ICON_SIZE.sm} uniProps={mutedIconColorMapping} />;
const editIcon = <ThemedPencilLine size={ICON_SIZE.sm} uniProps={mutedIconColorMapping} />;
const deleteIcon = <ThemedTrash2 size={ICON_SIZE.sm} uniProps={mutedIconColorMapping} />;

const styles = StyleSheet.create((theme) => {
  // Message text, as in a sent message (components/message.tsx); one line fills one action slot.
  const lineHeight = Math.round(theme.fontSize.content * 1.4);
  const overlayWidth = ACTION * 3 + theme.spacing[2];
  return {
    // The hover and focus target only (docs/hover.md); layout lives on the row inside it.
    frame: {
      position: "relative",
      borderBottomWidth: theme.borderWidth[1],
      borderColor: theme.colors.border,
    },
    // Top-aligned: an expanded message grows down, its actions stay beside the first line.
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingVertical: theme.spacing[0.5],
      gap: theme.spacing[1],
      paddingLeft: theme.spacing[2],
    },
    rowRevealed: { backgroundColor: theme.colors.surface1, borderRadius: theme.borderRadius.md },
    // The text and the actions over its first line: badges and Send stay clickable.
    textColumn: { flex: 1, minWidth: 0, position: "relative" },
    textBox: {
      minHeight: ACTION,
      justifyContent: "center",
      paddingVertical: Math.max(0, (ACTION - lineHeight) / 2),
    },
    textClearOfActions: { paddingRight: overlayWidth },
    text: { color: theme.colors.foreground, fontSize: theme.fontSize.content, lineHeight },
    trailing: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: ACTION,
      gap: theme.spacing[1],
    },
    hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
    tooltip: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.sm, maxWidth: 480 },
    // Over the end of the first line, on the revealed row's fill: the text never reflows.
    overlay: {
      position: "absolute",
      top: 0,
      right: 0,
      width: overlayWidth,
      height: ACTION,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      backgroundColor: theme.colors.surface1,
      borderRadius: theme.borderRadius.md,
    },
    overlayHidden: { opacity: 0, pointerEvents: "none" },
    iconTarget: {
      width: ACTION,
      height: ACTION,
      minWidth: ACTION,
      minHeight: ACTION,
      padding: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    more: { borderRadius: theme.borderRadius.base },
    moreActive: { backgroundColor: theme.colors.surface2 },
  };
});
