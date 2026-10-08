import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { ComposioIntro, ComposioKeyForm } from "./composio-setup";
import { saveComposioKey } from "./data";
import { toErrorMessage } from "@/utils/error-messages";

/** Composio in short, and the saved key by its hint, with a way to replace or forget it. */
export function ComposioKeyRow({ serverId, keyHint }: { serverId: string; keyHint?: string }) {
  const { t } = useTranslation();
  const [replacing, setReplacing] = useState(false);
  const replace = useCallback(() => setReplacing(true), []);
  const done = useCallback(() => setReplacing(false), []);
  const [error, setError] = useState<string | null>(null);
  const forget = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("connectors.screen.composio.removeTitle"),
      message: t("connectors.screen.composio.removeMessage"),
      confirmLabel: t("connectors.screen.composio.removeConfirm"),
      destructive: true,
    });
    if (!confirmed) return;
    setError(null);
    try {
      await saveComposioKey(serverId, null);
    } catch (cause) {
      setError(toErrorMessage(cause));
    }
  }, [serverId, t]);
  const forgetPress = useCallback(() => void forget(), [forget]);
  return (
    <SettingsSection title="Composio" info={t("connectors.screen.composio.sectionInfo")}>
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
              <Text style={settingsStyles.rowTitle}>
                {t("connectors.screen.composio.keyTitle")}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {keyHint
                  ? `${keyHint} · ${t("connectors.screen.composio.staysOnHost")}`
                  : t("connectors.screen.composio.savedOnHost")}
              </Text>
            </View>
            <View style={styles.actions}>
              <Button size="sm" variant="outline" onPress={replace}>
                {t("connectors.screen.composio.replace")}
              </Button>
              <Button size="sm" variant="outline" onPress={forgetPress}>
                {t("connectors.screen.common.remove")}
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
