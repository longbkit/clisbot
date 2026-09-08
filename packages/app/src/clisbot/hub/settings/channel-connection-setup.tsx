import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { SelectField } from "@/components/ui/select-field";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import {
  openChannelConnectionForm,
  type ChannelConnectionFieldState,
  type ChannelConnectionFormModel,
  type ChannelConnectionProblem,
  type ServiceAccountSource,
} from "../channel-connection-form";
import type { ChannelCatalogEntry } from "../channel-catalog";

const SOURCE_OPTIONS: SegmentedControlOption<ServiceAccountSource>[] = [
  { value: "paste", label: "Paste JSON" },
  { value: "file", label: "File on host" },
];

/**
 * The catalog-driven Add-connection form. `save` posts the body and answers with
 * the Hub's problem, or null when the Connection was created; the caller closes
 * the form on null.
 */
export function ChannelConnectionSetup({
  entry,
  save,
  onCancel,
}: {
  entry: ChannelCatalogEntry;
  save(body: Record<string, unknown>): Promise<ChannelConnectionProblem | null>;
  onCancel?: (() => void) | undefined;
}) {
  const [model] = useState(() => openChannelConnectionForm(entry));
  useEffect(() => () => model.close(), [model]);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const submit = useSubmit(model, save);
  return (
    <SettingsSection title={`Connect ${entry.label}`}>
      <View style={[settingsStyles.card, styles.form]}>
        <Text style={settingsStyles.rowHint}>{entry.transports[0]?.setup ?? ""}</Text>
        {state.transports.length > 1 && state.transportId !== null ? (
          <Field label="Transport">
            <SegmentedControl
              options={state.transports.map(({ id, label }) => ({ value: id, label }))}
              value={state.transportId}
              onValueChange={model.setTransport}
              size="sm"
            />
          </Field>
        ) : null}
        {state.accountId === null ? null : (
          <Field
            label="Account name"
            hint="How this Connection is named in Paseo."
            error={state.accountIdError}
          >
            <FormTextInput
              initialValue=""
              onChangeText={model.setAccountId}
              placeholder="support"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!state.submitting}
            />
          </Field>
        )}
        {state.serviceAccountSource === null ? null : (
          <Field label="Credential source">
            <SegmentedControl
              options={SOURCE_OPTIONS}
              value={state.serviceAccountSource}
              onValueChange={model.setServiceAccountSource}
              size="sm"
            />
          </Field>
        )}
        {state.fields.map((field) => (
          <ConnectionField
            key={field.key}
            field={field}
            disabled={state.submitting}
            onChange={model.setField}
          />
        ))}
        {state.problem === null ? null : (
          <Alert
            variant={state.problem.retryable ? "warning" : "error"}
            title={state.problem.title}
            description={
              state.problem.hint === null
                ? state.problem.detail
                : `${state.problem.detail} ${state.problem.hint}`
            }
          />
        )}
        <View style={styles.actions}>
          <Button disabled={!state.canSubmit} loading={state.submitting} onPress={submit}>
            Verify and add Connection
          </Button>
          {onCancel === undefined ? null : (
            <Button variant="ghost" disabled={state.submitting} onPress={onCancel}>
              Cancel
            </Button>
          )}
        </View>
      </View>
    </SettingsSection>
  );
}

function useSubmit(
  model: ChannelConnectionFormModel,
  save: (body: Record<string, unknown>) => Promise<ChannelConnectionProblem | null>,
): () => void {
  return useCallback(() => {
    const body = model.requestBody();
    if (body === null) return;
    model.setSubmitting(true);
    void (async () => {
      try {
        const problem = await save(body);
        if (problem === null) model.setSubmitting(false);
        else model.setProblem(problem);
      } catch (error) {
        model.setProblem({
          title: "The Hub could not be reached",
          detail: error instanceof Error ? error.message : "The request failed.",
          hint: null,
          retryable: true,
        });
      }
    })();
  }, [model, save]);
}

function ConnectionField({
  field,
  disabled,
  onChange,
}: {
  field: ChannelConnectionFieldState;
  disabled: boolean;
  onChange(key: string, value: string): void;
}) {
  const change = useCallback((value: string) => onChange(field.key, value), [field.key, onChange]);
  const choices = field.choices;
  const display = useMemo(() => {
    const selected = choices?.find((choice) => choice.value === field.value);
    return selected === undefined ? null : { label: selected.label };
  }, [choices, field.value]);
  const options = useMemo(
    () =>
      (choices ?? []).map((choice) => ({
        id: choice.value,
        value: choice.value,
        label: choice.label,
      })),
    [choices],
  );
  if (field.kind === "choice" && choices !== null) {
    return (
      <SelectField
        label={field.label}
        value={field.value}
        selectedDisplay={display}
        options={options}
        onChange={change}
        placeholder="Choose"
        emptyText="No options"
        disabled={disabled}
        {...(field.help === null ? {} : { hint: field.help })}
      />
    );
  }
  return (
    <Field
      label={field.required ? field.label : `${field.label} (optional)`}
      error={field.error}
      {...(field.help === null ? {} : { hint: field.help })}
    >
      <FormTextInput
        initialValue=""
        onChangeText={change}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        secureTextEntry={field.kind === "secret"}
        multiline={field.kind === "multiline"}
        {...(field.placeholder === null ? {} : { placeholder: field.placeholder })}
      />
    </Field>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    gap: theme.spacing[4],
    padding: theme.spacing[4],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
