import { ConfigurationYamlInput } from "./configuration-yaml-input";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { settingsStyles } from "@/styles/settings";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import {
  formatChannelConfigurationYaml,
  type ChannelConfigurationCandidate,
} from "../channel-configuration";
import type { HubChannelConfigurationSchema } from "../contracts";
import { openChannelYamlForm } from "./channel-advanced-configuration-form";

type HubChannelConfiguration = z.infer<typeof HubChannelConfigurationSchema>;
interface ConfigurationProps {
  model: ReturnType<typeof openChannelYamlForm>;
  channels: HubChannelConfiguration | undefined;
  pending: boolean;
  error?: string | null;
  validate(candidate: ChannelConfigurationCandidate): Promise<void>;
  save(candidate: ChannelConfigurationCandidate): Promise<boolean>;
  /** Opened from a menu: it starts open, and Hide closes it there. */
  close?: () => void;
}

export function AdvancedConfigurationSection(props: ConfigurationProps) {
  if (props.channels === undefined) return null;
  return <ChannelYamlEditor {...props} channels={props.channels} />;
}

export function useChannelYamlForm(channels: HubChannelConfiguration | undefined) {
  const source = channels
    ? formatChannelConfigurationYaml({
        resource: channels.resource ?? {},
        policy: channels.policy,
        accounts: channels.accounts,
      })
    : undefined;
  const revisionId = channels?.revision?.id ?? null;
  const [model] = useState(() => openChannelYamlForm({ source: source ?? "", revisionId }));
  useEffect(() => {
    if (source !== undefined) model.applySnapshot({ source, revisionId });
  }, [model, source, revisionId]);
  useEffect(() => () => model.close(), [model]);
  return model;
}

function ChannelYamlEditor({ model, pending, error, validate, save, close }: ConfigurationProps) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const [expanded, setExpanded] = useState(close !== undefined);
  const toggle = useCallback(() => {
    if (close === undefined) setExpanded((current) => !current);
    else close();
  }, [close]);
  const disclosureState = useMemo(() => ({ expanded }), [expanded]);
  const runValidation = useCallback(() => {
    void model.validate(validate);
  }, [model, validate]);
  const activate = useCallback(() => {
    void model.activate(save);
  }, [model, save]);
  const busy = pending || state.saving;
  return (
    <View style={styles.section}>
      <Button size="sm" variant="ghost" onPress={toggle} accessibilityState={disclosureState}>
        {expanded ? t("hub.channels.yaml.hide") : t("hub.channels.yaml.show")}
      </Button>
      {expanded ? (
        <View style={styles.editor}>
          <Text style={settingsStyles.rowHint}>{t("hub.channels.yaml.intro")}</Text>
          <Field label={t("hub.channels.yaml.fieldLabel")} hint={t("hub.channels.yaml.fieldHint")}>
            <ConfigurationYamlInput
              key={state.inputRevision}
              initialValue={state.source}
              onChangeText={model.change}
              accessibilityLabel={t("hub.channels.yaml.inputLabel")}
              dataSet={CODE_SURFACE_DATASET}
              multiline
              numberOfLines={16}
              scrollEnabled
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
          </Field>
          <YamlStatus state={state} error={error} />
          <View style={styles.actions}>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || state.stale || state.validation === "pending"}
              loading={state.validation === "pending"}
              onPress={runValidation}
            >
              {t("hub.channels.yaml.validate")}
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={busy || state.stale || !state.dirty || state.validation === "pending"}
              loading={busy}
              onPress={activate}
            >
              {t("hub.channels.yaml.activate")}
            </Button>
            {state.dirty || state.stale ? (
              <Button size="sm" variant="ghost" disabled={busy} onPress={model.reload}>
                {t("hub.channels.yaml.discard")}
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function YamlStatus({
  state,
  error,
}: {
  state: ReturnType<ReturnType<typeof openChannelYamlForm>["getState"]>;
  error?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      {state.stale ? (
        <Alert
          variant="warning"
          title={t("hub.channels.yaml.staleTitle")}
          description={t("hub.channels.yaml.staleBody")}
        />
      ) : null}
      {state.validation === "error" || error ? (
        <Alert
          variant="error"
          title={
            state.validation === "error"
              ? state.message
              : (error ?? t("hub.channels.yaml.activationFailed"))
          }
        />
      ) : null}
      {state.validation !== "error" && state.message ? (
        <Text accessibilityLiveRegion="polite" style={settingsStyles.rowHint}>
          {state.message}
        </Text>
      ) : null}
      {state.dirty && !state.stale ? (
        <Text style={settingsStyles.rowHint}>{t("hub.channels.yaml.unsaved")}</Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: { gap: theme.spacing[3] },
  editor: { gap: theme.spacing[3] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
