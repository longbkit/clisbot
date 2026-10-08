import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import { accessSettingsStyles as styles } from "./access-settings-styles";

/**
 * The Schedules switch under the level picker of a Host or Project grant. Every level carries it
 * and the grant may switch it off (docs/audits/2026-10-06-conversation-schedules.md).
 */
export function SchedulesField({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange(value: boolean): void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.switchRow}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("hub.access.schedules.label")}</Text>
        <Text style={settingsStyles.rowHint}>{t("hub.access.schedules.hint")}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={t("hub.access.schedules.label")}
      />
    </View>
  );
}
