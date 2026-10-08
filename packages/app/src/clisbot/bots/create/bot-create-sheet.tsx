import { useMemo } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { BotFormLayout } from "./form-layout";
import { BotTemplateField } from "./bot-template-field";
import { BotProjectField } from "./bot-project-field";
import { BotDescriptionField } from "./bot-description-field";
import { BotConfiguration } from "./bot-configuration";
import { botFormStyles as styles } from "./bot-form-styles";
import { useBotForm, type BotCreateFormProps } from "./use-bot-form";

/**
 * New bot and Bot settings: who the bot is (Name, Role, Template), then how it runs (Model,
 * Permissions, Thinking), as labeled fields of equal rank under the sheet title.
 */
export function BotCreateForm(props: BotCreateFormProps) {
  const { bot, hosts, onCancel } = props;
  const { state, model, providerSnapshot, busy, submitAction } = useBotForm(props);
  const compact = useIsCompactFormFactor();
  const { t } = useTranslation();
  const size = compact ? "md" : "sm";
  const submitLabel = bot
    ? t("bots.workspace.botForm.save")
    : t("bots.workspace.shared.form.create");
  const footer = useMemo(
    () => (
      <View style={compact ? styles.footerMobile : styles.footerDesktop}>
        <Button
          size={size}
          variant="default"
          disabled={!state.canSubmit || busy}
          onPress={submitAction}
        >
          {busy ? t("bots.workspace.botForm.saving") : submitLabel}
        </Button>
        <Button size={size} variant="secondary" onPress={onCancel}>
          {t("common.actions.cancel")}
        </Button>
      </View>
    ),
    [compact, size, state.canSubmit, busy, submitAction, submitLabel, onCancel, t],
  );
  return (
    <BotFormLayout inline={Boolean(bot)} footer={footer}>
      <Field label={t("bots.workspace.shared.form.name")}>
        <FormTextInput
          accessibilityLabel={t("bots.workspace.botForm.nameLabel")}
          autoFocus={!bot && !compact}
          size={size}
          initialValue={state.name}
          onChangeText={model.setName}
          onSubmitEditing={submitAction}
          returnKeyType="done"
          placeholder={t("bots.workspace.botForm.namePlaceholder")}
        />
      </Field>
      <BotProjectField state={state} />
      <BotDescriptionField state={state} model={model} size={size} />
      <BotTemplateField state={state} model={model} editing={Boolean(bot)} />
      <BotConfiguration
        state={state}
        model={model}
        providerSnapshot={providerSnapshot}
        size={size}
        hosts={hosts}
      />
      {providerSnapshot.error ? <Alert variant="error" title={providerSnapshot.error} /> : null}
      {state.submitError ? <Alert variant="error" title={state.submitError} /> : null}
    </BotFormLayout>
  );
}
