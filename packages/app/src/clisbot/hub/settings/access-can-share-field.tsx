import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import type { AccessResourceKind } from "./access-catalog";
import type { CanShareState } from "./access-level-choice";
import { canShareDescription } from "./access-level-summary";
import { accessSettingsStyles as styles } from "./access-settings-styles";

/**
 * The Can share switch under the level picker of a Host or Project grant. Locked
 * on for Administrator, a choice for every other level (on by default for Full
 * access), absent for Connect (docs/features/access/scoped-admins.md).
 */
export function CanShareField({
  state,
  resourceKind,
  value,
  onChange,
  disabled,
}: {
  state: CanShareState;
  resourceKind: AccessResourceKind;
  value: boolean;
  onChange(value: boolean): void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  if (state === "hidden") return null;
  const locked = state === "locked";
  const description = canShareDescription(resourceKind);
  return (
    <View style={styles.switchRow}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("hub.access.canShare.label")}</Text>
        <Text style={settingsStyles.rowHint}>
          {locked
            ? t("hub.access.canShare.hintLocked", { description })
            : t("hub.access.canShare.hint", { description })}
        </Text>
      </View>
      <Switch
        value={locked || value}
        onValueChange={onChange}
        disabled={disabled || locked}
        accessibilityLabel={t("hub.access.canShare.label")}
      />
    </View>
  );
}
