import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { i18n } from "@/i18n/i18next";
import { settingsStyles } from "@/styles/settings";
import {
  openChannelConnectionForm,
  type ChannelConnectionFieldState,
  type ChannelConnectionFormModel,
  type ChannelConnectionProblem,
  type ServiceAccountSource,
} from "../channel-connection-form";
import { supportedTransports, type ChannelCatalogEntry } from "../channel-catalog";
import { RadioList } from "./channel-route-audience-controls";

function sourceOptions(t: TFunction): SegmentedControlOption<ServiceAccountSource>[] {
  return [
    { value: "paste", label: t("hub.channels.setup.pasteJson") },
    { value: "file", label: t("hub.channels.setup.fileOnHost") },
  ];
}

/**
 * The catalog-driven Add-connection form. `save` posts the body and answers with
 * the Hub's problem, or null when the Connection was created; the caller closes
 * the form on null.
 */
export function ChannelConnectionSetup({
  entry,
  takenNames,
  save,
  onCancel,
}: {
  entry: ChannelCatalogEntry;
  /** Names this channel's Connections already use; the suggested name avoids them. */
  takenNames: readonly string[];
  save(body: Record<string, unknown>): Promise<ChannelConnectionProblem | null>;
  onCancel?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const options = useMemo(() => sourceOptions(t), [t]);
  const [model] = useState(() => openChannelConnectionForm(entry, takenNames));
  useEffect(() => () => model.close(), [model]);
  useEffect(() => model.setTakenNames(takenNames), [model, takenNames]);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const submit = useSubmit(model, save);
  return (
    <SettingsSection title={t("hub.channels.catalogDetail.connect", { label: entry.label })}>
      <View style={[settingsStyles.card, styles.form]}>
        <Text style={settingsStyles.rowHint}>{supportedTransports(entry)[0]?.setup ?? ""}</Text>
        {/* A QR channel has nothing to paste: the scan happens on the Connection's card. */}
        {state.setup === "qr" ? (
          <Text style={settingsStyles.rowHint}>{t("hub.channels.setup.qrNextStep")}</Text>
        ) : null}
        {state.transports.length > 1 && state.transportId !== null ? (
          <Field label={t("hub.channels.setup.transport")}>
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
            label={t("hub.channels.setup.connectionName")}
            hint={t("hub.channels.setup.connectionNameHint")}
            error={state.accountIdError}
          >
            <FormTextInput
              // The suggestion changes when the Connection list loads, before the name is edited.
              key={state.accountIdSuggestion}
              initialValue={state.accountId}
              onChangeText={model.setAccountId}
              placeholder="support"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!state.submitting}
            />
          </Field>
        )}
        {state.serviceAccountSource === null ? null : (
          <Field label={t("hub.channels.setup.credentialSource")}>
            <SegmentedControl
              options={options}
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
            {state.setup === "qr"
              ? t("hub.channels.accounts.addConnection")
              : t("hub.channels.setup.verifyAndAdd")}
          </Button>
          {onCancel === undefined ? null : (
            <Button variant="ghost" disabled={state.submitting} onPress={onCancel}>
              {t("hub.channels.card.cancel")}
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
          title: i18n.t("hub.channels.setup.hubUnreachable"),
          detail:
            error instanceof Error ? error.message : i18n.t("hub.channels.setup.requestFailed"),
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
  const { t } = useTranslation();
  const change = useCallback((value: string) => onChange(field.key, value), [field.key, onChange]);
  if (field.kind === "choice" && field.choices !== null) {
    return (
      <RadioList
        label={field.label}
        options={field.choices}
        selected={field.value ?? ""}
        onChange={change}
        disabled={disabled}
      />
    );
  }
  return (
    <Field
      label={
        field.required ? field.label : t("hub.channels.setup.optional", { label: field.label })
      }
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
