import { useCallback, useState, useMemo } from "react";
import { Text, View } from "react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { BotFormLayout } from "./form-layout";
import { BotTemplateField } from "./bot-template-field";
import { BotDescriptionField } from "./bot-description-field";
import { BotConfiguration } from "./bot-configuration";
import { botFormStyles as styles } from "./bot-form-styles";
import { useBotForm, type BotCreateFormProps } from "./use-bot-form";
export function BotCreateForm(props: BotCreateFormProps) {
  const { bot, hosts, onCancel } = props;
  const { state, model, providerSnapshot, busy, submitAction } = useBotForm(props);
  const [customize, setCustomize] = useState(false);
  const openCustomize = useCallback(() => setCustomize(true), []);
  const done = useCallback(() => setCustomize(false), []);
  const compact = useIsCompactFormFactor();
  const size = compact ? "md" : "sm";
  const submitLabel = bot ? "Save bot" : "Create bot";
  const footer = useMemo(
    () =>
      customize ? (
        <Button size={size} onPress={done}>
          Done
        </Button>
      ) : (
        <View style={compact ? styles.footerMobile : styles.footerDesktop}>
          <Button size={size} disabled={!state.canSubmit || busy} onPress={submitAction}>
            {busy ? "Saving…" : submitLabel}
          </Button>
          <Button size={size} variant="ghost" onPress={onCancel}>
            Cancel
          </Button>
        </View>
      ),
    [customize, done, compact, size, state.canSubmit, busy, submitAction, submitLabel, onCancel],
  );
  return (
    <BotFormLayout inline={Boolean(bot)} footer={footer}>
      {!customize ? (
        <>
          {!bot ? (
            <View>
              <Text style={styles.title}>Give your bot a name</Text>
              <Text style={styles.hint}>Create it now. Give it a task in chat.</Text>
            </View>
          ) : null}
          <Text style={styles.text}>Bot name</Text>
          <FormTextInput
            accessibilityLabel="Bot name"
            autoFocus={!bot && !compact}
            size={size}
            initialValue={state.name}
            onChangeText={model.setName}
            placeholder="For example, Research assistant"
          />
          <BotDescriptionField state={state} model={model} size={size} />
          <BotTemplateField state={state} model={model} editing={Boolean(bot)} />
        </>
      ) : (
        <Text style={styles.title}>Customize bot</Text>
      )}
      <BotConfiguration
        expanded={customize}
        onCustomize={openCustomize}
        state={state}
        model={model}
        providerSnapshot={providerSnapshot}
        size={size}
        hosts={hosts}
      />
      {providerSnapshot.error ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {providerSnapshot.error}
        </Text>
      ) : null}
      {state.submitError ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {state.submitError}
        </Text>
      ) : null}
    </BotFormLayout>
  );
}
