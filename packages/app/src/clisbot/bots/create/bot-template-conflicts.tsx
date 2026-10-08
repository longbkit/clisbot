import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import type { BotFormModel, BotFormState } from "./bot-form-model";
import { templateConflicts, type BotTemplateConflictPolicy } from "./bot-template-choice";

/**
 * Files the template would write that the Project already has: keep the Project's, take the
 * template's, or pick per file. A replaced file is moved to a backup folder in the Project, so
 * nothing is lost and it can be deleted later.
 */
export function BotTemplateConflicts({
  state,
  model,
}: {
  state: BotFormState;
  model: BotFormModel;
}) {
  const { t } = useTranslation();
  const conflicts = templateConflicts(state.template);
  const { policy, replace } = state.template;
  const options = useMemo<SegmentedControlOption<BotTemplateConflictPolicy>[]>(
    () => [
      { value: "keep", label: t("bots.workspace.botForm.conflictKeep") },
      { value: "replace", label: t("bots.workspace.botForm.conflictReplace") },
      { value: "choose", label: t("bots.workspace.botForm.conflictChoose") },
    ],
    [t],
  );
  if (state.template.choice === "none" || conflicts.length === 0) return null;
  const replacing = policy === "replace" || (policy === "choose" && replace.length > 0);
  return (
    <View style={styles.root} testID="bot-template-conflicts">
      <Text style={styles.title}>
        {t("bots.workspace.botForm.conflictsTitle", { count: conflicts.length })}
      </Text>
      <SegmentedControl
        options={options}
        value={policy}
        onValueChange={model.setConflictPolicy}
        size="sm"
        variant="track"
        style={styles.policy}
      />
      {policy === "choose" ? (
        <View style={settingsStyles.card}>
          {conflicts.map((name, index) => (
            <ConflictRow
              key={name}
              name={name}
              bordered={index > 0}
              replaced={replace.includes(name)}
              onToggle={model.toggleReplace}
            />
          ))}
        </View>
      ) : null}
      <Text style={styles.hint}>
        {replacing
          ? t("bots.workspace.botForm.conflictBackupHint")
          : t("bots.workspace.botForm.conflictKeepHint")}
      </Text>
    </View>
  );
}

function ConflictRow({
  name,
  bordered,
  replaced,
  onToggle,
}: {
  name: string;
  bordered: boolean;
  replaced: boolean;
  onToggle: (name: string) => void;
}) {
  const { t } = useTranslation();
  const toggle = useCallback(() => onToggle(name), [name, onToggle]);
  return (
    <View style={[settingsStyles.row, bordered && settingsStyles.rowBorder, styles.row]}>
      <Text style={styles.file} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.side}>
        {replaced
          ? t("bots.workspace.botForm.conflictUseTemplate")
          : t("bots.workspace.botForm.conflictUseMine")}
      </Text>
      <Switch
        value={replaced}
        onValueChange={toggle}
        accessibilityLabel={t("bots.workspace.botForm.conflictSwitchLabel", { name })}
        testID={`bot-template-conflict-${name}`}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.spacing[2] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  policy: { alignSelf: "flex-start" },
  row: { paddingVertical: theme.spacing[2], gap: theme.spacing[3] },
  file: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  side: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
