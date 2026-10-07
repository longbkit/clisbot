import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { COMPOSIO_SECTION_INFO, ComposioIntro, ComposioKeyForm } from "./composio-setup";
import { saveComposioKey } from "./data";
import { toErrorMessage } from "@/utils/error-messages";

/** Composio in short, and the saved key by its hint, with a way to replace or forget it. */
export function ComposioKeyRow({ serverId, keyHint }: { serverId: string; keyHint?: string }) {
  const [replacing, setReplacing] = useState(false);
  const replace = useCallback(() => setReplacing(true), []);
  const done = useCallback(() => setReplacing(false), []);
  const [error, setError] = useState<string | null>(null);
  const forget = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: "Remove the Composio key?",
      message:
        "Bots lose every Composio app until a key is saved again. Your app accounts stay in Composio.",
      confirmLabel: "Remove key",
      destructive: true,
    });
    if (!confirmed) return;
    setError(null);
    try {
      await saveComposioKey(serverId, null);
    } catch (cause) {
      setError(toErrorMessage(cause));
    }
  }, [serverId]);
  const forgetPress = useCallback(() => void forget(), [forget]);
  return (
    <SettingsSection title="Composio" info={COMPOSIO_SECTION_INFO}>
      <View style={settingsStyles.card}>
        <ComposioIntro />
        {replacing ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <ComposioKeyForm serverId={serverId} onSaved={done} onCancel={done} />
            </View>
          </View>
        ) : (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Project API key</Text>
              <Text style={settingsStyles.rowHint}>
                {keyHint ? `${keyHint} · stays on this Host` : "Saved on this Host"}
              </Text>
            </View>
            <View style={styles.actions}>
              <Button size="sm" variant="outline" onPress={replace}>
                Replace
              </Button>
              <Button size="sm" variant="outline" onPress={forgetPress}>
                Remove
              </Button>
            </View>
          </View>
        )}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={[settingsStyles.rowError, styles.error]}>
          {error}
        </Text>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", gap: theme.spacing[2] },
  error: { marginTop: theme.spacing[2] },
}));
