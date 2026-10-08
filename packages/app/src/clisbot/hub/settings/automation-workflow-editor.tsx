import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import {
  openAutomationWorkflow,
  record,
  type AutomationWorkflowModel,
  type AutomationWorkflowState,
} from "../automation-workflow-model";
import type { AutomationChannelDraft } from "./automation-input-draft";
import type { AutomationConnection } from "./automation-settings";
import { ConfigurationYamlInput } from "./configuration-yaml-input";
import { WorkflowEnvironment, type WorkflowDaemon } from "./automation-workflow-environment";
import { WorkflowInputs, type ChannelInputsComponent } from "./automation-workflow-inputs";
import {
  stepDependencies,
  stepReplyProviders,
  stepResultFields,
  stepTitle,
} from "./automation-workflow-labels";
import { WorkflowParameters } from "./automation-workflow-parameters";
import { WorkflowStep } from "./automation-workflow-step";
import { workflowStyles as styles } from "./automation-workflow-styles";

type Act = (action: () => void) => void;

export function AutomationWorkflowEditor({
  source,
  pending,
  save,
  daemons,
  connections = [],
  allowConnectionInputs = true,
  ChannelInputs,
  initialDraft = null,
  creating = false,
  cancel,
}: {
  source: string;
  creating?: boolean;
  cancel?(): void;
  pending: boolean;
  save(source: string, draft?: AutomationChannelDraft | null): void;
  initialDraft?: AutomationChannelDraft | null;
  connections?: AutomationConnection[];
  /**
   * False for a Member: Connection-sourced inputs (GitHub, Slack, Discord,
   * Linear) stay with Organization Admins, so Add input offers manual only.
   */
  allowConnectionInputs?: boolean;
  ChannelInputs?: ChannelInputsComponent;
  daemons: WorkflowDaemon[];
}) {
  const { t } = useTranslation();
  const [channelDraft, setChannelDraft] = useState(initialDraft);
  const [channelEditing, setChannelEditing] = useState(false);
  const [model] = useState(() => openAutomationWorkflow(source));
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const [error, setError] = useState<string | null>(null);
  const [yamlOpen, setYamlOpen] = useState(false);
  // Held here, outside the `state.version` key, so the section stays open across Apply YAML.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stepPage, setStepPage] = useState("agent");
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const act = useCallback<Act>(
    (action) => {
      try {
        action();
        setError(null);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : t("hub.automations.workflow.invalidConfiguration"),
        );
      }
    },
    [t],
  );
  const openStep = useCallback((stepKey: number | null, page: string) => {
    setStepPage(page);
    setSelectedStep(stepKey);
  }, []);
  const openReplies = useCallback(
    () => openStep(model.getState().stepKeys.at(-1) ?? null, "result"),
    [model, openStep],
  );
  const name = String(state.value.name ?? "");
  const submit = useCallback(
    () => save(state.yaml, channelDraft),
    [channelDraft, save, state.yaml],
  );
  return (
    <View key={state.version}>
      {creating ? (
        <NameSection model={model} name={name} editable={!channelEditing && !channelDraft} />
      ) : null}
      <WorkflowInputs
        model={model}
        state={state}
        pending={pending}
        connections={connections}
        allowConnectionInputs={allowConnectionInputs}
        ChannelInputs={ChannelInputs}
        channelDraft={channelDraft}
        stageChannelDraft={setChannelDraft}
        channelEditing={channelEditing}
        setChannelEditing={setChannelEditing}
        openReplies={openReplies}
      />
      <StepsSection
        model={model}
        state={state}
        disabled={pending || yamlOpen}
        addDisabled={pending || yamlOpen || channelEditing}
        act={act}
        openStep={openStep}
      />
      {selectedStep !== null && state.stepKeys.includes(selectedStep) ? (
        <StepSheet
          model={model}
          state={state}
          stepKey={selectedStep}
          page={stepPage}
          pending={pending}
          daemons={daemons}
          act={act}
          close={setSelectedStep}
        />
      ) : null}
      {error ? <Alert variant="error" title={error} /> : null}
      {state.errors.length ? <Alert variant="error" title={state.errors.join(". ")} /> : null}
      <View style={styles.secondarySettings}>
        <WorkflowSettings
          model={model}
          state={state}
          pending={pending}
          locked={yamlOpen}
          daemons={daemons}
          open={settingsOpen}
          setOpen={setSettingsOpen}
        />
        <YamlSection
          model={model}
          yaml={state.yaml}
          pending={pending}
          open={yamlOpen}
          setOpen={setYamlOpen}
          act={act}
        />
      </View>
      <EditorActions
        creating={creating}
        pending={pending}
        saveDisabled={
          pending || yamlOpen || channelEditing || state.errors.length > 0 || !name.trim()
        }
        submit={submit}
        cancel={cancel}
      />
    </View>
  );
}

function NameSection({
  model,
  name,
  editable,
}: {
  model: AutomationWorkflowModel;
  name: string;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const rename = useCallback((value: string) => model.set(["name"], value), [model]);
  return (
    <SettingsSection title={t("hub.automations.detail.automation")} prominence="primary">
      <Field label={t("hub.automations.form.name")}>
        <FormTextInput size={size} initialValue={name} onChangeText={rename} editable={editable} />
      </Field>
    </SettingsSection>
  );
}

function StepsSection({
  model,
  state,
  disabled,
  addDisabled,
  act,
  openStep,
}: {
  model: AutomationWorkflowModel;
  state: AutomationWorkflowState;
  disabled: boolean;
  addDisabled: boolean;
  act: Act;
  openStep(stepKey: number | null, page: string): void;
}) {
  const { t } = useTranslation();
  const addStep = useCallback(
    () =>
      act(() => {
        model.addStep();
        openStep(model.getState().stepKeys.at(-1) ?? null, "agent");
      }),
    [act, model, openStep],
  );
  const trailing = useMemo(
    () => (
      <Button size="sm" variant="outline" disabled={addDisabled} onPress={addStep}>
        {t("hub.automations.form.addStep")}
      </Button>
    ),
    [addDisabled, addStep, t],
  );
  return (
    <SettingsSection
      title={t("hub.automations.runDetails.steps")}
      prominence="primary"
      trailing={trailing}
    >
      <Text style={settingsStyles.rowHint}>{t("hub.automations.workflow.stepsHint")}</Text>
      <View style={settingsStyles.card}>
        {state.steps.map((step, index) => (
          <StepRow
            key={state.stepKeys[index]}
            step={step}
            steps={state.steps}
            index={index}
            stepKey={state.stepKeys[index]}
            disabled={disabled}
            openStep={openStep}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

function StepRow({
  step,
  steps,
  index,
  stepKey,
  disabled,
  openStep,
}: {
  step: Record<string, unknown>;
  steps: Record<string, unknown>[];
  index: number;
  stepKey: number;
  disabled: boolean;
  openStep(stepKey: number | null, page: string): void;
}) {
  const { t } = useTranslation();
  const edit = useCallback(() => openStep(stepKey, "agent"), [openStep, stepKey]);
  const agent = record(step.agent);
  const replies = stepReplyProviders(step);
  const dependencies = stepDependencies(step, steps);
  const resultFields = stepResultFields(step);
  return (
    <View style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {index + 1}. {stepTitle(step, index)}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {String(agent.model ?? agent.provider ?? step.agent)}
        </Text>
        {replies ? (
          <Text style={settingsStyles.rowHint}>
            {t("hub.automations.workflow.replies", { providers: replies })}
          </Text>
        ) : null}
        {dependencies ? <Text style={settingsStyles.rowHint}>{dependencies}</Text> : null}
        {resultFields ? (
          <Text style={settingsStyles.rowHint}>
            {t("hub.automations.workflow.result", { fields: resultFields })}
          </Text>
        ) : null}
      </View>
      <Button size="sm" variant="outline" disabled={disabled} onPress={edit}>
        {t("hub.automations.workflow.editStep")}
      </Button>
    </View>
  );
}

function StepSheet({
  model,
  state,
  stepKey,
  page,
  pending,
  daemons,
  act,
  close,
}: {
  model: AutomationWorkflowModel;
  state: AutomationWorkflowState;
  stepKey: number;
  page: string;
  pending: boolean;
  daemons: WorkflowDaemon[];
  act: Act;
  close(stepKey: null): void;
}) {
  const { t } = useTranslation();
  const index = state.stepKeys.indexOf(stepKey);
  const hasErrors = state.errors.length > 0;
  const stepId = String(state.steps[index].id);
  const header = useMemo(
    () => ({ title: t("hub.automations.workflow.stepTitle", { number: index + 1, id: stepId }) }),
    [index, stepId, t],
  );
  const done = useCallback(() => close(null), [close]);
  const closeWhenValid = useCallback(() => {
    if (!hasErrors) close(null);
  }, [close, hasErrors]);
  const footer = useMemo(
    () => (
      <Button disabled={hasErrors} onPress={done}>
        {t("hub.automations.workflow.done")}
      </Button>
    ),
    [done, hasErrors, t],
  );
  return (
    <AdaptiveModalSheet
      contentStyle={styles.sheetContent}
      visible
      onClose={closeWhenValid}
      header={header}
      footer={footer}
    >
      <WorkflowStep
        key={stepKey}
        initialPage={page}
        model={model}
        index={index}
        pending={pending}
        daemons={daemons}
        act={act}
      />
    </AdaptiveModalSheet>
  );
}

function WorkflowSettings({
  model,
  state,
  pending,
  locked,
  daemons,
  open,
  setOpen,
}: {
  model: AutomationWorkflowModel;
  state: AutomationWorkflowState;
  pending: boolean;
  /** The YAML editor is open, so per-environment edits would be overwritten. */
  locked: boolean;
  daemons: WorkflowDaemon[];
  open: boolean;
  setOpen(value: boolean): void;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  const trailing = useMemo(
    () => (
      <Button size="sm" variant="ghost" onPress={toggle}>
        {open
          ? t("hub.automations.workflow.closeSettings")
          : t("hub.automations.workflow.editSettings")}
      </Button>
    ),
    [open, t, toggle],
  );
  const setEnabled = useCallback((value: boolean) => model.set(["enabled"], value), [model]);
  const setMaxRuntime = useCallback((value: string) => model.set(["max_runtime"], value), [model]);
  return (
    <SettingsSection title={t("hub.automations.workflow.settings")} flush trailing={trailing}>
      <View style={open ? styles.form : styles.hidden}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowTitle}>{t("hub.automations.form.active")}</Text>
          <Switch
            accessibilityLabel={t("hub.automations.workflow.activeLabel")}
            value={state.value.enabled !== false}
            onValueChange={setEnabled}
            disabled={pending}
          />
        </View>
        <WorkflowParameters model={model} pending={pending} />
        <Field label={t("hub.automations.workflow.maxWorkflowRuntime")}>
          <FormTextInput
            size={size}
            initialValue={String(state.value.max_runtime ?? "2h")}
            onChangeText={setMaxRuntime}
            editable={!pending}
          />
        </Field>
        {state.environments.map((environment, index) => (
          <WorkflowEnvironment
            key={String(environment.name)}
            environment={environment}
            index={index}
            model={model}
            pending={pending || locked}
            daemons={daemons}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

function YamlSection({
  model,
  yaml,
  pending,
  open,
  setOpen,
  act,
}: {
  model: AutomationWorkflowModel;
  yaml: string;
  pending: boolean;
  open: boolean;
  setOpen(value: boolean): void;
  act: Act;
}) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState("");
  const toggle = useCallback(() => {
    setRaw(yaml);
    setOpen(!open);
  }, [open, setOpen, yaml]);
  const apply = useCallback(
    () =>
      act(() => {
        model.replaceYaml(raw);
        setOpen(false);
      }),
    [act, model, raw, setOpen],
  );
  const trailing = useMemo(
    () => (
      <Button size="sm" variant="ghost" disabled={pending} onPress={toggle}>
        {" "}
        {open
          ? t("hub.automations.workflow.closeYaml")
          : t("hub.automations.workflow.editYaml")}{" "}
      </Button>
    ),
    [open, pending, t, toggle],
  );
  return (
    <SettingsSection flush title={t("hub.automations.workflow.yaml")} trailing={trailing}>
      {open ? (
        <>
          <Field label={t("hub.automations.workflow.workflowYaml")}>
            <ConfigurationYamlInput
              initialValue={raw}
              onChangeText={setRaw}
              editable={!pending}
              multiline
              scrollEnabled
            />
          </Field>
          <Button size="sm" variant="outline" disabled={pending} onPress={apply}>
            {t("hub.automations.workflow.applyYaml")}
          </Button>
        </>
      ) : null}
    </SettingsSection>
  );
}

function EditorActions({
  creating,
  pending,
  saveDisabled,
  submit,
  cancel,
}: {
  creating: boolean;
  pending: boolean;
  saveDisabled: boolean;
  submit(): void;
  cancel?(): void;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  return (
    <View style={size === "sm" ? styles.desktopActions : styles.form}>
      <Button disabled={saveDisabled} variant="default" onPress={submit}>
        {creating ? t("hub.automations.createAutomation") : t("hub.automations.workflow.save")}
      </Button>
      {cancel ? (
        <Button variant="ghost" disabled={pending} onPress={cancel}>
          {t("common.actions.cancel")}
        </Button>
      ) : null}
    </View>
  );
}
