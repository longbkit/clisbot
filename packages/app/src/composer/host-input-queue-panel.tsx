import { useCallback } from "react";
import { View, Text, ScrollView } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  PencilLine,
  Send,
  Trash2,
  Paperclip,
  ArrowUp,
  CircleStop,
  type LucideIcon,
} from "lucide-react-native";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
const ThemedSend = withUnistyles(Send);
const ThemedPaperclip = withUnistyles(Paperclip);
const ThemedSteer = withUnistyles(ArrowUp);
const ThemedInterrupt = withUnistyles(CircleStop);
const STEER_ICON = <ThemedSteer size={16} uniProps={mutedIconColorMapping} />;
const SEND_ICON = <ThemedSend size={16} uniProps={mutedIconColorMapping} />;
const INTERRUPT_ICON = <ThemedInterrupt size={16} uniProps={mutedIconColorMapping} />;
interface QueuePanelItem {
  id: string;
  text: string;
  state: "queued" | "sending" | "needs_review";
  reason?: string;
  attachments?: readonly unknown[];
  images?: readonly unknown[];
}

interface QueuePanelActions {
  edit(id: string): void;
  sendNow(id: string): void;
  steer(id: string): void;
  remove(id: string): void;
  sendNowLabel?: string;
  hideSteer?: boolean;
}
interface QueueEditorActions {
  save(): void;
  move(): void;
  cancel(): void;
  enqueueNew(): void;
}
interface HostInputQueuePanelProps extends QueuePanelActions, QueueEditorActions {
  notice?: string;
  view: { items: readonly QueuePanelItem[] };
  pending: boolean;
  editor: { stale: boolean } | null;
  error: string | null;
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
        <Text style={styles.hint}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function QueueInfoBadge({ label, explanation }: { label: string; explanation: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={styles.badge}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={styles.hint}>{label}</Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={280}>
        <DropdownMenuLabel>{explanation}</DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QueueSendActions({
  disabled,
  hideSteer,
  sendNowLabel,
  sendNow,
  steer,
}: {
  disabled: boolean;
  hideSteer?: boolean;
  sendNowLabel?: string;
  sendNow(): void;
  steer(): void;
}) {
  const { t } = useTranslation();
  const label = sendNowLabel ?? t("composer.hostQueue.sendNow");
  if (hideSteer)
    return <QueueIconAction label={label} Icon={Send} disabled={disabled} onPress={sendNow} />;
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("composer.hostQueue.sendActions")}
        style={styles.iconTarget}
        disabled={disabled}
      >
        <ThemedSend size={16} uniProps={mutedIconColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={disabled} onSelect={steer} leading={STEER_ICON}>
          {t("composer.hostQueue.steerOnce")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled}
          onSelect={sendNow}
          leading={sendNowLabel ? SEND_ICON : INTERRUPT_ICON}
        >
          {label}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QueueRow({
  item,
  edit,
  sendNow,
  steer,
  remove,
  pending,
  sendNowLabel,
  hideSteer,
  notice,
}: QueuePanelActions & { pending: boolean; item: QueuePanelItem; notice?: string }) {
  const { t } = useTranslation();
  const editItem = useCallback(() => edit(item.id), [edit, item.id]);
  const steerItem = useCallback(() => steer(item.id), [steer, item.id]);
  const sendItem = useCallback(() => sendNow(item.id), [sendNow, item.id]);
  const removeItem = useCallback(() => remove(item.id), [remove, item.id]);
  const count = (item.images?.length ?? 0) + (item.attachments?.length ?? 0);
  return (
    <View style={styles.item} testID={`host-queue-${item.id}`}>
      <Text style={styles.text} numberOfLines={1}>
        {item.text || t("composer.hostQueue.attachments", { count })}
      </Text>
      {count > 0 ? (
        <View
          style={styles.fileCount}
          accessibilityLabel={t("composer.hostQueue.attachments", { count })}
        >
          <ThemedPaperclip size={12} uniProps={mutedIconColorMapping} />
          <Text style={styles.hint}>{count}</Text>
        </View>
      ) : null}
      {notice && item.state === "queued" ? (
        <QueueInfoBadge label={t("composer.hostQueue.manual")} explanation={notice} />
      ) : null}
      {item.reason ? (
        <QueueInfoBadge label={t("composer.hostQueue.unknown")} explanation={item.reason} />
      ) : null}
      {item.state === "sending" ? (
        <Text style={styles.hint}>{t("composer.hostQueue.sending")}</Text>
      ) : (
        <View style={styles.rowActions}>
          <QueueIconAction
            label={t("composer.hostQueue.edit")}
            Icon={PencilLine}
            disabled={pending}
            onPress={editItem}
          />
          {item.state === "queued" ? (
            <QueueSendActions
              disabled={pending}
              hideSteer={hideSteer}
              sendNowLabel={sendNowLabel}
              sendNow={sendItem}
              steer={steerItem}
            />
          ) : null}
          <QueueIconAction
            label={t("composer.hostQueue.delete")}
            Icon={Trash2}
            disabled={pending}
            onPress={removeItem}
          />
        </View>
      )}
    </View>
  );
}

function QueueEditor({
  stale,
  pending,
  save,
  move,
  cancel,
  enqueueNew,
}: QueueEditorActions & { stale: boolean; pending: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.editor}>
      <Text style={styles.hint} accessibilityRole={stale ? "alert" : undefined}>
        {t(stale ? "composer.hostQueue.reviewing" : "composer.hostQueue.editing")}
      </Text>
      <View style={styles.actions}>
        <Button
          size="xs"
          variant="outline"
          disabled={stale || pending}
          style={styles.touchAction}
          onPress={save}
        >
          {t("composer.hostQueue.save")}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={stale || pending}
          style={styles.touchAction}
          onPress={move}
        >
          {t("composer.hostQueue.move")}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          style={styles.touchAction}
          onPress={cancel}
        >
          {t("composer.hostQueue.cancel")}
        </Button>
        {stale ? (
          <Button
            size="xs"
            variant="default"
            disabled={pending}
            style={styles.touchAction}
            onPress={enqueueNew}
          >
            {t("composer.hostQueue.enqueueNew")}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

export function HostInputQueuePanel(props: HostInputQueuePanelProps) {
  if (!props.view.items.length && !props.editor && !props.error) return null;
  return (
    <View style={styles.track}>
      {props.error ? (
        <Text accessibilityRole="alert" style={styles.hint}>
          {props.error}
        </Text>
      ) : null}
      {props.view.items.length ? (
        <ScrollView style={styles.viewport} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {props.view.items.map((item, index) => (
            <QueueRow
              key={item.id}
              item={item}
              pending={props.pending}
              edit={props.edit}
              sendNow={props.sendNow}
              sendNowLabel={props.sendNowLabel}
              hideSteer={props.hideSteer}
              notice={index === 0 ? props.notice : undefined}
              steer={props.steer}
              remove={props.remove}
            />
          ))}
        </ScrollView>
      ) : null}
      {props.editor ? (
        <QueueEditor
          stale={props.editor.stale}
          pending={props.pending}
          save={props.save}
          move={props.move}
          cancel={props.cancel}
          enqueueNew={props.enqueueNew}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  touchAction: { minHeight: 44 },
  track: { gap: theme.spacing[2] },
  viewport: { maxHeight: 144 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  text: { flex: 1, minWidth: 0, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  fileCount: { flexDirection: "row", gap: 2, alignItems: "center" },
  iconTarget: {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    padding: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    minHeight: 44,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
  },
  rowActions: { flexDirection: "row", alignItems: "center" },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
  editor: { gap: theme.spacing[2] },
}));
