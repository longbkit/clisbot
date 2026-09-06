import { AutomationReplyNavigationContext } from "./automation-reply-navigation";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DaemonProjectField } from "./daemon-project-field";
import { Switch } from "@/components/ui/switch";
import { AutomationInputDraftContext, type AutomationChannelDraft } from "./automation-input-draft";
import type { AutomationConnection } from "./automation-settings";
import { StyleSheet } from "react-native-unistyles";
import { useState, useSyncExternalStore, type ComponentType } from "react";
import { Text, View } from "react-native";
import { stringify, parse } from "yaml";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { Alert } from "@/components/ui/alert";
import { useIsCompactFormFactor } from "@/constants/layout";
import { openAutomationWorkflow, record } from "../automation-workflow-model";
import { ConfigurationYamlInput } from "./configuration-yaml-input";
import { ManagedAgentConfigurationFields } from "./managed-agent-configuration-fields";

type Model = ReturnType<typeof openAutomationWorkflow>;
export function AutomationWorkflowEditor({
  source,
  pending,
  save,
  daemons,
  connections = [],
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
  ChannelInputs?: ComponentType<{ automationName: string; embedded?: boolean }>;
  daemons: { id: string; slug: string; connectionOffer: { serverId: string } | null }[];
}) {
  const [channelProvider, setChannelProvider] = useState<"slack" | "telegram" | null>(null);
  const [channelDraft, setChannelDraft] = useState(initialDraft);
  const [channelEditing, setChannelEditing] = useState(false);
  const [selectedInput, setSelectedInput] = useState<string | null>(null);
  const [addingInput, setAddingInput] = useState(false);
  const [model] = useState(() => openAutomationWorkflow(source));
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [stepPage, setStepPage] = useState("agent");
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [workflowAdvanced, setWorkflowAdvanced] = useState(false);
  const [raw, setRaw] = useState("");
  const size = useIsCompactFormFactor() ? "md" : "sm";
  function act(action: () => void) {
    try {
      action();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid configuration");
    }
  }
  return (
    <View key={state.version}>
      {creating ? (
        <SettingsSection title="Automation" prominence="primary">
          <Field label="Name">
            <FormTextInput
              size={size}
              initialValue={String(state.value.name ?? "")}
              onChangeText={(value) => model.set(["name"], value)}
              editable={creating && !channelEditing && !channelDraft}
            />
          </Field>
        </SettingsSection>
      ) : null}
      <SettingsSection
        title="Inputs"
        prominence="primary"
        trailing={
          <Button
            size="sm"
            variant="outline"
            disabled={pending || channelEditing || !String(state.value.name ?? "").trim()}
            onPress={() => setAddingInput(!addingInput)}
          >
            Add input
          </Button>
        }
      >
        <Text style={settingsStyles.rowHint}>Choose what starts this workflow.</Text>
        {!channelDraft && ChannelInputs ? (
          <AutomationReplyNavigationContext.Provider
            value={() => {
              setStepPage("result");
              setSelectedStep(state.stepKeys.at(-1) ?? null);
            }}
          >
            <ChannelInputs automationName={String(state.value.name)} embedded />
          </AutomationReplyNavigationContext.Provider>
        ) : null}
        {channelDraft?.accounts.flatMap((account) =>
          (Array.isArray(account.routes) ? account.routes : [])
            .filter((route) => record(route).workflow === state.value.name)
            .map((route, index) => (
              <View
                key={`${account.channel}:${account.accountId}:${index}`}
                style={settingsStyles.row}
              >
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>
                    {inputLabel(String(account.channel))} · {String(account.accountId)}
                  </Text>
                  <Text style={settingsStyles.rowHint}>
                    {routeSummary(record(record(route).match))}
                  </Text>
                </View>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() =>
                    setChannelProvider(account.channel === "telegram" ? "telegram" : "slack")
                  }
                >
                  Edit input
                </Button>
              </View>
            )),
        )}
        {addingInput || channelProvider || selectedInput ? (
          <AdaptiveModalSheet
            contentStyle={styles.sheetContent}
            visible
            header={{
              title: channelProvider
                ? `Add ${channelProvider === "slack" ? "Slack" : "Telegram"} input`
                : selectedInput
                  ? inputLabel(selectedInput)
                  : "Add input",
            }}
            onClose={() => {
              if (!channelEditing) {
                setAddingInput(false);
                setChannelProvider(null);
                setSelectedInput(null);
              }
            }}
            footer={
              <Button
                disabled={channelEditing}
                onPress={() => {
                  setAddingInput(false);
                  setChannelProvider(null);
                  setSelectedInput(null);
                }}
              >
                Done
              </Button>
            }
          >
            {addingInput ? (
              <SelectField
                label="Input source"
                value={null}
                selectedDisplay={null}
                placeholder="Choose source"
                emptyText="No sources"
                options={[
                  ...(ChannelInputs ? ["slack", "telegram"] : []),
                  "manual.run",
                  "github.issue_comment",
                  "discord.mention",
                  "linear.issue_created",
                ]
                  .filter(
                    (value) =>
                      value === "slack" ||
                      value === "telegram" ||
                      !(value in record(state.value.on)),
                  )
                  .map((value) => ({ id: value, value, label: inputLabel(value) }))}
                onChange={(value) => {
                  if (value === "slack" || value === "telegram") setChannelProvider(value);
                  else {
                    model.set(
                      ["on", value],
                      value === "manual.run" ? {} : { filters: { from_users: ["*"] } },
                    );
                  }
                  if (value !== "slack" && value !== "telegram") setSelectedInput(value);
                  setAddingInput(false);
                }}
              />
            ) : null}
            {channelProvider && ChannelInputs ? (
              <AutomationInputDraftContext.Provider
                value={{
                  provider: channelProvider,
                  draft: channelDraft,
                  stage: setChannelDraft,
                  setEditing: setChannelEditing,
                  pending,
                }}
              >
                <ChannelInputs automationName={String(state.value.name)} />
              </AutomationInputDraftContext.Provider>
            ) : null}
            {Object.entries(record(state.value.on))
              .filter(([event]) => event === selectedInput)
              .map(([event, definition]) => (
                <View key={event} style={styles.form}>
                  <Text style={settingsStyles.rowTitle}>{inputLabel(event)}</Text>
                  {event !== "manual.run" ? (
                    <>
                      <SelectField
                        label="Connection"
                        value={String(record(definition).connection ?? "")}
                        selectedDisplay={{
                          label: String(record(definition).connection ?? "Choose connection"),
                        }}
                        placeholder="Choose connection"
                        emptyText="No connections"
                        options={connections
                          .filter((connection) => connection.provider === event.split(".")[0])
                          .map((connection) => ({
                            id: connection.id,
                            value: connection.name,
                            label: connection.externalName ?? connection.name,
                          }))}
                        onChange={(value) => model.set(["on", event, "connection"], value)}
                        disabled={pending}
                      />
                      <Field label="Allowed provider users">
                        <FormTextInput
                          size={size}
                          initialValue={(
                            (record(record(definition).filters).from_users as string[]) ?? []
                          ).join(", ")}
                          onChangeText={(value) =>
                            model.set(
                              ["on", event, "filters", "from_users"],
                              value
                                .split(",")
                                .map((user) => user.trim())
                                .filter(Boolean),
                            )
                          }
                          editable={!pending}
                        />
                      </Field>
                    </>
                  ) : null}
                  {event.startsWith("github.") ? (
                    <Field label="Repository">
                      <FormTextInput
                        size={size}
                        initialValue={String(record(record(definition).filters).repo ?? "")}
                        onChangeText={(value) =>
                          model.set(["on", event, "filters", "repo"], value || undefined)
                        }
                        editable={!pending}
                      />
                    </Field>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onPress={() => {
                      model.set(["on", event], undefined);
                      setSelectedInput(null);
                      if (!Object.keys(record(model.getState().value.on)).length)
                        model.set(["on", "channel.message"], { filters: { from_users: ["*"] } });
                    }}
                  >
                    Remove input
                  </Button>
                </View>
              ))}
          </AdaptiveModalSheet>
        ) : null}
        {Object.entries(record(state.value.on))
          .filter(([event]) => event !== "channel.message")
          .map(([event, definition]) => (
            <View key={event} style={settingsStyles.row}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>{inputLabel(event)}</Text>
                <Text style={settingsStyles.rowHint}>
                  {String(record(definition).connection ?? "")}
                </Text>
              </View>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onPress={() => setSelectedInput(event)}
              >
                Edit input
              </Button>
            </View>
          ))}
      </SettingsSection>
      <SettingsSection
        title="Steps"
        prominence="primary"
        trailing={
          <Button
            size="sm"
            variant="outline"
            disabled={pending || advanced || channelEditing}
            onPress={() =>
              act(() => {
                model.addStep();
                setStepPage("agent");
                setSelectedStep(model.getState().stepKeys.at(-1) ?? null);
              })
            }
          >
            Add step
          </Button>
        }
      >
        <Text style={settingsStyles.rowHint}>
          Agents run in order. Each step can use results from earlier steps.
        </Text>
        <View style={settingsStyles.card}>
          {state.steps.map((step, index) => (
            <View
              key={state.stepKeys[index]}
              style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
            >
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {index + 1}. {stepTitle(step, index)}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {String(record(step.agent).model ?? record(step.agent).provider ?? step.agent)}
                </Text>
                {Array.isArray(step.allow_outputs) &&
                step.allow_outputs.some((grant) =>
                  String(record(grant).type).endsWith(".reply"),
                ) ? (
                  <Text style={settingsStyles.rowHint}>
                    Replies:{" "}
                    {step.allow_outputs
                      .filter((grant) => String(record(grant).type).endsWith(".reply"))
                      .map((grant) => String(record(grant).type).replace(".reply", ""))
                      .join(", ")}
                  </Text>
                ) : null}
                {stepDependencies(step, state.steps) ? (
                  <Text style={settingsStyles.rowHint}>{stepDependencies(step, state.steps)}</Text>
                ) : null}
                {Object.keys(record(record(step.output).schema).properties ?? {}).length ? (
                  <Text style={settingsStyles.rowHint}>
                    Result:{" "}
                    {Object.keys(record(record(record(step.output).schema).properties)).join(", ")}
                  </Text>
                ) : null}
              </View>
              <Button
                size="sm"
                variant="outline"
                disabled={pending || advanced}
                onPress={() => {
                  setStepPage("agent");
                  setSelectedStep(state.stepKeys[index]);
                }}
              >
                Edit step
              </Button>
            </View>
          ))}
        </View>
      </SettingsSection>
      {selectedStep !== null && state.stepKeys.includes(selectedStep) ? (
        <AdaptiveModalSheet
          contentStyle={styles.sheetContent}
          visible
          onClose={() => {
            if (state.errors.length === 0) setSelectedStep(null);
          }}
          header={{
            title: `Step ${state.stepKeys.indexOf(selectedStep) + 1} · ${String(state.steps[state.stepKeys.indexOf(selectedStep)].id)}`,
          }}
          footer={
            <Button disabled={state.errors.length > 0} onPress={() => setSelectedStep(null)}>
              Done
            </Button>
          }
        >
          <WorkflowStep
            key={selectedStep}
            initialPage={stepPage}
            model={model}
            index={state.stepKeys.indexOf(selectedStep)}
            pending={pending}
            daemons={daemons}
            act={act}
          />
        </AdaptiveModalSheet>
      ) : null}
      {error ? <Alert variant="error" title={error} /> : null}
      {state.errors.length ? <Alert variant="error" title={state.errors.join(". ")} /> : null}
      <View style={styles.secondarySettings}>
        <SettingsSection
          title="Settings"
          flush
          trailing={
            <Button
              size="sm"
              variant="ghost"
              onPress={() => setWorkflowAdvanced(!workflowAdvanced)}
            >
              {workflowAdvanced ? "Close settings" : "Edit settings"}
            </Button>
          }
        >
          <View style={workflowAdvanced ? styles.form : styles.hidden}>
            <View style={settingsStyles.row}>
              <Text style={settingsStyles.rowTitle}>Active</Text>
              <Switch
                accessibilityLabel="Workflow active"
                value={state.value.enabled !== false}
                onValueChange={(value) => model.set(["enabled"], value)}
                disabled={pending}
              />
            </View>

            <WorkflowParameters model={model} pending={pending} />
            <Field label="Maximum workflow runtime">
              <FormTextInput
                size={size}
                initialValue={String(state.value.max_runtime ?? "2h")}
                onChangeText={(value) => model.set(["max_runtime"], value)}
                editable={!pending}
              />
            </Field>
            {state.environments.map((environment, index) => (
              <WorkflowEnvironment
                key={String(environment.name)}
                environment={environment}
                index={index}
                model={model}
                pending={pending || advanced}
                daemons={daemons}
              />
            ))}
          </View>
        </SettingsSection>
        <SettingsSection
          flush
          title="YAML"
          trailing={
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onPress={() => {
                setRaw(state.yaml);
                setAdvanced(!advanced);
              }}
            >
              {" "}
              {advanced ? "Close YAML" : "Edit YAML"}{" "}
            </Button>
          }
        >
          {advanced ? (
            <>
              <Field label="Workflow YAML">
                <ConfigurationYamlInput
                  key={advanced ? "open" : "closed"}
                  initialValue={raw}
                  onChangeText={setRaw}
                  editable={!pending}
                  multiline
                  scrollEnabled
                />
              </Field>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onPress={() =>
                  act(() => {
                    model.replaceYaml(raw);
                    setAdvanced(false);
                  })
                }
              >
                Apply YAML to editor
              </Button>
            </>
          ) : null}
        </SettingsSection>
      </View>
      <View style={size === "sm" ? styles.desktopActions : styles.form}>
        <Button
          disabled={
            pending ||
            advanced ||
            channelEditing ||
            state.errors.length > 0 ||
            !String(state.value.name ?? "").trim()
          }
          variant="default"
          onPress={() => save(state.yaml, channelDraft)}
        >
          {creating ? "Create Automation" : "Save Workflow"}
        </Button>
        {cancel ? (
          <Button variant="ghost" disabled={pending} onPress={cancel}>
            Cancel
          </Button>
        ) : null}
      </View>
    </View>
  );
}
function WorkflowStep({
  initialPage = "agent",
  model,
  index,
  pending,
  daemons,
  act,
}: {
  initialPage?: string;
  model: Model;
  index: number;
  pending: boolean;
  daemons: { id: string; slug: string; connectionOffer: { serverId: string } | null }[];
  act(action: () => void): void;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const step = state.steps[index]!;
  const [page, setPage] = useState(initialPage);
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const set = (key: string, value: unknown) => act(() => model.set(["steps", index, key], value));
  const agent = record(step.agent);
  const environmentIndex = state.environments.findIndex((value) => value.name === step.environment);
  const environment = state.environments[environmentIndex];
  const daemon = daemons.find(
    (value) => value.id === environment?.daemon || value.slug === environment?.daemon,
  );
  const prompt = Array.isArray(step.prompt) ? step.prompt : [];
  const schema = record(record(step.output).schema);
  const prior = state.steps.slice(0, index).flatMap((previous) =>
    Object.keys(record(record(record(previous.output).schema).properties)).map((property) => ({
      id: `${previous.id}.${property}`,
      label: `${previous.id} → ${property}`,
      value: `\${{ steps.${previous.id}.outputs.${property} }}`,
    })),
  );
  return (
    <View style={styles.form}>
      <SegmentedControl
        size="sm"
        value={page}
        onValueChange={setPage}
        options={[
          { value: "agent", label: "Agent" },
          { value: "instructions", label: "Instructions" },
          { value: "result", label: "Result" },
          { value: "advanced", label: "Advanced" },
        ]}
      />
      <View style={styles.form}>
        <View style={page === "advanced" ? styles.form : styles.hidden}>
          <Field label="Step ID">
            <FormTextInput
              size={size}
              initialValue={String(step.id)}
              onChangeText={(value) => set("id", value)}
              editable={!pending}
            />
          </Field>
          <Field label="Environment">
            <SelectField
              label="Environment"
              field={false}
              selectedDisplay={{ label: String(step.environment) }}
              placeholder="Choose environment"
              emptyText="No environments"
              value={String(step.environment)}
              options={state.environments.map((value) => ({
                id: String(value.name),
                label: String(value.name),
                value: String(value.name),
              }))}
              onChange={(value) => set("environment", value)}
              disabled={pending}
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onPress={() => act(() => model.separateEnvironment(index))}
          >
            Use a separate environment
          </Button>
        </View>
        <View style={page === "agent" ? styles.form : styles.hidden}>
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
            <Field label="Agent selection">
              <FormTextInput
                size={size}
                initialValue={step.agent}
                onChangeText={(value) => set("agent", value)}
                editable={!pending}
                scrollEnabled
              />
            </Field>
          ) : (
            <ManagedAgentConfigurationFields
              cwd={String(environment?.cwd ?? "")}
              serverId={daemon?.connectionOffer?.serverId ?? null}
              value={{
                provider: String(agent.provider ?? ""),
                model: String(agent.model ?? ""),
                mode: String(agent.mode ?? ""),
                thinkingOptionId: String(agent.thinkingOptionId ?? ""),
                featureValues: record(agent.featureValues),
              }}
              onChange={(value) =>
                set("agent", {
                  ...agent,
                  ...value,
                  model: value.model || undefined,
                  mode: value.mode || undefined,
                  thinkingOptionId: value.thinkingOptionId || undefined,
                })
              }
              disabled={pending}
            />
          )}
        </View>
        <View style={page === "instructions" ? styles.form : styles.hidden}>
          {prompt.map((block, position) => (
            <Field key={position} label={position === 0 ? "Prompt" : `Prompt ${position + 1}`}>
              <FormTextInput
                size={size}
                multiline
                initialValue={String(record(block).text ?? record(block).include ?? "")}
                onChangeText={(value) =>
                  model.set(
                    [
                      "steps",
                      index,
                      "prompt",
                      position,
                      record(block).include ? "include" : "text",
                    ],
                    value,
                  )
                }
                editable={!pending}
                scrollEnabled
              />
            </Field>
          ))}
          {prior.length ? (
            <Field label="Insert output from previous step">
              <SelectField
                label="Previous output"
                field={false}
                selectedDisplay={null}
                placeholder="Choose output"
                emptyText="No outputs"
                value={null}
                options={prior}
                onChange={(value) => set("prompt", [...prompt, { text: value }])}
                disabled={pending}
              />
            </Field>
          ) : null}
        </View>
        <View style={page === "advanced" ? styles.form : styles.hidden}>
          <Field label="Run condition">
            <FormTextInput
              size={size}
              initialValue={String(step.if ?? "")}
              onChangeText={(value) => set("if", value || undefined)}
              editable={!pending}
            />
          </Field>
          <Field label="Maximum runtime">
            <FormTextInput
              size={size}
              initialValue={String(step.max_runtime)}
              onChangeText={(value) => set("max_runtime", value)}
              editable={!pending}
            />
          </Field>
          <Field label="Idle timeout">
            <FormTextInput
              size={size}
              initialValue={String(step.idle_timeout)}
              onChangeText={(value) => set("idle_timeout", value)}
              editable={!pending}
            />
          </Field>
        </View>
        <View style={page === "result" ? styles.form : styles.hidden}>
          <StructuredYaml
            label="Output schema"
            onError={(error) => model.setError(`${state.stepKeys[index]}:schema`, error)}
            value={schema}
            pending={pending}
            apply={(value) => {
              if (value !== null && (typeof value !== "object" || Array.isArray(value)))
                throw new Error("Output schema must be an object");
              set("output", Object.keys(record(value)).length ? { schema: value } : undefined);
            }}
          />
          {["slack", "telegram", "github", "discord", "linear"].map((provider) => {
            const grants = Array.isArray(step.allow_outputs) ? step.allow_outputs.map(record) : [];
            const type = `${provider}.reply`;
            const grant = grants.find((grant) => grant.type === type);
            return (
              <View key={provider}>
                <View style={settingsStyles.row}>
                  <Text style={settingsStyles.rowTitle}>{provider} replies</Text>
                  <Switch
                    accessibilityLabel={`${provider} replies for ${step.id}`}
                    value={Boolean(grant)}
                    disabled={pending}
                    onValueChange={(enabled) =>
                      set(
                        "allow_outputs",
                        enabled
                          ? [...grants, { type, max: 1 }]
                          : grants.filter((grant) => grant.type !== type),
                      )
                    }
                  />
                </View>
                {grant ? (
                  <Field label={`Maximum ${provider} replies`}>
                    <FormTextInput
                      size={size}
                      initialValue={grant.max === undefined ? "" : String(grant.max)}
                      placeholder="Unlimited"
                      editable={!pending}
                      onChangeText={(value) => {
                        const valid = value.trim() === "" || /^[1-9][0-9]*$/.test(value);
                        model.setError(
                          `${state.stepKeys[index]}:${provider}`,
                          valid ? null : "Reply limit must be a positive integer",
                        );
                        if (valid)
                          set(
                            "allow_outputs",
                            grants.map((entry) =>
                              entry.type === type
                                ? { ...entry, max: value.trim() ? Number(value) : undefined }
                                : entry,
                            ),
                          );
                      }}
                    />
                  </Field>
                ) : null}
              </View>
            );
          })}
        </View>
        <View style={page === "advanced" ? styles.form : styles.hidden}>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || index === 0}
            onPress={() => model.moveStep(index, -1)}
          >
            Move up
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || index === state.steps.length - 1}
            onPress={() => model.moveStep(index, 1)}
          >
            Move down
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || state.steps.length === 1}
            onPress={() => act(() => model.removeStep(index))}
          >
            Remove step
          </Button>
        </View>
        {state.errors.length ? <Alert variant="error" title={state.errors.join(". ")} /> : null}
      </View>
    </View>
  );
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
  const [source, setSource] = useState(() => stringify(value));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Field label={label} error={error ?? undefined}>
      <Button size="sm" variant="outline" onPress={() => setEditing(!editing)}>
        {editing ? "Hide" : "Configure"}
      </Button>
      {editing ? (
        <ConfigurationYamlInput
          initialValue={source}
          onChangeText={(text) => {
            setSource(text);
            try {
              apply(parse(text));
              setError(null);
              onError(null);
            } catch (cause) {
              const message = cause instanceof Error ? cause.message : "Invalid YAML";
              setError(message);
              onError(message);
            }
          }}
          editable={!pending}
          multiline
          scrollEnabled
        />
      ) : null}
    </Field>
  );
}

const styles = StyleSheet.create((theme) => ({
  secondarySettings: { gap: theme.spacing[3], marginBottom: theme.spacing[4] },
  desktopActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[3] },
  hidden: { display: "none" },
  sheetContent: { padding: theme.spacing[6], gap: theme.spacing[4] },
  form: { gap: theme.spacing[4] },
}));

function WorkflowEnvironment({
  environment,
  index,
  model,
  pending,
  daemons,
}: {
  environment: Record<string, unknown>;
  index: number;
  model: Model;
  pending: boolean;
  daemons: { id: string; slug: string; connectionOffer: { serverId: string } | null }[];
}) {
  const [expanded, setExpanded] = useState(!environment.daemon);
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const daemon = daemons.find(
    (value) => value.id === environment.daemon || value.slug === environment.daemon,
  );
  return (
    <SettingsSection
      title={`Environment · ${environment.name}`}
      trailing={
        <Button size="sm" variant="ghost" onPress={() => setExpanded(!expanded)}>
          {expanded ? "Collapse" : "Edit target"}
        </Button>
      }
    >
      {expanded && environment.kind === "daemon" ? (
        <View style={styles.form}>
          <SelectField
            label="Host"
            selectedDisplay={{ label: daemon?.slug ?? String(environment.daemon) }}
            value={String(environment.daemon)}
            placeholder="Choose Host"
            emptyText="No Hosts"
            size={size}
            options={daemons.map((value) => ({ id: value.id, value: value.id, label: value.slug }))}
            onChange={(value) => {
              model.set(["environments", index, "daemon"], value);
              model.set(["environments", index, "projectId"], undefined);
            }}
            disabled={pending}
          />
          <DaemonProjectField
            key={String(environment.daemon)}
            daemonId={daemon?.id ?? null}
            serverId={daemon?.connectionOffer?.serverId ?? null}
            value={typeof environment.projectId === "string" ? environment.projectId : null}
            cwd={String(environment.cwd ?? "")}
            onChange={(value) => model.set(["environments", index, "projectId"], value)}
            onCwdChange={(value) => model.set(["environments", index, "cwd"], value)}
            disabled={pending}
          />
        </View>
      ) : (
        <Text style={settingsStyles.rowHint}>
          {daemon?.slug ?? String(environment.kind)} · {String(environment.cwd ?? "")}
        </Text>
      )}
    </SettingsSection>
  );
}

function inputLabel(source: string): string {
  return (
    (
      {
        slack: "Slack",
        telegram: "Telegram",
        "manual.run": "Manual / API",
        "github.issue_comment": "GitHub issue comment",
        "discord.mention": "Discord mention",
        "linear.issue_created": "Linear issue created",
      } as Record<string, string>
    )[source] ?? source
  );
}

function stepTitle(step: Record<string, unknown>, index: number): string {
  const prompt = Array.isArray(step.prompt) ? step.prompt : [];
  const text = String(record(prompt[0]).text ?? "")
    .split("\n")[0]
    .trim();
  return text && !text.startsWith("${{") ? text.slice(0, 72) : `Agent step ${index + 1}`;
}

function routeSummary(match: Record<string, unknown>): string {
  const parts: string[] = [];
  if (match.kind) parts.push(String(match.kind));
  if (Array.isArray(match.ids)) parts.push(match.ids.join(", "));
  if (match.mention === true || match.mention === "required") parts.push("Mentions only");
  if (match.contains) parts.push(`Contains: ${String(match.contains)}`);
  return parts.join(" · ") || "Configured conversation filter";
}

function WorkflowParameters({ model, pending }: { model: Model; pending: boolean }) {
  const [rows, setRows] = useState(() =>
    Object.entries(record(model.getState().value.inputs)).map(([name, definition], key) => ({
      key,
      name,
      definition: record(definition),
    })),
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const size = useIsCompactFormFactor() ? "md" : "sm";
  function update(next: typeof rows) {
    setRows(next);
    const names = next.map((row) => row.name);
    const valid =
      names.every((name) => /^[A-Za-z][A-Za-z0-9_]*$/.test(name)) &&
      new Set(names).size === names.length;
    model.setError(
      "parameters",
      valid ? null : "Parameters need unique names starting with a letter.",
    );
    if (valid)
      model.set(["inputs"], Object.fromEntries(next.map((row) => [row.name, row.definition])));
  }
  return (
    <View style={styles.form}>
      <Text style={settingsStyles.rowTitle}>Parameters</Text>
      <Text style={settingsStyles.rowHint}>
        Named values supplied to a run, separate from the sources that start it.
      </Text>
      {rows.map((row, index) => (
        <View key={row.key} style={styles.form}>
          <Field label={`Parameter ${index + 1}`}>
            <FormTextInput
              size={size}
              initialValue={row.name}
              editable={!pending}
              onChangeText={(name) =>
                update(rows.map((item) => (item.key === row.key ? { ...item, name } : item)))
              }
            />
          </Field>
          <SelectField
            label="Type"
            value={String(row.definition.type ?? "string")}
            selectedDisplay={{ label: String(row.definition.type ?? "string") }}
            options={["string", "number", "boolean"].map((type) => ({
              id: type,
              value: type,
              label: type,
            }))}
            placeholder="Choose type"
            emptyText="No types"
            disabled={pending}
            onChange={(type) =>
              update(
                rows.map((item) =>
                  item.key === row.key
                    ? { ...item, definition: { ...item.definition, type } }
                    : item,
                ),
              )
            }
          />
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowTitle}>Required</Text>
            <Switch
              accessibilityLabel={`Require parameter ${index + 1}`}
              disabled={pending}
              value={row.definition.required === true}
              onValueChange={(required) =>
                update(
                  rows.map((item) =>
                    item.key === row.key
                      ? { ...item, definition: { ...item.definition, required } }
                      : item,
                  ),
                )
              }
            />
          </View>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onPress={() => update(rows.filter((item) => item.key !== row.key))}
          >
            Remove parameter
          </Button>
        </View>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onPress={() => {
          let name = `parameter_${nextKey + 1}`;
          while (rows.some((row) => row.name === name)) name += "_";
          update([...rows, { key: nextKey, name, definition: { type: "string" } }]);
          setNextKey(nextKey + 1);
        }}
      >
        Add parameter
      </Button>
    </View>
  );
}

function stepDependencies(step: Record<string, unknown>, steps: Record<string, unknown>[]): string {
  const references = [
    ...new Set(
      [...JSON.stringify(step).matchAll(/steps\.([A-Za-z0-9_-]+)\.outputs/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  const positions = references
    .map((id) => steps.findIndex((candidate) => candidate.id === id) + 1)
    .filter((position) => position > 0);
  return positions.length ? `Uses result from step ${positions.join(", ")}` : "";
}
