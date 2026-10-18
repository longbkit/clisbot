import { useCallback } from "react";
import { View, Text, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
}
interface QueueEditorActions {
  save(): void;
  move(): void;
  cancel(): void;
  enqueueNew(): void;
}
interface HostInputQueuePanelProps extends QueuePanelActions, QueueEditorActions {
  label?: string;
  view: { items: readonly QueuePanelItem[] };
  pending: boolean;
  editor: { stale: boolean } | null;
  error: string | null;
}

function QueueRow({
  item,
  edit,
  sendNow,
  steer,
  remove,
  pending,
}: QueuePanelActions & { pending: boolean } & { item: QueuePanelItem }) {
  const { t } = useTranslation();
  const editItem = useCallback(() => edit(item.id), [edit, item.id]);
  const steerItem = useCallback(() => steer(item.id), [steer, item.id]);
  const sendItem = useCallback(() => sendNow(item.id), [sendNow, item.id]);
  const removeItem = useCallback(() => remove(item.id), [remove, item.id]);
  const count = (item.images?.length ?? 0) + (item.attachments?.length ?? 0);
  return (
    <View style={styles.item} testID={`host-queue-${item.id}`}>
      <Text style={styles.text} numberOfLines={2}>
        {item.text || t("composer.hostQueue.attachments", { count })}
      </Text>
      {item.text && count > 0 ? (
        <Text style={styles.hint}>{t("composer.hostQueue.attachments", { count })}</Text>
      ) : null}
      {item.reason ? (
        <Text style={styles.hint}>
          {t("composer.hostQueue.unknown")}: {item.reason}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {item.state !== "sending" ? (
          <>
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              style={styles.touchAction}
              onPress={editItem}
            >
              {t("composer.hostQueue.edit")}
            </Button>
            {item.state === "queued" ? (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  style={styles.touchAction}
                  onPress={steerItem}
                >
                  {t("composer.hostQueue.steerOnce")}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  style={styles.touchAction}
                  onPress={sendItem}
                >
                  {t("composer.hostQueue.sendNow")}
                </Button>
              </>
            ) : null}
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              style={styles.touchAction}
              onPress={removeItem}
            >
              {t("composer.hostQueue.delete")}
            </Button>
          </>
        ) : (
          <Text style={styles.hint}>{t("composer.hostQueue.sending")}</Text>
        )}
      </View>
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
      {props.label ? <Text style={styles.hint}>{props.label}</Text> : null}
      {props.error ? (
        <Text accessibilityRole="alert" style={styles.hint}>
          {props.error}
        </Text>
      ) : null}
      {props.view.items.length ? (
        <ScrollView style={styles.viewport} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {props.view.items.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              pending={props.pending}
              edit={props.edit}
              sendNow={props.sendNow}
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
  viewport: { maxHeight: 192 },
  item: {
    padding: theme.spacing[2],
    gap: theme.spacing[1],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
  editor: { gap: theme.spacing[2] },
}));
