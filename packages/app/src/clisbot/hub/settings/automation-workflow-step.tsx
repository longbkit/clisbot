import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectField } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  record,
  type AutomationWorkflowModel,
  type AutomationWorkflowState,
} from "../automation-workflow-model";
import {
  ManagedAgentConfigurationFields,
  type ManagedAgentConfigurationValue,
} from "./managed-agent-configuration-fields";
import { WorkflowEnvironment, type WorkflowDaemon } from "./automation-workflow-environment";
import { StepResultPage, type SetStepField } from "./automation-workflow-step-result";
import { workflowStyles as styles } from "./automation-workflow-styles";

type StepPage = "agent" | "instructions" | "result" | "advanced";
interface StepPageProps {
  state: AutomationWorkflowState;
  step: Record<string, unknown>;
  index: number;
  model: AutomationWorkflowModel;
  pending: boolean;
  set: SetStepField;
}

export function WorkflowStep({
  initialPage = "agent",
  model,
  index,
  pending,
  daemons,
  act,
}: {
  initialPage?: string;
  model: AutomationWorkflowModel;
  index: number;
  pending: boolean;
  daemons: WorkflowDaemon[];
  act(action: () => void): void;
}) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const step = state.steps[index]!;
  const [page, setPage] = useState(initialPage);
  const set = useCallback<SetStepField>(
    (key, value) => act(() => model.set(["steps", index, key], value)),
    [act, index, model],
  );
  const pages = useMemo(
    () =>
      (["agent", "instructions", "result", "advanced"] as const).map((value) => ({
        value,
        label: t(`hub.automations.workflow.pages.${value}`),
      })),
    [t],
  );
  const props: StepPageProps = { state, step, index, model, pending, set };
  return (
    <View style={styles.form}>
      <SegmentedControl<string> size="sm" value={page} onValueChange={setPage} options={pages} />
      <View style={styles.form}>
        <View style={pageStyle(page, "agent")}>
          <StepAgentPage {...props} daemons={daemons} />
        </View>
        <View style={pageStyle(page, "instructions")}>
          <StepInstructionsPage {...props} />
        </View>
        <View style={pageStyle(page, "result")}>
          <StepResultPage
            step={step}
            stepKey={state.stepKeys[index]}
            model={model}
            pending={pending}
            set={set}
          />
        </View>
        <View style={pageStyle(page, "advanced")}>
          <StepAdvancedPage {...props} act={act} />
        </View>
        {state.errors.length ? <Alert variant="error" title={state.errors.join(". ")} /> : null}
      </View>
    </View>
  );
}

/** Every page stays mounted so a field keeps its draft while another page is shown. */
function pageStyle(page: string, owner: StepPage) {
  return page === owner ? styles.form : styles.hidden;
}

function StepAgentPage({
  state,
  step,
  model,
  pending,
  set,
  daemons,
}: StepPageProps & { daemons: WorkflowDaemon[] }) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const environmentIndex = state.environments.findIndex((value) => value.name === step.environment);
  const environment = state.environments[environmentIndex];
  const daemon = daemons.find(
    (value) => value.id === environment?.daemon || value.slug === environment?.daemon,
  );
  const agent = useMemo(() => record(step.agent), [step.agent]);
  const value = useMemo(
    () => ({
      provider: String(agent.provider ?? ""),
      model: String(agent.model ?? ""),
      mode: String(agent.mode ?? ""),
      thinkingOptionId: String(agent.thinkingOptionId ?? ""),
      featureValues: record(agent.featureValues),
    }),
    [agent],
  );
  const changeSelection = useCallback((next: string) => set("agent", next), [set]);
  const changeConfiguration = useCallback(
    (next: ManagedAgentConfigurationValue) =>
      set("agent", {
        ...agent,
        ...next,
        model: next.model || undefined,
        mode: next.mode || undefined,
        thinkingOptionId: next.thinkingOptionId || undefined,
      }),
    [agent, set],
  );
  return (
    <>
      {environment ? (
        <WorkflowEnvironment
          key={String(environment.name)}
          environment={environment}
          index={environmentIndex}
          model={model}
          pending={pending}
          daemons={daemons}
        />
      ) : null}
      {typeof step.agent === "string" ? (
        <Field label={t("hub.automations.workflow.agentSelection")}>
          <FormTextInput
            size={size}
            initialValue={step.agent}
            onChangeText={changeSelection}
            editable={!pending}
            scrollEnabled
          />
        </Field>
      ) : (
        <ManagedAgentConfigurationFields
          cwd={String(environment?.cwd ?? "")}
          serverId={daemon?.connectionOffer?.serverId ?? null}
          value={value}
          onChange={changeConfiguration}
          disabled={pending}
        />
      )}
    </>
  );
}

function StepInstructionsPage({ state, step, index, model, pending, set }: StepPageProps) {
  const { t } = useTranslation();
  const prompt = useMemo(() => (Array.isArray(step.prompt) ? step.prompt : []), [step.prompt]);
  const prior = useMemo(
    () =>
      state.steps.slice(0, index).flatMap((previous) =>
        Object.keys(record(record(record(previous.output).schema).properties)).map((property) => ({
          id: `${previous.id}.${property}`,
          label: `${previous.id} → ${property}`,
          value: `\${{ steps.${previous.id}.outputs.${property} }}`,
        })),
      ),
    [index, state.steps],
  );
  const insertOutput = useCallback(
    (value: string) => set("prompt", [...prompt, { text: value }]),
    [prompt, set],
  );
  return (
    <>
      {prompt.map((block, position) => (
        <PromptBlockField
          // oxlint-disable-next-line react/no-array-index-key -- a prompt block is addressed by its position in the YAML list
          key={position}
          block={record(block)}
          position={position}
          stepIndex={index}
          model={model}
          pending={pending}
        />
      ))}
      {prior.length ? (
        <Field label={t("hub.automations.workflow.insertOutput")}>
          <SelectField
            label={t("hub.automations.workflow.previousOutput")}
            field={false}
            selectedDisplay={null}
            placeholder={t("hub.automations.workflow.chooseOutput")}
            emptyText={t("hub.automations.workflow.noOutputs")}
            value={null}
            options={prior}
            onChange={insertOutput}
            disabled={pending}
          />
        </Field>
      ) : null}
    </>
  );
}

function PromptBlockField({
  block,
  position,
  stepIndex,
  model,
  pending,
}: {
  block: Record<string, unknown>;
  position: number;
  stepIndex: number;
  model: AutomationWorkflowModel;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const field = block.include ? "include" : "text";
  const change = useCallback(
    (value: string) => model.set(["steps", stepIndex, "prompt", position, field], value),
    [field, model, position, stepIndex],
  );
  return (
    <Field
      label={
        position === 0
          ? t("hub.automations.run.prompt")
          : t("hub.automations.workflow.promptNumber", { number: position + 1 })
      }
    >
      <FormTextInput
        size={size}
        multiline
        initialValue={String(block.text ?? block.include ?? "")}
        onChangeText={change}
        editable={!pending}
        scrollEnabled
      />
    </Field>
  );
}

function StepAdvancedPage({
  state,
  step,
  index,
  model,
  pending,
  set,
  act,
}: StepPageProps & { act(action: () => void): void }) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const environmentName = String(step.environment);
  const selectedEnvironment = useMemo(() => ({ label: environmentName }), [environmentName]);
  const environmentOptions = useMemo(
    () =>
      state.environments.map((value) => ({
        id: String(value.name),
        label: String(value.name),
        value: String(value.name),
      })),
    [state.environments],
  );
  const setId = useCallback((value: string) => set("id", value), [set]);
  const setEnvironment = useCallback((value: string) => set("environment", value), [set]);
  const setCondition = useCallback((value: string) => set("if", value || undefined), [set]);
  const setMaxRuntime = useCallback((value: string) => set("max_runtime", value), [set]);
  const setIdleTimeout = useCallback((value: string) => set("idle_timeout", value), [set]);
  const separate = useCallback(
    () => act(() => model.separateEnvironment(index)),
    [act, index, model],
  );
  const moveUp = useCallback(() => model.moveStep(index, -1), [index, model]);
  const moveDown = useCallback(() => model.moveStep(index, 1), [index, model]);
  const remove = useCallback(() => act(() => model.removeStep(index)), [act, index, model]);
  return (
    <>
      <Field label={t("hub.automations.workflow.stepId")}>
        <FormTextInput
          size={size}
          initialValue={String(step.id)}
          onChangeText={setId}
          editable={!pending}
        />
      </Field>
      <Field label={t("hub.automations.workflow.environment")}>
        <SelectField
          label={t("hub.automations.workflow.environment")}
          field={false}
          selectedDisplay={selectedEnvironment}
          placeholder={t("hub.automations.workflow.chooseEnvironment")}
          emptyText={t("hub.automations.workflow.noEnvironments")}
          value={environmentName}
          options={environmentOptions}
          onChange={setEnvironment}
          disabled={pending}
        />
      </Field>
      <Button size="sm" variant="outline" disabled={pending} onPress={separate}>
        {t("hub.automations.workflow.separateEnvironment")}
      </Button>
      <Field label={t("hub.automations.workflow.runCondition")}>
        <FormTextInput
          size={size}
          initialValue={String(step.if ?? "")}
          onChangeText={setCondition}
          editable={!pending}
        />
      </Field>
      <Field label={t("hub.automations.form.maxRuntime")}>
        <FormTextInput
          size={size}
          initialValue={String(step.max_runtime)}
          onChangeText={setMaxRuntime}
          editable={!pending}
        />
      </Field>
      <Field label={t("hub.automations.form.idleTimeout")}>
        <FormTextInput
          size={size}
          initialValue={String(step.idle_timeout)}
          onChangeText={setIdleTimeout}
          editable={!pending}
        />
      </Field>
      <Button size="sm" variant="ghost" disabled={pending || index === 0} onPress={moveUp}>
        {t("hub.automations.workflow.moveUp")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending || index === state.steps.length - 1}
        onPress={moveDown}
      >
        {t("hub.automations.workflow.moveDown")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || state.steps.length === 1}
        onPress={remove}
      >
        {t("hub.automations.workflow.removeStep")}
      </Button>
    </>
  );
}
