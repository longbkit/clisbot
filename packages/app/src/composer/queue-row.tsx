import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  PencilLine,
  Send,
  Trash2,
  type LucideIcon,
} from "lucide-react-native";
import type { AttachmentMetadata } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { AttachmentLightbox, type ImageLightboxSource } from "@/components/attachment-lightbox";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";

export interface QueueRowItem {
  id: string;
  text: string;
  state: "queued" | "sending" | "needs_review";
  attachments?: readonly unknown[];
  images?: readonly unknown[];
}

export interface QueueRowActions {
  edit(): void;
  send(): void;
  remove(): void;
  sendLabel: string;
  pending: boolean;
}

/**
 * The images a queued message carries: a Host item's inline images (base64), a client item's
 * composer image attachments. Other attachments are counted, not shown.
 */
export function queueImageSources(item: QueueRowItem): ImageLightboxSource[] {
  const sources: ImageLightboxSource[] = [];
  for (const image of item.images ?? []) {
    const value = image as { data?: unknown; mimeType?: unknown };
    if (typeof value.data === "string" && typeof value.mimeType === "string")
      sources.push({ type: "uri", uri: `data:${value.mimeType};base64,${value.data}` });
  }
  for (const attachment of item.attachments ?? []) {
    const value = attachment as { kind?: unknown; metadata?: unknown };
    if (value.kind === "image" && value.metadata)
      sources.push({ type: "attachment", metadata: value.metadata as AttachmentMetadata });
  }
  return sources;
}

/**
 * One queued message. Send is the one action always in sight; on desktop, hovering the row
 * lays View, Edit and Delete over the end of the text (the text never moves), and a cut-off text
 * shows in full as a tooltip. A phone shows Send and ⋯ (View, Edit, Delete). View expands the row
 * to the full message and its images; an image opens large.
 */
export function QueueRow({
  item,
  actions,
  badges,
  sendingLabel,
}: {
  item: QueueRowItem;
  actions: QueueRowActions;
  /** Manual / Outcome unknown badges and the attachment count, before the actions. */
  badges: ReactNode;
  sendingLabel: string;
}) {
  const compact = useIsCompactFormFactor() || isNative;
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const textRef = useRef<Text>(null);
  const toggle = useCallback(() => setExpanded((open) => !open), []);
  const enter = useCallback(() => {
    setHovered(true);
    // Web only: a one-line text is cut off when it is wider than its box.
    const element = textRef.current as unknown as HTMLElement | null;
    if (isWeb && element) setTruncated(element.scrollWidth > element.clientWidth + 1);
  }, []);
  const leave = useCallback(() => setHovered(false), []);
  const images = useMemo(() => queueImageSources(item), [item]);
  const sending = item.state === "sending";
  return (
    <View
      style={styles.frame}
      onPointerEnter={compact ? undefined : enter}
      onPointerLeave={compact ? undefined : leave}
      testID={`host-queue-${item.id}`}
    >
      <View style={[styles.row, hovered && !compact && styles.rowHovered]}>
        <View style={styles.textColumn}>
          <QueueText
            item={item}
            textRef={textRef}
            expanded={expanded}
            truncated={truncated && !expanded}
            onPress={toggle}
          />
          {!sending && !compact && hovered ? (
            <QueueHoverActions expanded={expanded} onToggle={toggle} actions={actions} />
          ) : null}
        </View>
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
      {expanded && images.length ? <QueueImages images={images} /> : null}
    </View>
  );
}

function QueueText({
  item,
  textRef,
  expanded,
  truncated,
  onPress,
}: {
  item: QueueRowItem;
  textRef: React.RefObject<Text | null>;
  expanded: boolean;
  truncated: boolean;
  onPress(): void;
}) {
  const { t } = useTranslation();
  const count = (item.images?.length ?? 0) + (item.attachments?.length ?? 0);
  const label = item.text || t("composer.hostQueue.attachments", { count });
  const state = useMemo(() => ({ expanded }), [expanded]);
  const text = (
    <PressHighlight
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={state}
      accessibilityLabel={label}
      style={styles.textPress}
      testID="host-queue-text"
    >
      <Text
        ref={textRef}
        style={styles.text}
        testID="host-queue-text-label"
        numberOfLines={expanded ? undefined : 1}
        selectable={expanded}
      >
        {label}
      </Text>
    </PressHighlight>
  );
  return (
    <Tooltip delayDuration={400} enabledOnDesktop={truncated}>
      <TooltipTrigger asChild>{text}</TooltipTrigger>
      <TooltipContent>
        <Text style={styles.tooltip}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/** View, Edit and Delete laid over the end of the text, on the row's own surface. */
function QueueHoverActions({
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
    <View style={styles.overlay} testID="host-queue-hover-actions">
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
        style={styles.iconTarget}
        testID="host-queue-more"
      >
        <ThemedMore size={18} uniProps={mutedIconColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onToggle} testID="host-queue-view">
          {t(expanded ? "composer.hostQueue.collapse" : "composer.hostQueue.view")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={actions.edit}
          disabled={actions.pending}
          testID="host-queue-edit"
        >
          {t("composer.hostQueue.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={actions.remove}
          disabled={actions.pending}
          destructive
          testID="host-queue-delete"
        >
          {t("composer.hostQueue.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const THUMB = 64;

function imageKey(source: ImageLightboxSource): string {
  return source.type === "attachment" ? source.metadata.id : source.uri.slice(-64);
}

function QueueImages({ images }: { images: readonly ImageLightboxSource[] }) {
  const [open, setOpen] = useState<ImageLightboxSource | null>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <>
      <ScrollView horizontal contentContainerStyle={styles.images} testID="host-queue-images">
        {images.map((source) => (
          <QueueImageThumb key={imageKey(source)} source={source} onOpen={setOpen} />
        ))}
      </ScrollView>
      <AttachmentLightbox source={open} onClose={close} />
    </>
  );
}

function QueueImageThumb({
  source,
  onOpen,
}: {
  source: ImageLightboxSource;
  onOpen(source: ImageLightboxSource): void;
}) {
  const { t } = useTranslation();
  const preview = useAttachmentPreviewUrl(source.type === "attachment" ? source.metadata : null);
  const uri = source.type === "uri" ? source.uri : preview;
  const open = useCallback(() => onOpen(source), [onOpen, source]);
  const image = useMemo(() => (uri ? { uri } : null), [uri]);
  return (
    <PressHighlight
      onPress={open}
      accessibilityRole="imagebutton"
      accessibilityLabel={t("composer.hostQueue.openImage")}
      style={styles.thumb}
      testID="host-queue-image"
    >
      {image ? <Image source={image} style={styles.thumbImage} resizeMode="cover" /> : null}
    </PressHighlight>
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

const ThemedMore = withUnistyles(MoreHorizontal);

const styles = StyleSheet.create((theme) => ({
  // The hover target only (docs/hover.md); layout lives on the row inside it.
  frame: {
    position: "relative",
    borderBottomWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[2],
  },
  rowHovered: { backgroundColor: theme.colors.surface1, borderRadius: theme.borderRadius.md },
  // The text and, while hovered, the actions laid over its end: badges and Send stay clickable.
  textColumn: { flex: 1, minWidth: 0, position: "relative", justifyContent: "center" },
  textPress: { paddingVertical: theme.spacing[2] },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  tooltip: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.sm, maxWidth: 480 },
  // Over the end of the text, on the hovered row's fill: the text never reflows.
  overlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.md,
  },
  iconTarget: {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    padding: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  images: { gap: theme.spacing[2], paddingLeft: theme.spacing[2], paddingBottom: theme.spacing[2] },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
    backgroundColor: theme.colors.surface2,
  },
  thumbImage: { width: THUMB, height: THUMB },
}));
