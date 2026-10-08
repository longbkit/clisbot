import React from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { useHubConnectionContinuation } from "../use-connection-continuation";

export function HubConnectionContinuationNotice({
  continuation,
}: {
  continuation: ReturnType<typeof useHubConnectionContinuation>;
}) {
  const { t } = useTranslation();
  if (continuation.url === null) return null;
  return (
    <Alert
      variant={continuation.error === null ? "info" : "warning"}
      title={t("hub.settings.connectionContinuation.title")}
      description={continuation.error ?? t("hub.settings.connectionContinuation.description")}
    >
      <View style={styles.actions}>
        <Button
          size="sm"
          variant="outline"
          loading={continuation.pending}
          onPress={continuation.retry}
        >
          {t("hub.settings.connectionContinuation.continueSetup")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={continuation.pending}
          onPress={continuation.dismiss}
        >
          {t("hub.settings.connectionContinuation.dismiss")}
        </Button>
      </View>
    </Alert>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
