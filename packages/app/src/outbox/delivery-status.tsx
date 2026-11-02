import { AlertCircle } from "lucide-react-native";
import { memo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { Theme } from "@/styles/theme";
import { deleteOutboxMessage, retryOutboxMessage } from "./actions";
import type { OutboxEntry } from "./model";

/** A fast send never flashes "Sending...": the label waits this long. */
export const SENDING_LABEL_DELAY_MS = 300;

const ThemedSpinner = withUnistyles(LoadingSpinner);
const ThemedAlert = withUnistyles(AlertCircle);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const errorColor = (theme: Theme) => ({ color: theme.colors.palette.red[300] });

function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && shown;
}

function SendingLabel() {
  const { t } = useTranslation();
  return (
    <View style={styles.row} testID="message-delivery-sending">
      <ThemedSpinner size="small" uniProps={mutedColor} />
      <Text style={styles.muted}>{t("messageDelivery.sending")}</Text>
    </View>
  );
}

function FailedActions({ entry }: { entry: OutboxEntry }) {
  const { t } = useTranslation();
  const id = entry.clientMessageId;
  const retry = useCallback(() => retryOutboxMessage(id), [id]);
  const remove = useCallback(() => deleteOutboxMessage(id), [id]);
  const label =
    entry.failure?.reason === "host_unreachable"
      ? t("messageDelivery.waitingForHost")
      : t("messageDelivery.notSent", { reason: entry.failure?.message ?? "" });
  return (
    <View style={styles.row} testID="message-delivery-failed">
      <ThemedAlert size={14} uniProps={errorColor} />
      <Text style={styles.error} numberOfLines={1}>
        {label}
      </Text>
      <Button variant="ghost" size="xs" onPress={retry} testID="message-delivery-retry">
        {t("messageDelivery.retry")}
      </Button>
      <Button variant="ghost" size="xs" onPress={remove} testID="message-delivery-delete">
        {t("messageDelivery.delete")}
      </Button>
    </View>
  );
}

/**
 * Where a sent message shows its timestamp, an unsent one shows its state: "Sending..." after a
 * short delay, or why it is not sent with Retry and Delete.
 */
export const MessageDeliveryStatus = memo(function MessageDeliveryStatus({
  entry,
}: {
  entry: OutboxEntry;
}) {
  const sending = entry.status === "sending";
  const showSending = useDelayedFlag(sending, SENDING_LABEL_DELAY_MS);
  if (!sending) return <FailedActions entry={entry} />;
  return showSending ? <SendingLabel /> : null;
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
}));
