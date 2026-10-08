import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";

/**
 * Names a second account of the same app before its sign-in starts ("work", "personal"),
 * so a Project's grant can tell them apart and the first one is never replaced.
 */
export function ConnectAccountSheet({
  visible,
  appName,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  appName: string;
  onClose(): void;
  onSubmit(alias: string): void;
}) {
  const { t } = useTranslation();
  const [alias, setAlias] = useState("");
  const submit = useCallback(() => {
    if (alias.trim()) onSubmit(alias.trim());
  }, [alias, onSubmit]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="ghost" onPress={onClose}>
          {t("connectors.screen.common.cancel")}
        </Button>
        <Button
          variant="default"
          disabled={!alias.trim()}
          onPress={submit}
          testID="connectors-alias-submit"
        >
          {t("connectors.screen.connectAccount.continue")}
        </Button>
      </View>
    ),
    [alias, onClose, submit, t],
  );
  const header = useMemo(
    () => ({ title: t("connectors.screen.connectAccount.title", { app: appName }) }),
    [appName, t],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={480}
    >
      <Field
        label={t("connectors.screen.connectAccount.nameLabel")}
        hint={t("connectors.screen.connectAccount.nameHint")}
      >
        <FormTextInput
          key={String(visible)}
          accessibilityLabel={t("connectors.screen.connectAccount.nameLabel")}
          placeholder={t("connectors.screen.connectAccount.namePlaceholder")}
          autoCapitalize="none"
          autoFocus
          onChangeText={setAlias}
          onSubmitEditing={submit}
          testID="connectors-alias"
        />
      </Field>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
}));
