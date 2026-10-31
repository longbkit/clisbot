import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-api-context";
import { i18n } from "@/i18n/i18next";
import type { useHubAccount } from "../account-provider";
import { HubSignInStartError } from "../transport/auth-session";

type HubAccount = ReturnType<typeof useHubAccount>;
type HubRun = (operation: () => Promise<void>) => Promise<void>;

/** One Retry at a time: a newer failure replaces the toast, and with it this. */
let pendingRetry: (() => void) | null = null;

function runPendingRetry(): void {
  const retry = pendingRetry;
  pendingRetry = null;
  retry?.();
}

function RetryToast({ message }: { message: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
      <Button size="xs" variant="ghost" onPress={runPendingRetry} testID="hub-sign-in-retry">
        {i18n.t("hub.account.signIn.retry")}
      </Button>
    </View>
  );
}

/**
 * Continue in browser. When the browser cannot open, the error stays in the section and a toast
 * offers Retry, so the button never looks like it did nothing.
 */
export function useBrowserSignIn(hub: HubAccount, run: HubRun): () => void {
  const toast = useToast();
  return useCallback(
    function startSignIn() {
      void run(async () => {
        try {
          await hub.signIn();
        } catch (error) {
          if (error instanceof HubSignInStartError) {
            const dismiss = toast.show(<RetryToast message={error.message} />, {
              variant: "error",
              durationMs: null,
              testID: "hub-sign-in-start-failed",
            });
            pendingRetry = () => {
              dismiss();
              startSignIn();
            };
          }
          throw error;
        }
      });
    },
    [hub, run, toast],
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  text: { flexShrink: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
}));
