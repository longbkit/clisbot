import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/ui/form-field";
import { shortenPath } from "@/utils/shorten-path";
import type { BotFormState } from "./bot-form-model";

/** The Project a bot is made from, fixed: the bot works there and shares it. */
export function BotProjectField({ state }: { state: BotFormState }) {
  const { t } = useTranslation();
  if (!state.project) return null;
  return (
    <Field
      label={t("bots.workspace.botForm.project")}
      hint={t("bots.workspace.botForm.projectHint")}
    >
      <View style={styles.box} testID="bot-form-project">
        <Text style={styles.name} numberOfLines={1}>
          {state.project.name}
        </Text>
        <Text style={styles.path} numberOfLines={1} ellipsizeMode="middle">
          {shortenPath(state.project.path)}
        </Text>
      </View>
    </Field>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  name: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  path: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
