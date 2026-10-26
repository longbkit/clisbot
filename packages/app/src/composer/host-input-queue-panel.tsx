import { useCallback, useMemo } from "react";
import { QueueRow } from "./queue-row";
import { View, Text, ScrollView } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Paperclip } from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
const ThemedPaperclip = withUnistyles(Paperclip);
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

function QueueRowEntry({
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
  const sendItem = useCallback(
    () => (hideSteer ? sendNow(item.id) : steer(item.id)),
    [hideSteer, item.id, sendNow, steer],
  );
  const removeItem = useCallback(() => remove(item.id), [remove, item.id]);
  const sendLabel = hideSteer
    ? (sendNowLabel ?? t("composer.input.sendMessage"))
    : t("composer.hostQueue.steerOnce");
  const actions = useMemo(
    () => ({ edit: editItem, send: sendItem, remove: removeItem, sendLabel, pending }),
    [editItem, pending, removeItem, sendItem, sendLabel],
  );
  const count = (item.images?.length ?? 0) + (item.attachments?.length ?? 0);
  const badges = (
    <>
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
    </>
  );
  return (
    <QueueRow
      item={item}
      actions={actions}
      badges={badges}
      sendingLabel={t("composer.hostQueue.sending")}
    />
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
            <QueueRowEntry
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
  fileCount: { flexDirection: "row", gap: 2, alignItems: "center" },
  badge: {
    minHeight: 44,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
  editor: { gap: theme.spacing[2] },
}));
