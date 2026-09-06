import React from "react";
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
  if (continuation.url === null) return null;
  return (
    <Alert
      variant={continuation.error === null ? "info" : "warning"}
      title="Continue provider setup"
      description={
        continuation.error ??
        "Complete setup on the provider page, then return to review the Connection status. Use Continue setup if the page did not open."
      }
    >
      <View style={styles.actions}>
        <Button
          size="sm"
          variant="outline"
          loading={continuation.pending}
          onPress={continuation.retry}
        >
          Continue setup
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={continuation.pending}
          onPress={continuation.dismiss}
        >
          Dismiss
        </Button>
      </View>
    </Alert>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
