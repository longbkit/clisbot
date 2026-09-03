import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { createAutomation } from "../automation-management";
import {
  automationRouteBacklinks,
  buildSingleAgentAutomationYaml,
  normalizeAutomationInputName,
  normalizeAutomationName,
  parseSingleAgentAutomationYaml,
  type AutomationEventValue,
  type AutomationInputValue,
  type AutomationOutputValue,
  type AutomationRouteBacklink,
  type SingleAgentAutomationValue,
} from "../automation-configuration";
import {
  HubAutomationActivitySchema,
  HubAutomationRunResultSchema,
  HubAutomationRevisionsSchema,
  HubAutomationSchema,
  HubAutomationValidationSchema,
  HubAutomationsSchema,
  HubChannelConfigurationSchema,
  HubConnectionsSchema,
  HubDaemonsSchema,
  HubEffectiveAccessSchema,
  type HubAutomationRunResult,
  HubRunnableAutomationsSchema,
  type HubRunnableAutomation,
} from "../contracts";
import {
  isWorkspaceConfigurationValid,
  workspaceConfigurationFromTarget,
  worktreeTargetFromConfiguration,
} from "../workspace-configuration";
import { DaemonProjectField } from "./daemon-project-field";
import {
  ManagedAgentConfigurationFields,
  type ManagedAgentConfigurationValue,
} from "./managed-agent-configuration-fields";
import { ManagedWorkspaceFields } from "./managed-workspace-fields";

export interface AutomationConnection {
  id: string;
  provider: string;
  name: string;
  externalName: string | null;
  status: string;
}

type ManagedAutomation = z.infer<typeof HubAutomationsSchema>["automations"][number];
type EffectiveAccess = z.infer<typeof HubEffectiveAccessSchema>;
type AutomationInputDraft = AutomationInputValue & { editorId: string };
let automationInputEditorSequence = 0;

function automationInputDraft(input: AutomationInputValue): AutomationInputDraft {
  automationInputEditorSequence += 1;
  return { ...input, editorId: `automation-input-${String(automationInputEditorSequence)}` };
}

interface AutomationEventDefinition {
  name: string;
  label: string;
  provider?: "slack" | "discord" | "github" | "linear";
  description: string;
}

const AUTOMATION_EVENTS: readonly AutomationEventDefinition[] = [
  {
    name: "manual.run",
    label: "Manual or API run",
    description: "Starts when an authorized caller supplies the declared inputs.",
  },
  {
    name: "slack.mention",
    label: "Slack mention",
    provider: "slack",
    description: "Starts for a mention received by one Slack Connection.",
  },
  {
    name: "discord.mention",
    label: "Discord mention",
    provider: "discord",
    description: "Starts for a mention received by one Discord Connection.",
  },
  {
    name: "github.issue_comment",
    label: "GitHub issue comment",
    provider: "github",
    description: "Starts for an issue or pull-request comment on one GitHub Connection.",
  },
  {
    name: "linear.issue_created",
    label: "Linear issue created",
    provider: "linear",
    description: "Starts when one Linear Connection receives a new issue.",
  },
];

const INPUT_TYPE_OPTIONS: SelectFieldOption<AutomationInputValue["type"]>[] = [
  { id: "string", value: "string", label: "Text" },
  { id: "number", value: "number", label: "Number" },
  { id: "boolean", value: "boolean", label: "On or off" },
];
const NOOP_ASYNC = async () => undefined;

// eslint-disable-next-line complexity -- one settings coordinator owns the query/load/detail states.
export function AutomationSettings() {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  const automations = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "automations"],
    queryFn: () => hub.api().get("automations", HubAutomationsSchema),
    enabled: organizationId.length > 0 && canManage,
    retry: false,
    dataShape: "list",
    staleTimeMs: 15_000,
  });
  const runnableAutomations = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "automations", "runnable"],
    queryFn: () => hub.api().get("automations/runnable", HubRunnableAutomationsSchema),
    enabled: organizationId.length > 0 && !canManage,
    retry: false,
    dataShape: "list",
    staleTimeMs: 15_000,
  });
  const daemons = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "daemons"],
    queryFn: () => hub.api().get("daemons", HubDaemonsSchema),
    enabled: organizationId.length > 0 && canManage,
    retry: false,
    dataShape: "list",
    staleTimeMs: 15_000,
  });
  const connections = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "connections"],
    queryFn: () => hub.api().get("connections", HubConnectionsSchema),
    enabled: organizationId.length > 0 && canManage,
    retry: false,
    dataShape: "list",
    staleTimeMs: 15_000,
  });
  const channelConfiguration = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "channel-configuration"],
    queryFn: () => hub.api().get("channel-configuration", HubChannelConfigurationSchema),
    enabled: organizationId.length > 0 && canManage,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const effectiveAccess = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "access-assignments", "effective"],
    queryFn: () => hub.api().get("access-assignments/effective", HubEffectiveAccessSchema),
    enabled: organizationId.length > 0 && canManage,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);

  const create = useCallback(
    async (yaml: string) => {
      setPending(true);
      setError(null);
      try {
        await createAutomation(hub.api(), yaml);
        await automations.refetch();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Hub request failed.");
      } finally {
        setPending(false);
      }
    },
    [automations, hub],
  );
  const openAutomation = useCallback((automationId: string) => {
    setSelectedAutomationId(automationId);
  }, []);
  const closeAutomation = useCallback(() => {
    setSelectedAutomationId(null);
  }, []);
  const refreshAutomation = useCallback(async () => {
    await Promise.all([automations.refetch(), channelConfiguration.refetch()]);
  }, [automations, channelConfiguration]);
  const createFromYaml = useCallback(
    (yaml: string) => {
      void create(yaml);
    },
    [create],
  );

  const selectedAutomation =
    automations.data?.automations.find(({ id }) => id === selectedAutomationId) ?? null;
  const backlinks = useMemo(
    () =>
      selectedAutomation === null
        ? []
        : automationRouteBacklinks(
            channelConfiguration.data?.accounts ?? [],
            selectedAutomation.name,
          ),
    [channelConfiguration.data?.accounts, selectedAutomation],
  );
  const canRunSelectedAutomation = canRunAutomation(selectedAutomation, effectiveAccess.data);

  if (!canManage) {
    return (
      <RunnableAutomationSettings
        automations={runnableAutomations.data?.automations ?? []}
        pending={runnableAutomations.isPending}
        error={runnableAutomations.error}
      />
    );
  }

  return (
    <View>
      <SettingsSection title="Automations">
        <Alert
          variant="info"
          title="Use an Automation for reusable work"
          description="An Automation starts one configured Agent from an event, a direct run, or a Channel route. Its target, Agent controls, limits, and output actions are fixed by the active revision."
        />
        <QueryFeedback pending={automations.isPending} error={automations.error} />
        {error ? <Alert variant="error" title={error} /> : null}
        <View style={settingsStyles.card}>
          {(automations.data?.automations.length ?? 0) === 0 ? (
            <EmptyRow message="No Automations are configured." />
          ) : (
            automations.data?.automations.map((automation, index) => (
              <ManagedAutomationRow
                key={automation.id}
                automation={automation}
                bordered={index > 0}
                open={openAutomation}
              />
            ))
          )}
        </View>
      </SettingsSection>
      {selectedAutomationId ? (
        <AutomationDetail
          key={selectedAutomation?.activeRevisionId ?? selectedAutomationId}
          automation={selectedAutomation}
          daemons={daemons.data?.daemons ?? []}
          connections={connections.data?.connections ?? []}
          backlinks={backlinks}
          canManage={canManage}
          canRun={canRunSelectedAutomation}
          close={closeAutomation}
          saved={refreshAutomation}
        />
      ) : null}
      {canManage ? (
        <SingleAgentAutomationForm
          daemons={daemons.data?.daemons ?? []}
          connections={connections.data?.connections ?? []}
          existingNames={automations.data?.automations.map(({ name }) => name) ?? []}
          pending={pending}
          save={createFromYaml}
        />
      ) : null}
    </View>
  );
}

function ManagedAutomationRow({
  automation,
  bordered,
  open,
}: {
  automation: ManagedAutomation;
  bordered: boolean;
  open(automationId: string): void;
}) {
  const openAutomation = useCallback(() => {
    open(automation.id);
  }, [automation.id, open]);
  const value = parseSingleAgentAutomationYaml(automation.yaml);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{automation.name}</Text>
        <Text style={settingsStyles.rowHint}>
          {[
            automation.enabled ? "Active" : "Disabled",
            automation.format === "legacy_multistep" ? "Legacy multi-step" : "Single Agent",
            value?.description,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      <Button size="xs" variant="ghost" onPress={openAutomation}>
        Open
      </Button>
    </View>
  );
}

function canRunAutomation(
  automation: ManagedAutomation | null,
  access: EffectiveAccess | undefined,
) {
  if (automation === null) return false;
  if (access?.owner === true) return true;
  return (
    access?.grants.some(
      ({ resource, privileges }) =>
        resource.kind === "automation" &&
        resource.id === automation.id &&
        resource.available &&
        privileges.includes("automation.run"),
    ) === true
  );
}

function RunnableAutomationSettings({
  automations,
  pending,
  error,
}: {
  automations: readonly HubRunnableAutomation[];
  pending: boolean;
  error: Error | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = automations.find(({ id }) => id === selectedId) ?? null;
  const selectAutomation = useCallback((automationId: string) => {
    setSelectedId(automationId);
  }, []);
  const closeAutomation = useCallback(() => {
    setSelectedId(null);
  }, []);
  if (selected !== null) {
    return (
      <View>
        <SettingsSection title={selected.name}>
          <View style={settingsStyles.card}>
            {selected.description ? (
              <SummaryRow title="Description" hint={selected.description} />
            ) : (
              <SummaryRow title="Access" hint="Run this Automation" />
            )}
          </View>
        </SettingsSection>
        <AutomationRunForm
          automationId={selected.id}
          inputs={runnableAutomationInputs(selected)}
          completed={NOOP_ASYNC}
        />
        <Button size="sm" variant="ghost" onPress={closeAutomation}>
          Back to Automations
        </Button>
      </View>
    );
  }
  return (
    <SettingsSection title="Automations">
      <Alert
        variant="info"
        title="Run assigned Automations"
        description="Only the prompt and declared inputs are editable. Automation targets and authority remain fixed by their active revisions."
      />
      <QueryFeedback pending={pending} error={error} />
      <View style={settingsStyles.card}>
        {automations.length === 0 ? (
          <EmptyRow message="No Automations are assigned to you." />
        ) : (
          automations.map((automation, index) => (
            <RunnableAutomationRow
              key={automation.id}
              automation={automation}
              bordered={index > 0}
              select={selectAutomation}
            />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function RunnableAutomationRow({
  automation,
  bordered,
  select,
}: {
  automation: HubRunnableAutomation;
  bordered: boolean;
  select(automationId: string): void;
}) {
  const open = useCallback(() => {
    select(automation.id);
  }, [automation.id, select]);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{automation.name}</Text>
        {automation.description ? (
          <Text style={settingsStyles.rowHint}>{automation.description}</Text>
        ) : null}
      </View>
      <Button size="xs" variant="ghost" onPress={open}>
        Open
      </Button>
    </View>
  );
}

function runnableAutomationInputs(automation: HubRunnableAutomation): AutomationInputValue[] {
  return Object.entries(automation.inputs).map(([name, definition]) => {
    const input: AutomationInputValue = {
      name,
      type: definition.type,
      required: definition.required ?? false,
    };
    if (definition.default !== undefined) input.default = definition.default;
    if (definition.choices !== undefined) input.choices = definition.choices;
    return input;
  });
}

// eslint-disable-next-line complexity -- one detail route owns its mutually exclusive view states.
function AutomationDetail({
  automation,
  daemons,
  connections,
  backlinks,
  canManage,
  canRun,
  close,
  saved,
}: {
  automation: {
    id: string;
    name: string;
    enabled: boolean;
    format: string;
    activeRevisionId: string;
    yaml: string;
  } | null;
  daemons: {
    id: string;
    slug: string;
    connectionOffer: { serverId: string } | null;
  }[];
  connections: AutomationConnection[];
  backlinks: readonly AutomationRouteBacklink[];
  canManage: boolean;
  canRun: boolean;
  close(): void;
  saved(): Promise<unknown>;
}) {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const automationId = automation?.id ?? "";
  const history = useFetchQuery({
    queryKey: [
      "clisbot",
      "hub",
      hub.origin,
      organizationId,
      "automations",
      automationId,
      "revisions",
    ],
    queryFn: () =>
      hub
        .api()
        .get(
          `automations/${encodeURIComponent(automationId)}/revisions`,
          HubAutomationRevisionsSchema,
        ),
    enabled: automationId.length > 0,
    retry: false,
    dataShape: "list",
    staleTimeMs: 15_000,
  });
  const activity = useFetchQuery({
    queryKey: [
      "clisbot",
      "hub",
      hub.origin,
      organizationId,
      "automations",
      automationId,
      "activity",
    ],
    queryFn: () =>
      hub
        .api()
        .get(
          `automations/${encodeURIComponent(automationId)}/activity`,
          HubAutomationActivitySchema,
        ),
    enabled: automationId.length > 0,
    retry: false,
    dataShape: "list",
    staleTimeMs: 15_000,
  });
  const [yaml, setYaml] = useState(automation?.yaml ?? "");
  const [pending, setPending] = useState<"validate" | "save" | null>(null);
  const [result, setResult] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const structuredValue = useMemo(
    () =>
      automation === null || automation.format === "legacy_multistep"
        ? null
        : parseSingleAgentAutomationYaml(automation.yaml),
    [automation],
  );

  const validate = useCallback(async () => {
    setPending("validate");
    setResult(null);
    try {
      const response = await hub
        .api()
        .post("automations/validate", { yaml }, HubAutomationValidationSchema);
      setResult({ tone: "success", message: `${response.name} is valid. Nothing was activated.` });
    } catch (cause) {
      setResult({
        tone: "error",
        message: cause instanceof Error ? cause.message : "Validation failed.",
      });
    } finally {
      setPending(null);
    }
  }, [hub, yaml]);
  const save = useCallback(
    async (source = yaml) => {
      if (automation === null) return;
      setPending("save");
      setResult(null);
      try {
        await hub
          .api()
          .post("automations/validate", { yaml: source }, HubAutomationValidationSchema);
        await hub
          .api()
          .put(
            `automations/${encodeURIComponent(automation.id)}`,
            { expectedRevisionId: automation.activeRevisionId, yaml: source },
            HubAutomationSchema,
          );
        await saved();
        await Promise.all([history.refetch(), activity.refetch()]);
        setResult({ tone: "success", message: "Automation activated." });
      } catch (cause) {
        setResult({
          tone: "error",
          message: cause instanceof Error ? cause.message : "Save failed.",
        });
      } finally {
        setPending(null);
      }
    },
    [activity, automation, history, hub, saved, yaml],
  );
  const refreshActivity = useCallback(() => activity.refetch(), [activity]);
  const saveStructured = useCallback(
    (source: string) => {
      void save(source);
    },
    [save],
  );
  const validateCurrent = useCallback(() => {
    void validate();
  }, [validate]);
  const saveCurrent = useCallback(() => {
    void save();
  }, [save]);

  if (automation === null) {
    return (
      <SettingsSection title="Automation">
        <Alert variant="error" title="Automation is unavailable." />
        <Button size="sm" variant="outline" onPress={close}>
          Close
        </Button>
      </SettingsSection>
    );
  }

  const advancedReadOnly = structuredValue === null;
  return (
    <View>
      <SettingsSection title={automation.name}>
        <View style={settingsStyles.card}>
          <SummaryRow title="Status" hint={automation.enabled ? "Active" : "Disabled"} />
          <SummaryRow
            title="Type"
            hint={automation.format === "legacy_multistep" ? "Legacy multi-step" : "Single Agent"}
            border
          />
          {structuredValue?.description ? (
            <SummaryRow title="Description" hint={structuredValue.description} border />
          ) : null}
          <SummaryRow title="Active revision" hint={automation.activeRevisionId} border />
        </View>
      </SettingsSection>
      {structuredValue?.events.some(({ name }) => name === "manual.run") && canRun ? (
        <AutomationRunForm
          automationId={automation.id}
          inputs={structuredValue.inputs}
          completed={refreshActivity}
        />
      ) : null}
      {structuredValue !== null && canManage ? (
        <SingleAgentAutomationForm
          title={`Edit ${automation.name}`}
          initialValue={structuredValue}
          daemons={daemons}
          connections={connections}
          existingNames={[]}
          pending={pending !== null}
          save={saveStructured}
        />
      ) : null}
      <SettingsSection title="Routes and triggers">
        <View style={settingsStyles.card}>
          {structuredValue?.events.map((event, index) => (
            <SummaryRow
              key={`${event.name}:${event.connection ?? ""}`}
              title={eventLabel(event.name)}
              hint={automationEventHint(event)}
              border={index > 0}
            />
          ))}
          {backlinks.map((backlink, index) => (
            <SummaryRow
              key={`${backlink.channel}:${backlink.accountId}:${String(backlink.routePosition)}`}
              title={`${capitalize(backlink.channel)} · ${backlink.accountId}`}
              hint={
                backlink.routePosition === "fallback"
                  ? "Fallback Route"
                  : `Route ${String(backlink.routePosition + 1)}`
              }
              border={(structuredValue?.events.length ?? 0) + index > 0}
            />
          ))}
          {(structuredValue?.events.length ?? 0) === 0 && backlinks.length === 0 ? (
            <EmptyRow message="See Advanced YAML for this Automation's triggers." />
          ) : null}
        </View>
      </SettingsSection>
      <SettingsSection title="Advanced">
        {advancedReadOnly ? (
          <Alert
            variant="info"
            title="This definition is read-only in Paseo"
            description={
              automation.format === "legacy_multistep"
                ? "Legacy multi-step Automations remain runnable, but Paseo does not activate edits until a deliberate multi-step editor exists."
                : "This one-Agent definition contains fields the structured editor cannot round-trip without losing data."
            }
          />
        ) : null}
        <View style={[settingsStyles.card, styles.form]}>
          <Field
            label="Authored YAML"
            hint={
              advancedReadOnly
                ? "View the exact active revision."
                : "Validate uses the activation compiler and Host references without creating a revision."
            }
          >
            <FormTextInput
              initialValue={automation.yaml}
              onChangeText={setYaml}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              editable={canManage && pending === null && !advancedReadOnly}
            />
          </Field>
          {result ? <Alert variant={result.tone} title={result.message} /> : null}
          <View style={styles.actions}>
            {!advancedReadOnly ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending !== null}
                onPress={validateCurrent}
              >
                {pending === "validate" ? "Validating…" : "Validate"}
              </Button>
            ) : null}
            {canManage && !advancedReadOnly ? (
              <Button
                size="sm"
                disabled={pending !== null || yaml === automation.yaml}
                onPress={saveCurrent}
              >
                {pending === "save" ? "Activating…" : "Activate changes"}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={pending !== null} onPress={close}>
              Close
            </Button>
          </View>
        </View>
      </SettingsSection>
      <SettingsSection title="Revision history">
        <View style={settingsStyles.card}>
          {history.data?.revisions.map((revision, index) => (
            <View
              key={revision.id}
              style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
            >
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {`Revision ${String(revision.version)}${revision.id === automation.activeRevisionId ? " · Active" : ""}`}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {new Date(revision.createdAt).toLocaleString()}
                </Text>
              </View>
            </View>
          )) ?? <EmptyRow message="Loading revisions…" />}
        </View>
      </SettingsSection>
      <SettingsSection title="Activity">
        <View style={settingsStyles.card}>
          {activity.data?.activity.length === 0 ? <EmptyRow message="No runs yet." /> : null}
          {activity.data?.activity.map((run, index) => (
            <View
              key={run.id}
              style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
            >
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>{`${run.status} · ${run.provider}`}</Text>
                <Text style={settingsStyles.rowHint}>
                  {`${new Date(run.createdAt).toLocaleString()}${run.error ? ` · ${run.error}` : ""}`}
                </Text>
              </View>
            </View>
          )) ?? <EmptyRow message="Loading activity…" />}
        </View>
      </SettingsSection>
    </View>
  );
}

function AutomationRunForm({
  automationId,
  inputs,
  completed,
}: {
  automationId: string;
  inputs: readonly AutomationInputValue[];
  completed(): Promise<unknown>;
}) {
  const hub = useHubAccount();
  const [prompt, setPrompt] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      inputs.map((input) => [input.name, input.default === undefined ? "" : String(input.default)]),
    ),
  );
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const parsed = parseAutomationRunInputs(inputs, values);

  const run = useCallback(async () => {
    if (!parsed.ok) return;
    setPending(true);
    setResult(null);
    try {
      const response = await hub
        .api()
        .post(
          `automations/${encodeURIComponent(automationId)}/runs`,
          { prompt, inputs: parsed.inputs },
          HubAutomationRunResultSchema,
        );
      if (response.status === "dispatched") {
        setResult({
          tone: "success",
          message: `Run ${response.workflowStatus}.`,
        });
        await completed();
      } else {
        setResult({ tone: "error", message: automationRunResultMessage(response) });
      }
    } catch (cause) {
      setResult({
        tone: "error",
        message: cause instanceof Error ? cause.message : "Automation run failed.",
      });
    } finally {
      setPending(false);
    }
  }, [automationId, completed, hub, parsed, prompt]);
  const runAutomation = useCallback(() => {
    void run();
  }, [run]);

  return (
    <SettingsSection title="Run">
      <Alert
        variant="info"
        title="Run the active revision"
        description="Only the prompt and declared inputs can change. The target, Agent controls, limits, and output actions remain fixed."
      />
      <View style={[settingsStyles.card, styles.form]}>
        {inputs.map((input) => (
          <AutomationRunInput
            key={input.name}
            input={input}
            value={values[input.name] ?? ""}
            setValues={setValues}
            pending={pending}
          />
        ))}
        <Field
          label="Prompt"
          hint="The request supplied to the active Automation. It cannot change the configured target or Agent authority."
        >
          <FormTextInput initialValue="" onChangeText={setPrompt} multiline editable={!pending} />
        </Field>
        {!parsed.ok ? <Alert variant="error" title={parsed.message} /> : null}
        {result ? <Alert variant={result.tone} title={result.message} /> : null}
        <View style={styles.actions}>
          <Button size="sm" disabled={pending || !parsed.ok} onPress={runAutomation}>
            {pending ? "Starting…" : "Run Automation"}
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}

function AutomationRunInput({
  input,
  value,
  setValues,
  pending,
}: {
  input: AutomationInputValue;
  value: string;
  setValues: Dispatch<SetStateAction<Record<string, string>>>;
  pending: boolean;
}) {
  const changeValue = useCallback(
    (nextValue: string) => {
      setValues((current) => ({ ...current, [input.name]: nextValue }));
    },
    [input.name, setValues],
  );
  return (
    <Field label={humanize(input.name)} hint={runInputHint(input)}>
      <FormTextInput
        initialValue={value}
        onChangeText={changeValue}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!pending}
      />
    </Field>
  );
}

function parseAutomationRunInputs(
  definitions: readonly AutomationInputValue[],
  values: Readonly<Record<string, string>>,
):
  | { ok: true; inputs: Record<string, string | number | boolean> }
  | { ok: false; message: string } {
  const inputs: Record<string, string | number | boolean> = {};
  for (const definition of definitions) {
    const raw = values[definition.name] ?? "";
    if (raw.length === 0) {
      if (definition.required && definition.default === undefined) {
        return { ok: false, message: `${humanize(definition.name)} is required.` };
      }
      continue;
    }
    let value: string | number | boolean = raw;
    if (definition.type === "number") {
      value = Number(raw);
      if (!Number.isFinite(value)) {
        return { ok: false, message: `${humanize(definition.name)} must be a number.` };
      }
    } else if (definition.type === "boolean") {
      if (raw !== "true" && raw !== "false") {
        return { ok: false, message: `${humanize(definition.name)} must be true or false.` };
      }
      value = raw === "true";
    }
    if (
      definition.choices !== undefined &&
      !definition.choices.some((choice) => Object.is(choice, value))
    ) {
      return {
        ok: false,
        message: `${humanize(definition.name)} must be one of the configured choices.`,
      };
    }
    inputs[definition.name] = value;
  }
  return { ok: true, inputs };
}

function runInputHint(input: AutomationInputValue): string {
  const requirement = input.required ? "Required" : "Optional";
  const choices = input.choices?.map(String).join(", ");
  return `${requirement} ${input.type}${choices ? ` · Choices: ${choices}` : ""}`;
}

function automationRunResultMessage(
  result: Exclude<HubAutomationRunResult, { status: "dispatched" }>,
): string {
  switch (result.status) {
    case "invalid_input":
      return result.issues[0]?.message ?? "The declared inputs are invalid.";
    case "actor_forbidden":
      return "Your account is not allowed by this Automation's manual trigger.";
    case "daemon_offline":
      return "The configured Host is offline.";
    case "expected_configuration_not_current":
      return "The active revision changed. Review it and run again.";
    case "configuration_not_found":
    case "trigger_not_found":
      return "The active Automation cannot accept a manual run.";
    case "dispatch_conflict":
      return "The run could not be resolved. Try again.";
    case "infrastructure_unavailable":
      return "Automation runtime is unavailable.";
  }
}

// eslint-disable-next-line complexity -- this stateful editor keeps one Automation draft coherent.
export function SingleAgentAutomationForm({
  title = "Create Automation",
  initialValue = null,
  daemons,
  connections,
  existingNames,
  pending,
  cancel,
  save,
}: {
  title?: string;
  initialValue?: SingleAgentAutomationValue | null;
  daemons: {
    id: string;
    slug: string;
    connectionOffer: { serverId: string } | null;
  }[];
  connections: AutomationConnection[];
  existingNames: string[];
  pending: boolean;
  cancel?: () => void;
  save(yaml: string): void | Promise<void>;
}) {
  const [name, setName] = useState(initialValue?.name ?? "");
  const [description, setDescription] = useState(initialValue?.description ?? "");
  const [enabled, setEnabled] = useState(initialValue?.enabled ?? true);
  const [events, setEvents] = useState<AutomationEventValue[]>(
    initialValue?.events ?? [{ name: "manual.run" }],
  );
  const [inputs, setInputs] = useState<AutomationInputDraft[]>(() =>
    (initialValue?.inputs ?? []).map(automationInputDraft),
  );
  const [daemonId, setDaemonId] = useState<string | null>(initialValue?.daemonId ?? null);
  const [projectId, setProjectId] = useState<string | null>(initialValue?.projectId ?? null);
  const [cwd, setCwd] = useState(initialValue?.cwd ?? "");
  const [workspace, setWorkspace] = useState(() =>
    workspaceConfigurationFromTarget(initialValue?.worktree),
  );
  const [agentConfiguration, setAgentConfiguration] = useState<ManagedAgentConfigurationValue>({
    provider: initialValue?.provider ?? "",
    model: initialValue?.model ?? "",
    mode: initialValue?.mode ?? "",
    thinkingOptionId: initialValue?.thinkingOptionId ?? "",
    featureValues: initialValue?.featureValues ?? {},
  });
  const [reuseBinding, setReuseBinding] = useState(initialValue?.reuseBinding ?? false);
  const [providerOptions, setProviderOptions] = useState(
    initialValue === null || Object.keys(initialValue.options).length === 0
      ? ""
      : JSON.stringify(initialValue.options, null, 2),
  );
  const [instruction, setInstruction] = useState(
    initialValue?.instruction ?? "Help the user with this request.",
  );
  const [maxRuntime, setMaxRuntime] = useState(initialValue?.maxRuntime ?? "2h");
  const [idleTimeout, setIdleTimeout] = useState(initialValue?.idleTimeout ?? "10m");
  const [autoArchive, setAutoArchive] = useState(initialValue?.autoArchive ?? true);
  const [outputSchema, setOutputSchema] = useState(
    initialValue?.outputSchema === undefined
      ? ""
      : JSON.stringify(initialValue.outputSchema, null, 2),
  );
  const [replyLimits, setReplyLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (initialValue?.outputs ?? [])
        .filter(({ type }) => type.endsWith(".reply"))
        .map(({ type, max }) => [type, max === undefined ? "" : String(max)]),
    ),
  );
  const normalizedName = normalizeAutomationName(name);
  const duplicate = initialValue === null && existingNames.includes(normalizedName);
  const options = parseOptionalObject(providerOptions);
  const parsedOutputSchema = parseOptionalObject(outputSchema);
  const replyLimitsValid = Object.values(replyLimits).every(
    (value) =>
      value.trim().length === 0 ||
      (/^[1-9][0-9]*$/u.test(value.trim()) && Number.isSafeInteger(Number(value))),
  );
  const configuredOutputs = automationOutputs(initialValue?.outputs ?? [], events, replyLimits);
  const normalizedInputNames = inputs.map(({ name: inputName }) =>
    normalizeAutomationInputName(inputName),
  );
  const inputsValid =
    normalizedInputNames.every((inputName) => inputName.length > 0) &&
    new Set(normalizedInputNames).size === normalizedInputNames.length;
  const eventsValid =
    events.length > 0 &&
    events.every((event) => {
      const definition = AUTOMATION_EVENTS.find(({ name: eventName }) => eventName === event.name);
      return definition?.provider === undefined || Boolean(event.connection);
    });
  const daemonOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      daemons.map((daemon) => ({
        id: daemon.id,
        value: daemon.id,
        label: daemon.slug,
      })),
    [daemons],
  );
  const selectedDaemon = daemonOptions.find((option) => option.value === daemonId) ?? null;
  const selectedDaemonServerId =
    daemons.find((daemon) => daemon.id === daemonId)?.connectionOffer?.serverId ?? null;
  const canSave =
    normalizedName.length > 0 &&
    !duplicate &&
    eventsValid &&
    inputsValid &&
    daemonId !== null &&
    projectId !== null &&
    cwd.trim().length > 0 &&
    isWorkspaceConfigurationValid(workspace) &&
    agentConfiguration.provider.trim().length > 0 &&
    maxRuntime.trim().length > 0 &&
    idleTimeout.trim().length > 0 &&
    options.valid &&
    parsedOutputSchema.valid &&
    replyLimitsValid;

  const updateEvent = useCallback((eventName: string, update: Partial<AutomationEventValue>) => {
    setEvents((current) =>
      current.map((event) => (event.name === eventName ? { ...event, ...update } : event)),
    );
  }, []);
  const addInput = useCallback(() => {
    setInputs((current) => [
      ...current,
      automationInputDraft({ name: "", type: "string", required: false }),
    ]);
  }, []);
  const selectedDaemonDisplay = useMemo(
    () => (selectedDaemon === null ? null : { label: selectedDaemon.label }),
    [selectedDaemon],
  );
  const changeDaemon = useCallback((value: string) => {
    setDaemonId(value);
    setProjectId(null);
  }, []);
  const activateAutomation = useCallback(() => {
    if (daemonId === null || projectId === null || !options.valid || !parsedOutputSchema.valid)
      return;
    const worktree = worktreeTargetFromConfiguration(workspace);
    void save(
      buildSingleAgentAutomationYaml({
        name,
        description,
        enabled,
        events,
        inputs,
        daemonId,
        projectId,
        cwd,
        ...(worktree === undefined ? {} : { worktree }),
        provider: agentConfiguration.provider,
        model: agentConfiguration.model,
        mode: agentConfiguration.mode,
        thinkingOptionId: agentConfiguration.thinkingOptionId,
        ...(Object.keys(agentConfiguration.featureValues).length > 0
          ? { featureValues: agentConfiguration.featureValues }
          : {}),
        ...(options.value === undefined ? {} : { options: options.value }),
        instruction,
        reuseBinding,
        maxRuntime,
        idleTimeout,
        autoArchive,
        ...(parsedOutputSchema.value === undefined
          ? {}
          : { outputSchema: parsedOutputSchema.value }),
        ...(configuredOutputs.length > 0 ? { outputs: configuredOutputs } : {}),
      }),
    );
  }, [
    agentConfiguration,
    autoArchive,
    configuredOutputs,
    cwd,
    daemonId,
    description,
    enabled,
    events,
    idleTimeout,
    inputs,
    instruction,
    maxRuntime,
    name,
    options,
    parsedOutputSchema,
    projectId,
    reuseBinding,
    save,
    workspace,
  ]);

  return (
    <SettingsSection title={title}>
      <View style={[settingsStyles.card, styles.form]}>
        <Field
          label="Name"
          hint={
            normalizedName && normalizedName !== name.trim()
              ? `Saved as ${normalizedName}`
              : undefined
          }
          error={duplicate ? "An Automation with this name already exists." : null}
        >
          <FormTextInput
            initialValue={initialValue?.name ?? ""}
            onChangeText={setName}
            placeholder="customer-handoff"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending && initialValue === null}
          />
        </Field>
        <Field label="Description" hint="Optional. Explain when this Automation should be used.">
          <FormTextInput
            initialValue={initialValue?.description ?? ""}
            onChangeText={setDescription}
            placeholder="Triage a customer request and prepare a response."
            multiline
            editable={!pending}
          />
        </Field>
        <SwitchRow
          title="Active"
          hint="Inactive Automations keep their revision but do not accept new runs."
          value={enabled}
          onValueChange={setEnabled}
          disabled={pending}
          accessibilityLabel="Automation active"
        />
      </View>

      <View style={[settingsStyles.card, styles.form, styles.sectionCard]}>
        <Text style={styles.sectionTitle}>Starts from</Text>
        <Text style={settingsStyles.rowHint}>
          Choose any direct events. A Channel Route may invoke this Automation separately and does
          not need a channel.message event here.
        </Text>
        {AUTOMATION_EVENTS.map((definition) => (
          <AutomationEventEditor
            key={definition.name}
            definition={definition}
            event={events.find(({ name: eventName }) => eventName === definition.name)}
            connections={connections}
            replyLimit={
              definition.provider === undefined
                ? ""
                : (replyLimits[`${definition.provider}.reply`] ?? "")
            }
            replyLimitsValid={replyLimitsValid}
            pending={pending}
            updateEvent={updateEvent}
            setEvents={setEvents}
            setReplyLimits={setReplyLimits}
          />
        ))}
        {events
          .filter(
            ({ name: eventName }) =>
              !AUTOMATION_EVENTS.some(({ name: definitionName }) => definitionName === eventName),
          )
          .map((event) => (
            <LegacyAutomationEvent
              key={event.name}
              event={event}
              pending={pending}
              setEvents={setEvents}
            />
          ))}
        {!eventsValid ? (
          <Alert
            variant="error"
            title="Choose at least one event and a Connection for each provider event."
          />
        ) : null}
      </View>

      <View style={[settingsStyles.card, styles.form, styles.sectionCard]}>
        <Text style={styles.sectionTitle}>Inputs</Text>
        <Text style={settingsStyles.rowHint}>
          Callers may supply only these values. Inputs never replace the fixed Host, Project, Agent
          controls, or output actions.
        </Text>
        {inputs.map((input, index) => (
          <AutomationInputEditor
            key={input.editorId}
            input={input}
            index={index}
            pending={pending}
            setInputs={setInputs}
          />
        ))}
        {!inputsValid ? (
          <Alert
            variant="error"
            title="Every input needs a unique name that starts with a letter."
          />
        ) : null}
        <Button size="xs" variant="outline" disabled={pending || !inputsValid} onPress={addInput}>
          Add input
        </Button>
      </View>

      <View style={[settingsStyles.card, styles.form, styles.sectionCard]}>
        <Text style={styles.sectionTitle}>Target and Agent</Text>
        <SelectField
          label="Host"
          value={daemonId}
          selectedDisplay={selectedDaemonDisplay}
          options={daemonOptions}
          onChange={changeDaemon}
          placeholder="Choose a Host"
          emptyText="Enroll a Daemon first."
          searchable={daemonOptions.length > 6}
          title="Host"
          disabled={pending}
        />
        <DaemonProjectField
          daemonId={daemonId}
          value={projectId}
          onChange={setProjectId}
          disabled={pending}
        />
        <Field label="Working directory">
          <FormTextInput
            initialValue={initialValue?.cwd ?? ""}
            onChangeText={setCwd}
            placeholder="/workspace/project"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />
        </Field>
        <ManagedWorkspaceFields value={workspace} onChange={setWorkspace} disabled={pending} />
        <ManagedAgentConfigurationFields
          serverId={selectedDaemonServerId}
          cwd={cwd}
          value={agentConfiguration}
          onChange={setAgentConfiguration}
          disabled={pending}
        />
        <SwitchRow
          title="Continue the same Agent"
          hint="When a Channel Route invokes this Automation, reuse a compatible Agent for the same Channel conversation. Other event runs still create a new Agent."
          value={reuseBinding}
          onValueChange={setReuseBinding}
          disabled={pending}
          accessibilityLabel="Continue the same Agent for Channel runs"
        />
        <Field
          label="Provider options"
          hint="Optional JSON object for provider-specific settings."
          error={options.valid ? null : "Enter a JSON object."}
        >
          <FormTextInput
            initialValue={
              initialValue === null || Object.keys(initialValue.options).length === 0
                ? ""
                : JSON.stringify(initialValue.options, null, 2)
            }
            onChangeText={setProviderOptions}
            placeholder='{"setting": true}'
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            editable={!pending}
          />
        </Field>
        <Field
          label="Instruction"
          hint="The direct event payload, Channel message, or manual input is appended automatically."
        >
          <FormTextInput
            initialValue={initialValue?.instruction ?? "Help the user with this request."}
            onChangeText={setInstruction}
            multiline
            editable={!pending}
          />
        </Field>
      </View>

      <View style={[settingsStyles.card, styles.form, styles.sectionCard]}>
        <Text style={styles.sectionTitle}>Limits and outputs</Text>
        <Field
          label="Maximum runtime"
          hint="Examples: 30m, 2h. The Hub rejects values above its instance ceiling."
        >
          <FormTextInput
            initialValue={initialValue?.maxRuntime ?? "2h"}
            onChangeText={setMaxRuntime}
            placeholder="2h"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />
        </Field>
        <Field label="Idle timeout" hint="Stops a run that makes no progress for this long.">
          <FormTextInput
            initialValue={initialValue?.idleTimeout ?? "10m"}
            onChangeText={setIdleTimeout}
            placeholder="10m"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />
        </Field>
        <SwitchRow
          title="Archive Agent when finished"
          hint="Keeps completed Automation Agents out of active workspace lists."
          value={autoArchive}
          onValueChange={setAutoArchive}
          disabled={pending}
          accessibilityLabel="Archive Agent when Automation finishes"
        />
        <Field
          label="Structured result schema"
          hint="Optional JSON Schema for the result recorded when the Agent finishes."
          error={parsedOutputSchema.valid ? null : "Enter a JSON object."}
        >
          <FormTextInput
            initialValue={
              initialValue?.outputSchema === undefined
                ? ""
                : JSON.stringify(initialValue.outputSchema, null, 2)
            }
            onChangeText={setOutputSchema}
            placeholder='{"type":"object","properties":{"summary":{"type":"string"}}}'
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            editable={!pending}
          />
        </Field>
      </View>

      <AutomationReview
        daemon={selectedDaemon?.label ?? null}
        projectId={projectId}
        agent={agentConfiguration}
        maxRuntime={maxRuntime}
        idleTimeout={idleTimeout}
        events={events}
        outputs={configuredOutputs}
      />

      <View style={[settingsStyles.card, styles.form, styles.sectionCard]}>
        <Button disabled={pending || !canSave} onPress={activateAutomation}>
          {initialValue === null ? "Create Automation" : "Activate Automation changes"}
        </Button>
        {cancel ? (
          <Button variant="ghost" disabled={pending} onPress={cancel}>
            Cancel
          </Button>
        ) : null}
      </View>
    </SettingsSection>
  );
}

function AutomationEventEditor({
  definition,
  event,
  connections,
  replyLimit,
  replyLimitsValid,
  pending,
  updateEvent,
  setEvents,
  setReplyLimits,
}: {
  definition: AutomationEventDefinition;
  event: AutomationEventValue | undefined;
  connections: AutomationConnection[];
  replyLimit: string;
  replyLimitsValid: boolean;
  pending: boolean;
  updateEvent(eventName: string, update: Partial<AutomationEventValue>): void;
  setEvents: Dispatch<SetStateAction<AutomationEventValue[]>>;
  setReplyLimits: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const connectionOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      connections
        .filter(
          (candidate) =>
            candidate.provider === definition.provider && candidate.status !== "disconnected",
        )
        .map((candidate) => ({
          id: candidate.id,
          value: candidate.name,
          label: candidate.externalName ?? candidate.name,
          description: candidate.name,
        })),
    [connections, definition.provider],
  );
  const selectedConnection =
    connectionOptions.find(({ value }) => value === event?.connection) ?? null;
  const selectedConnectionDisplay = useMemo(
    () =>
      selectedConnection === null
        ? null
        : {
            label: selectedConnection.label,
            description: selectedConnection.description,
          },
    [selectedConnection],
  );
  const toggleEvent = useCallback(
    (selected: boolean) => {
      if (!selected) {
        setEvents((current) => current.filter(({ name }) => name !== definition.name));
        return;
      }
      const next: AutomationEventValue = { name: definition.name };
      if (definition.provider !== undefined) {
        next.connection = connectionOptions[0]?.value;
        next.allowedUsers = ["*"];
      }
      setEvents((current) => [...current, next]);
    },
    [connectionOptions, definition.name, definition.provider, setEvents],
  );
  const changeConnection = useCallback(
    (connectionName: string) => {
      updateEvent(definition.name, { connection: connectionName });
    },
    [definition.name, updateEvent],
  );
  const changeAllowedUsers = useCallback(
    (value: string) => {
      updateEvent(definition.name, { allowedUsers: commaSeparated(value) });
    },
    [definition.name, updateEvent],
  );
  const changeReplyLimit = useCallback(
    (value: string) => {
      if (definition.provider === undefined) return;
      setReplyLimits((current) => ({
        ...current,
        [`${definition.provider}.reply`]: value,
      }));
    },
    [definition.provider, setReplyLimits],
  );

  return (
    <View style={styles.choiceGroup}>
      <SwitchRow
        title={definition.label}
        hint={definition.description}
        value={event !== undefined}
        onValueChange={toggleEvent}
        disabled={pending}
        accessibilityLabel={`Use ${definition.label}`}
      />
      {event !== undefined && definition.provider !== undefined ? (
        <>
          <SelectField
            label="Connection"
            value={event.connection ?? null}
            selectedDisplay={selectedConnectionDisplay}
            options={connectionOptions}
            onChange={changeConnection}
            placeholder={`Choose a ${capitalize(definition.provider)} Connection`}
            emptyText={`Configure a ${capitalize(definition.provider)} Connection first.`}
            searchable={connectionOptions.length > 6}
            title={`${definition.label} Connection`}
            disabled={pending}
          />
          <Field
            label="Allowed provider users"
            hint='Comma-separated provider user IDs. Use "*" only when every sender on this Connection may start the Automation.'
          >
            <FormTextInput
              initialValue={(event.allowedUsers ?? ["*"]).join(", ")}
              onChangeText={changeAllowedUsers}
              placeholder="*"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
            />
          </Field>
          <Field
            label="Maximum replies"
            hint="Optional. Leave empty for the event's current unlimited reply action."
            error={replyLimitsValid ? null : "Enter a positive whole number."}
          >
            <FormTextInput
              initialValue={replyLimit}
              onChangeText={changeReplyLimit}
              placeholder="Unlimited"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
            />
          </Field>
        </>
      ) : null}
    </View>
  );
}

function LegacyAutomationEvent({
  event,
  pending,
  setEvents,
}: {
  event: AutomationEventValue;
  pending: boolean;
  setEvents: Dispatch<SetStateAction<AutomationEventValue[]>>;
}) {
  const remove = useCallback(() => {
    setEvents((current) => current.filter(({ name }) => name !== event.name));
  }, [event.name, setEvents]);
  return (
    <View style={styles.legacyEvent}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{eventLabel(event.name)}</Text>
        <Text style={settingsStyles.rowHint}>
          Existing event retained by the structured editor.
        </Text>
      </View>
      <Button size="xs" variant="ghost" disabled={pending} onPress={remove}>
        Remove
      </Button>
    </View>
  );
}

function AutomationInputEditor({
  input,
  index,
  pending,
  setInputs,
}: {
  input: AutomationInputDraft;
  index: number;
  pending: boolean;
  setInputs: Dispatch<SetStateAction<AutomationInputDraft[]>>;
}) {
  const selectedTypeDisplay = useMemo(
    () => ({
      label: INPUT_TYPE_OPTIONS.find(({ value }) => value === input.type)?.label ?? input.type,
    }),
    [input.type],
  );
  const changeName = useCallback(
    (inputName: string) => {
      setInputs((current) =>
        current.map((candidate, candidateIndex) =>
          candidateIndex === index ? Object.assign({}, candidate, { name: inputName }) : candidate,
        ),
      );
    },
    [index, setInputs],
  );
  const changeType = useCallback(
    (type: AutomationInputValue["type"]) => {
      setInputs((current) =>
        current.map((candidate, candidateIndex) =>
          candidateIndex === index ? Object.assign({}, candidate, { type }) : candidate,
        ),
      );
    },
    [index, setInputs],
  );
  const changeRequired = useCallback(
    (required: boolean) => {
      setInputs((current) =>
        current.map((candidate, candidateIndex) =>
          candidateIndex === index ? Object.assign({}, candidate, { required }) : candidate,
        ),
      );
    },
    [index, setInputs],
  );
  const remove = useCallback(() => {
    setInputs((current) => current.filter((_, candidateIndex) => candidateIndex !== index));
  }, [index, setInputs]);

  return (
    <View style={styles.inputRow}>
      <Field label={`Input ${String(index + 1)}`} hint={automationInputHint(input)}>
        <FormTextInput
          initialValue={input.name}
          onChangeText={changeName}
          placeholder="request"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
        />
      </Field>
      <SelectField
        label="Type"
        value={input.type}
        selectedDisplay={selectedTypeDisplay}
        options={INPUT_TYPE_OPTIONS}
        onChange={changeType}
        placeholder="Choose an input type"
        emptyText="No input types are available."
        title="Input type"
        disabled={pending}
      />
      <SwitchRow
        title="Required"
        hint="Reject a run that omits this input."
        value={input.required}
        onValueChange={changeRequired}
        disabled={pending}
        accessibilityLabel={`Require input ${String(index + 1)}`}
      />
      <Button size="xs" variant="ghost" disabled={pending} onPress={remove}>
        Remove input
      </Button>
    </View>
  );
}

function automationInputHint(input: AutomationInputValue): string | undefined {
  const facts: string[] = [];
  if (input.default !== undefined) facts.push(`Default: ${String(input.default)}`);
  if (input.choices !== undefined) facts.push(`Choices: ${input.choices.join(", ")}`);
  return facts.length === 0 ? undefined : facts.join(" · ");
}

function AutomationReview({
  daemon,
  projectId,
  agent,
  maxRuntime,
  idleTimeout,
  events,
  outputs,
}: {
  daemon: string | null;
  projectId: string | null;
  agent: ManagedAgentConfigurationValue;
  maxRuntime: string;
  idleTimeout: string;
  events: readonly AutomationEventValue[];
  outputs: readonly AutomationOutputValue[];
}) {
  const automaticActions = [
    "Finish and record the run",
    ...new Set(
      events.flatMap((event) => {
        const provider = event.name.split(".", 1)[0];
        return ["slack", "discord", "github", "linear"].includes(provider)
          ? [`Reply to the triggering ${capitalize(provider)} conversation`]
          : [];
      }),
    ),
    ...outputs.map(({ type }) => type),
  ];
  return (
    <View style={[settingsStyles.card, styles.form, styles.sectionCard]}>
      <Text style={styles.sectionTitle}>Review</Text>
      <SummaryRow
        title="Target"
        hint={
          daemon && projectId ? `${daemon} · Project ${projectId}` : "Choose a Host and Project"
        }
      />
      <SummaryRow
        title="Agent"
        hint={
          [agent.provider, agent.model, agent.thinkingOptionId, agent.mode]
            .filter(Boolean)
            .join(" · ") || "Choose an Agent configuration"
        }
        border
      />
      <SummaryRow
        title="Runtime ceiling"
        hint={`${maxRuntime || "Not set"} · idle ${idleTimeout || "not set"}`}
        border
      />
      <SummaryRow title="Automatic Hub actions" hint={automaticActions.join("; ")} border />
      {agent.featureValues["fast_mode"] === true ? (
        <Alert
          variant="warning"
          title="Fast mode may increase Provider cost"
          description="Activation still requires the author's Fast-mode authority, and the Daemon checks the fixed Agent configuration again when a run starts."
        />
      ) : null}
      <Text style={settingsStyles.rowHint}>
        Provider file, command, configuration, and Channel tool authority stays bounded by the
        selected Mode and the Daemon approval policy. The Automation cannot broaden it from an input
        or prompt.
      </Text>
    </View>
  );
}

function SwitchRow({
  title,
  hint,
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  title: string;
  hint: string;
  value: boolean;
  onValueChange(value: boolean): void;
  disabled: boolean;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

function SummaryRow({
  title,
  hint,
  border = false,
}: {
  title: string;
  hint: string;
  border?: boolean;
}) {
  return (
    <View style={[settingsStyles.row, border ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
    </View>
  );
}

function QueryFeedback({ pending, error }: { pending: boolean; error: Error | null }) {
  if (pending) return <Text style={settingsStyles.rowHint}>Loading…</Text>;
  return error ? <Alert variant="error" title={error.message} /> : null;
}

function EmptyRow({ message }: { message: string }) {
  return (
    <View style={settingsStyles.row}>
      <Text style={settingsStyles.rowHint}>{message}</Text>
    </View>
  );
}

function parseOptionalObject(
  value: string,
): { valid: true; value?: Record<string, unknown> } | { valid: false; value?: undefined } {
  if (value.trim().length === 0) return { valid: true };
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? { valid: true, value: parsed as Record<string, unknown> }
      : { valid: false };
  } catch {
    return { valid: false };
  }
}

function automationOutputs(
  existing: readonly AutomationOutputValue[],
  events: readonly AutomationEventValue[],
  replyLimits: Readonly<Record<string, string>>,
): AutomationOutputValue[] {
  const providers = new Set(
    events
      .map(({ name }) => name.split(".", 1)[0])
      .filter((provider) => ["slack", "discord", "github", "linear"].includes(provider)),
  );
  const retained = existing
    .filter(({ type }) => !type.endsWith(".reply"))
    .map((output) => Object.assign({}, output));
  for (const provider of providers) {
    const type = `${provider}.reply`;
    const value = replyLimits[type]?.trim() ?? "";
    const previous = existing.find((output) => output.type === type);
    if (value.length === 0) {
      if (previous?.required === true) retained.push({ type, required: true });
      continue;
    }
    retained.push({
      type,
      max: Number(value),
      ...(previous?.required === true ? { required: true } : {}),
    });
  }
  return retained;
}

function commaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function automationEventHint(event: AutomationEventValue): string {
  if (event.connection) return `Connection: ${event.connection}`;
  return event.name === "manual.run" ? "Available to an authorized API caller" : "Configured event";
}

function eventLabel(eventName: string): string {
  return (
    AUTOMATION_EVENTS.find(({ name }) => name === eventName)?.label ??
    (eventName === "channel.message" ? "Channel Route (legacy event)" : eventName)
  );
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function humanize(value: string): string {
  return capitalize(value.replace(/[_-]+/gu, " "));
}

const styles = StyleSheet.create((theme) => ({
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  sectionCard: {
    marginTop: theme.spacing[3],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  choiceGroup: {
    gap: theme.spacing[3],
  },
  inputRow: {
    gap: theme.spacing[3],
    paddingTop: theme.spacing[2],
  },
  legacyEvent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
}));
