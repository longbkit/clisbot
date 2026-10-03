import { useMemo } from "react";
import { View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { BotFormLayout } from "./form-layout";
import { BotTemplateField } from "./bot-template-field";
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
  const size = compact ? "md" : "sm";
  const submitLabel = bot ? "Save bot" : "Create bot";
  const footer = useMemo(
    () => (
      <View style={compact ? styles.footerMobile : styles.footerDesktop}>
        <Button
          size={size}
          variant="default"
          disabled={!state.canSubmit || busy}
          onPress={submitAction}
        >
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button size={size} variant="secondary" onPress={onCancel}>
          Cancel
        </Button>
      </View>
    ),
    [compact, size, state.canSubmit, busy, submitAction, submitLabel, onCancel],
  );
  return (
    <BotFormLayout inline={Boolean(bot)} footer={footer}>
      <Field label="Name">
        <FormTextInput
          accessibilityLabel="Bot name"
          autoFocus={!bot && !compact}
          size={size}
          initialValue={state.name}
          onChangeText={model.setName}
          onSubmitEditing={submitAction}
          returnKeyType="done"
          placeholder="For example, Research assistant"
        />
      </Field>
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
