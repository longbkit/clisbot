import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { parse, stringify } from "yaml";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { record, type AutomationWorkflowModel } from "../automation-workflow-model";
import { ConfigurationYamlInput } from "./configuration-yaml-input";
import { REPLY_PROVIDERS } from "./automation-workflow-labels";

export type SetStepField = (key: string, value: unknown) => void;
type Grant = Record<string, unknown>;

/** The Result page of a step: its output schema and which providers it may reply through. */
export function StepResultPage({
  step,
  stepKey,
  model,
  pending,
  set,
}: {
  step: Record<string, unknown>;
  stepKey: number;
  model: AutomationWorkflowModel;
  pending: boolean;
  set: SetStepField;
}) {
  const { t } = useTranslation();
  const schema = useMemo(() => record(record(step.output).schema), [step.output]);
  const grants = useMemo(
    () => (Array.isArray(step.allow_outputs) ? step.allow_outputs.map(record) : []),
    [step.allow_outputs],
  );
  const reportSchemaError = useCallback(
    (error: string | null) => model.setError(`${stepKey}:schema`, error),
    [model, stepKey],
  );
  const applySchema = useCallback(
    (value: unknown) => {
      if (value !== null && (typeof value !== "object" || Array.isArray(value)))
        throw new Error(t("hub.automations.workflow.outputSchemaObject"));
      set("output", Object.keys(record(value)).length ? { schema: value } : undefined);
    },
    [set, t],
  );
  return (
    <>
      <StructuredYaml
        label={t("hub.automations.workflow.outputSchema")}
        onError={reportSchemaError}
        value={schema}
        pending={pending}
        apply={applySchema}
      />
      {REPLY_PROVIDERS.map((provider) => (
        <ReplyGrantFields
          key={provider}
          provider={provider}
          stepId={String(step.id)}
          stepKey={stepKey}
          grants={grants}
          model={model}
          pending={pending}
          set={set}
        />
      ))}
    </>
  );
}

function ReplyGrantFields({
  provider,
  stepId,
  stepKey,
  grants,
  model,
  pending,
  set,
}: {
  provider: string;
  stepId: string;
  stepKey: number;
  grants: Grant[];
  model: AutomationWorkflowModel;
  pending: boolean;
  set: SetStepField;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const type = `${provider}.reply`;
  const grant = grants.find((entry) => entry.type === type);
  const toggle = useCallback(
    (enabled: boolean) =>
      set(
        "allow_outputs",
        enabled ? [...grants, { type, max: 1 }] : grants.filter((entry) => entry.type !== type),
      ),
    [grants, set, type],
  );
  const changeMax = useCallback(
    (value: string) => {
      const valid = value.trim() === "" || /^[1-9][0-9]*$/.test(value);
      model.setError(
        `${stepKey}:${provider}`,
        valid ? null : t("hub.automations.workflow.replyLimitInteger"),
      );
      const max = value.trim() ? Number(value) : undefined;
      if (valid)
        set(
          "allow_outputs",
          grants.map((entry) => (entry.type === type ? withMax(entry, max) : entry)),
        );
    },
    [grants, model, provider, set, stepKey, t, type],
  );
  return (
    <View>
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.rowTitle}>
          {t("hub.automations.workflow.providerReplies", { provider })}
        </Text>
        <Switch
          accessibilityLabel={t("hub.automations.workflow.providerRepliesFor", {
            provider,
            step: stepId,
          })}
          value={Boolean(grant)}
          disabled={pending}
          onValueChange={toggle}
        />
      </View>
      {grant ? (
        <Field label={t("hub.automations.replies.max", { channel: provider })}>
          <FormTextInput
            size={size}
            initialValue={grant.max === undefined ? "" : String(grant.max)}
            placeholder={t("hub.automations.unlimited")}
            editable={!pending}
            onChangeText={changeMax}
          />
        </Field>
      ) : null}
    </View>
  );
}

function withMax(grant: Grant, max: number | undefined): Grant {
  return { ...grant, max };
}

function StructuredYaml({
  label,
  value,
  pending,
  apply,
  onError,
}: {
  label: string;
  value: unknown;
  pending: boolean;
  apply(value: unknown): void;
  onError(error: string | null): void;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState(() => stringify(value));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = useCallback(() => setEditing((current) => !current), []);
  const change = useCallback(
    (text: string) => {
      setSource(text);
      try {
        apply(parse(text));
        setError(null);
        onError(null);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : t("hub.automations.workflow.invalidYaml");
        setError(message);
        onError(message);
      }
    },
    [apply, onError, t],
  );
  return (
    <Field label={label} error={error ?? undefined}>
      <Button size="sm" variant="outline" onPress={toggle}>
        {editing ? t("hub.automations.workflow.hide") : t("hub.automations.workflow.configure")}
      </Button>
      {editing ? (
        <ConfigurationYamlInput
          initialValue={source}
          onChangeText={change}
          editable={!pending}
          multiline
          scrollEnabled
        />
      ) : null}
    </Field>
  );
}
