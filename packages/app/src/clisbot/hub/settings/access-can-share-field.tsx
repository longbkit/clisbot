import { Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import type { AccessResourceKind } from "./access-catalog";
import type { CanShareState } from "./access-level-choice";
import { canShareDescription } from "./access-level-summary";
import { accessSettingsStyles as styles } from "./access-settings-styles";

/**
 * The Can share switch under the level picker of a Host or Project grant. Locked
 * on for Full access and Administrator, a choice for Office worker and Developer,
 * absent for Connect (docs/features/access/scoped-admins.md).
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
  if (state === "hidden") return null;
  const locked = state === "locked";
  return (
    <View style={styles.switchRow}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Can share</Text>
        <Text style={settingsStyles.rowHint}>
          {canShareDescription(resourceKind)}
          {locked ? ". Always on for this level." : "."}
        </Text>
      </View>
      <Switch
        value={locked || value}
        onValueChange={onChange}
        disabled={disabled || locked}
        accessibilityLabel="Can share"
      />
    </View>
  );
}
