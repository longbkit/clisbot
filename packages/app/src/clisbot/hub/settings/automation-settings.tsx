import { AutomationWorkflowEditor } from "./automation-workflow-editor";
import { openAutomationWorkflow } from "../automation-workflow-model";
import { AutomationInputDraftContext, type AutomationChannelDraft } from "./automation-input-draft";
import {
  saveAutomationWithInputs,
  type AutomationInputSaveProgress,
} from "../automation-input-save";
import { parse, stringify } from "yaml";
import {
  useCallback,
  useRef,
  useMemo,
  useState,
  type ComponentType,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { ArrowLeft, ChevronRight } from "lucide-react-native";
import { ScreenTitle } from "@/components/headers/screen-title";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useLatchedBoolean } from "@/hooks/use-latched-boolean";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";
import { createAutomation } from "../automation-management";
import {
  automationRouteBacklinks,
  automationManualParameters,
  automationOutputs,
  initialChannelReplyProviders,
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
import { AutomationActivity } from "./automation-run-details";

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
export interface AutomationSettingsProps {
  ChannelInputs?: ComponentType<{ automationName: string; embedded?: boolean }>;
}

export function AutomationSettings({ ChannelInputs }: AutomationSettingsProps = {}) {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const accountId = hub.signedIn?.account.id ?? null;
  const queryScope = { origin: hub.origin, organizationId, accountId };
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  const automations = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "automations"),
    queryFn: () => hub.api().get("automations", HubAutomationsSchema),
    enabled: organizationId.length > 0 && canManage,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const runnableAutomations = useFetchQuery({
    queryKey: [...hubResourceQueryKey(queryScope, "automations"), "runnable"],
    queryFn: () => hub.api().get("automations/runnable", HubRunnableAutomationsSchema),
    enabled: organizationId.length > 0 && !canManage,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const daemons = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "daemons"),
    queryFn: () => hub.api().get("daemons", HubDaemonsSchema),
    enabled: organizationId.length > 0 && canManage,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const connections = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "connections"),
    queryFn: () => hub.api().get("connections", HubConnectionsSchema),
    enabled: organizationId.length > 0 && canManage,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const channelConfiguration = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "channel-configuration"),
    queryFn: () => hub.api().get("channel-configuration", HubChannelConfigurationSchema),
    enabled: organizationId.length > 0 && canManage,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const effectiveAccess = useFetchQuery({
    queryKey: [...hubResourceQueryKey(queryScope, "access-assignments"), "effective"],
    queryFn: () => hub.api().get("access-assignments/effective", HubEffectiveAccessSchema),
    enabled: organizationId.length > 0 && canManage,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creationProgress = useRef<AutomationInputSaveProgress>({});
  const startCreate = useCallback(() => {
    creationProgress.current = {};
    setCreating(true);
  }, []);
  const cancelCreate = useCallback(() => setCreating(false), []);
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);

  const create = useCallback(
    async (yaml: string, draft?: AutomationChannelDraft | null) => {
      setPending(true);
      setError(null);
      try {
        const created = draft
          ? await saveAutomationWithInputs(hub.api(), yaml, draft, creationProgress.current)
          : await createAutomation(hub.api(), yaml);
        await automations.refetch();
        setCreating(false);
        setSelectedAutomationId(created.id);
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
    (yaml: string, draft?: AutomationChannelDraft | null) => {
      void create(yaml, draft);
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
      {!selectedAutomationId && !creating ? (
        <SettingsSection
          title="Automations"
          trailing={
            <Button size="sm" variant="outline" onPress={startCreate}>
              New Automation
            </Button>
          }
        >
          <QueryFeedback pending={automations.isPending} error={automations.error} />
          {error ? <Alert variant="error" title={error} /> : null}
          <View>
            {automations.data?.automations.length === 0 ? (
              <EmptyRow message="No Automations are configured." />
            ) : (
              automations.data?.automations.map((automation) => (
                <ManagedAutomationRow
                  key={automation.id}
                  automation={automation}
                  open={openAutomation}
                />
              ))
            )}
          </View>
        </SettingsSection>
      ) : null}
      {selectedAutomationId ? (
        <AutomationDetail
          key={selectedAutomationId}
          automation={selectedAutomation}
          ChannelInputs={ChannelInputs}
          daemons={daemons.data?.daemons ?? []}
          connections={connections.data?.connections ?? []}
          backlinks={backlinks}
          canManage={canManage}
          canRun={canRunSelectedAutomation}
          close={closeAutomation}
          saved={refreshAutomation}
        />
      ) : null}
      {canManage && creating ? (
        <View>
          {error ? <Alert variant="error" title={error} /> : null}
          <QueryFeedback
            pending={daemons.isPending || connections.isPending}
            error={daemons.error ?? connections.error}
          />
          <AutomationWorkflowEditor
            creating
            source={buildSingleAgentAutomationYaml({
              name: "",
              events: [],
              daemonId: "",
              cwd: "",
              provider: "",
              instruction: "",
            })}
            ChannelInputs={ChannelInputs}
            daemons={daemons.data?.daemons ?? []}
            connections={connections.data?.connections ?? []}
            pending={pending || daemons.data === undefined || connections.data === undefined}
            cancel={cancelCreate}
            save={createFromYaml}
          />
        </View>
      ) : null}
    </View>
  );
}

function AutomationListRow({
  name,
  description,
  open,
}: {
  name: string;
  description?: string;
  open(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      settingsStyles.row,
      styles.listRow,
      (hovered || pressed) && styles.highlight,
    ],
    [hovered],
  );
  return (
    <View onPointerEnter={enter} onPointerLeave={leave}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}`}
        onPress={open}
        style={rowStyle}
      >
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{name}</Text>
          {description ? <Text style={settingsStyles.rowHint}>{description}</Text> : null}
        </View>
        <ChevronRight style={styles.chevron} />
      </Pressable>
    </View>
  );
}

function AutomationDetailHeading({
  name,
  enabled,
  close,
  disabled = false,
}: {
  name: string;
  enabled?: boolean;
  close(): void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.detailHeading}>
      <Button
        size="sm"
        variant="ghost"
        accessibilityLabel="Back to Automations"
        disabled={disabled}
        onPress={close}
      >
        <ArrowLeft style={styles.chevron} />
      </Button>
      <View style={styles.headingTitle}>
        <ScreenTitle>{name}</ScreenTitle>
      </View>
      {enabled !== undefined ? (
        <StatusBadge
          label={enabled ? "Active" : "Disabled"}
          variant={enabled ? "success" : "muted"}
        />
      ) : null}
    </View>
  );
}

function ManagedAutomationRow({
  automation,
  open,
}: {
  automation: ManagedAutomation;
  open(automationId: string): void;
}) {
  const openAutomation = useCallback(() => open(automation.id), [automation.id, open]);
  const value = parseSingleAgentAutomationYaml(automation.yaml);
  return (
    <AutomationListRow
      name={automation.name}
      description={[automation.enabled ? "Active" : "Disabled", value?.description]
        .filter(Boolean)
        .join(" · ")}
      open={openAutomation}
    />
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
        <AutomationDetailHeading name={selected.name} close={closeAutomation} />
        <SettingsSection title="Workflow">
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
      </View>
    );
  }
  return (
    <SettingsSection title="Automations">
      <QueryFeedback pending={pending} error={error} />
      <View>
        {automations.length === 0 ? (
          <EmptyRow message="No Automations are assigned to you." />
        ) : (
          automations.map((automation) => (
            <RunnableAutomationRow
              key={automation.id}
              automation={automation}
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
  select,
}: {
  automation: HubRunnableAutomation;
  select(automationId: string): void;
}) {
  const open = useCallback(() => select(automation.id), [automation.id, select]);
  return (
    <AutomationListRow
      name={automation.name}
      description={automation.description ?? undefined}
      open={open}
    />
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

type AutomationDetailView = "overview" | "channels" | "configuration" | "runs" | "revisions";
const AUTOMATION_DETAIL_VIEWS: SegmentedControlOption<AutomationDetailView>[] = [
  { value: "overview", label: "Overview" },
  { value: "configuration", label: "Configuration" },
  { value: "runs", label: "Runs" },
  { value: "revisions", label: "Revisions" },
];

// eslint-disable-next-line complexity -- one detail route owns its mutually exclusive view states.
function AutomationDetail({
  ChannelInputs,
  automation,
  daemons,
  connections,
  backlinks,
  canManage,
  canRun,
  close,
  saved,
}: {
  ChannelInputs?: AutomationSettingsProps["ChannelInputs"];
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
  const accountId = hub.signedIn?.account.id ?? null;
  const queryScope = { origin: hub.origin, organizationId, accountId };
  const automationId = automation?.id ?? "";
  const history = useFetchQuery({
    queryKey: [...hubResourceQueryKey(queryScope, "automations"), automationId, "revisions"],
    queryFn: () =>
      hub
        .api()
        .get(
          `automations/${encodeURIComponent(automationId)}/revisions`,
          HubAutomationRevisionsSchema,
        ),
    enabled: automationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const activity = useFetchQuery({
    queryKey: [...hubResourceQueryKey(queryScope, "automations"), automationId, "activity"],
    queryFn: () =>
      hub
        .api()
        .get(
          `automations/${encodeURIComponent(automationId)}/activity`,
          HubAutomationActivitySchema,
        ),
    enabled: automationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const [view, setView] = useState<AutomationDetailView>("overview");
  const configurationVisited = useLatchedBoolean(view === "configuration");
  const [yaml, setYaml] = useState(() => {
    const source = automation?.yaml ?? "";
    if (!source.trimStart().startsWith("{")) return source;
    try {
      return stringify(parse(source), { lineWidth: 0 });
    } catch {
      return source;
    }
  });
  const inputSaveProgress = useRef<AutomationInputSaveProgress>({});
  const [pending, setPending] = useState<"validate" | "save" | null>(null);
  const [result, setResult] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const structuredValue = useMemo(
    () => (automation === null ? null : parseSingleAgentAutomationYaml(automation.yaml)),
    [automation],
  );

  const save = useCallback(
    async (source = yaml, draft?: AutomationChannelDraft | null) => {
      if (automation === null) return;
      setPending("save");
      setResult(null);
      try {
        if (draft) {
          inputSaveProgress.current.automation ??= automation;
          await saveAutomationWithInputs(hub.api(), source, draft, inputSaveProgress.current);
        } else {
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
        }
        setYaml(source);
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
    (source: string, draft?: AutomationChannelDraft | null) => {
      void save(source, draft);
    },
    [save],
  );

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

  const manualParameters = automationManualParameters(automation.yaml);
  const workflowSteps = (() => {
    try {
      const value = parse(automation.yaml);
      return Array.isArray(value?.steps) ? value.steps.length : 1;
    } catch {
      return 0;
    }
  })();
  return (
    <View>
      <AutomationDetailHeading
        name={automation.name}
        enabled={automation.enabled}
        close={close}
        disabled={pending !== null}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.detailTabs}>
        <SegmentedControl
          options={AUTOMATION_DETAIL_VIEWS}
          value={view}
          onValueChange={setView}
          size="sm"
        />
      </ScrollView>
      {view === "configuration" && result ? (
        <Alert variant={result.tone} title={result.message} />
      ) : null}
      {view === "overview" ? (
        <SettingsSection title="Workflow">
          <View style={settingsStyles.card}>
            <SummaryRow
              title="Type"
              hint={`${workflowSteps} ${workflowSteps === 1 ? "step" : "steps"}`}
            />
            {structuredValue?.description ? (
              <SummaryRow title="Description" hint={structuredValue.description} border />
            ) : null}
            {structuredValue ? (
              <>
                <SummaryRow
                  title="Host"
                  hint={
                    daemons.find(
                      ({ id, slug }) =>
                        id === structuredValue.daemonId || slug === structuredValue.daemonId,
                    )?.slug ?? "Unavailable Host"
                  }
                  border
                />
                <SummaryRow title="Working directory" hint={structuredValue.cwd} border />
                <SummaryRow
                  title="Agent"
                  hint={`${structuredValue.provider}${structuredValue.model ? ` · ${structuredValue.model}` : ""}`}
                  border
                />
                <SummaryRow
                  title="Declared outputs"
                  hint={
                    structuredValue.outputs.length === 0
                      ? "No explicit output grants; direct events retain their native reply defaults"
                      : structuredValue.outputs
                          .map((output) => `${output.type} · ${output.max ?? "Unlimited"}`)
                          .join("; ")
                  }
                  border
                />
                <SummaryRow
                  title="Conversation continuity"
                  hint={
                    structuredValue.reuseBinding
                      ? "Continue a compatible Agent in the same conversation"
                      : "Create a new Agent for each run"
                  }
                  border
                />
              </>
            ) : null}
          </View>
        </SettingsSection>
      ) : null}
      {view === "overview" && manualParameters !== null && canRun ? (
        <AutomationRunForm
          automationId={automation.id}
          inputs={manualParameters}
          completed={refreshActivity}
        />
      ) : null}
      {view === "overview" ? (
        <SettingsSection title="Inputs">
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
      ) : null}
      {configurationVisited && canManage ? (
        <View style={view === "configuration" ? undefined : styles.hidden}>
          <AutomationWorkflowEditor
            source={yaml}
            ChannelInputs={ChannelInputs}
            daemons={daemons}
            connections={connections}
            pending={pending !== null}
            save={saveStructured}
          />
        </View>
      ) : null}
      {view === "revisions" ? (
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
      ) : null}
      {view === "runs" ? (
        <AutomationActivity key={automationId} automationId={automationId} activity={activity} />
      ) : null}
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
  channelReplyProvider,
  prioritizeReplies = false,
  initialChannelProviders = [],
  ChannelInputs,
  daemons,
  connections,
  existingNames,
  pending,
  cancel,
  save,
}: {
  title?: string;
  initialValue?: SingleAgentAutomationValue | null;
  channelReplyProvider?: "slack" | "telegram";
  prioritizeReplies?: boolean;
  initialChannelProviders?: readonly string[];
  ChannelInputs?: ComponentType<{ automationName: string; embedded?: boolean }>;
  daemons: {
    id: string;
    slug: string;
    connectionOffer: { serverId: string } | null;
  }[];
  connections: AutomationConnection[];
  existingNames: string[];
  pending: boolean;
  cancel?: () => void;
  save(yaml: string, draft?: AutomationChannelDraft | null): void | Promise<void>;
}) {
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowSource, setWorkflowSource] = useState<string | null>(null);
  const [editingChannelInput, setEditingChannelInput] = useState(false);
  const [channelDraft, setChannelDraft] = useState<AutomationChannelDraft | null>(null);
  const [channelProvider, setChannelProvider] = useState<"slack" | "telegram" | null>(null);
  const [addingSource, setAddingSource] = useState(false);
  const chooseSource = useCallback((source: string) => {
    setAddingSource(false);
    if (source === "slack" || source === "telegram") {
      setChannelProvider(source);
      return;
    }
    setEvents((current) =>
      current.some((event) => event.name === source)
        ? current
        : [
            ...current,
            { name: source, ...(source === "manual.run" ? {} : { allowedUsers: ["*"] }) },
          ],
    );
  }, []);
  const openSources = useCallback(() => setAddingSource(true), []);
  const inputDraftContext = useMemo(
    () =>
      channelProvider
        ? {
            provider: channelProvider,
            draft: channelDraft,
            stage: setChannelDraft,
            setEditing: setEditingChannelInput,
            pending,
          }
        : null,
    [channelProvider, channelDraft, pending],
  );
  const editSlackInputs = useCallback(() => setChannelProvider("slack"), []);
  const editTelegramInputs = useCallback(() => setChannelProvider("telegram"), []);
  const [name, setName] = useState(initialValue?.name ?? "");
  const [description, setDescription] = useState(initialValue?.description ?? "");
  const [enabled, setEnabled] = useState(initialValue?.enabled ?? true);
  const [events, setEvents] = useState<AutomationEventValue[]>(initialValue?.events ?? []);
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
      (
        initialValue?.outputs ??
        (channelReplyProvider === undefined
          ? []
          : [{ type: `${channelReplyProvider}.reply`, max: 1 }])
      )
        .filter(({ type }) => type.endsWith(".reply"))
        .map(({ type, max }) => [type, max === undefined ? "" : String(max)]),
    ),
  );
  const [channelReplyProviders, setChannelReplyProviders] = useState(() =>
    initialChannelReplyProviders(initialValue?.outputs ?? [], channelReplyProvider),
  );
  const normalizedName = normalizeAutomationName(name);
  const draftProviders =
    channelDraft?.accounts
      .filter(
        (account) =>
          Array.isArray(account.routes) &&
          account.routes.some(
            (route: unknown) =>
              typeof route === "object" &&
              route !== null &&
              "workflow" in route &&
              route.workflow === normalizedName,
          ),
      )
      .map((account) => account.channel) ?? [];
  const hasSlackInputs =
    initialChannelProviders.includes("slack") || draftProviders.includes("slack");
  const hasTelegramInputs =
    initialChannelProviders.includes("telegram") || draftProviders.includes("telegram");
  const duplicate = initialValue === null && existingNames.includes(normalizedName);
  const options = parseOptionalObject(providerOptions);
  const parsedOutputSchema = parseOptionalObject(outputSchema);
  const configuredOutputs = automationOutputs(
    initialValue?.outputs ?? [],
    events,
    replyLimits,
    channelReplyProviders,
  );
  const replyLimitsValid = configuredOutputs.every(({ type }) => {
    const value = replyLimits[type]?.trim() ?? "";
    return (
      value.length === 0 || (/^[1-9][0-9]*$/u.test(value) && Number.isSafeInteger(Number(value)))
    );
  });
  const normalizedInputNames = inputs.map(({ name: inputName }) =>
    normalizeAutomationInputName(inputName),
  );
  const inputsValid =
    normalizedInputNames.every((inputName) => inputName.length > 0) &&
    new Set(normalizedInputNames).size === normalizedInputNames.length;
  const eventsValid = events.every((event) => {
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
    !editingChannelInput &&
    (channelDraft === null || enabled) &&
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
    setCwd("");
  }, []);
  const submitAutomation = useCallback(
    (addStep: boolean) => {
      if (daemonId === null || projectId === null || !options.valid || !parsedOutputSchema.valid)
        return;
      const worktree = worktreeTargetFromConfiguration(workspace);
      const source = buildSingleAgentAutomationYaml({
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
      });
      if (addStep) {
        try {
          const workflow = openAutomationWorkflow(source);
          workflow.addStep();
          setWorkflowSource(workflow.getState().yaml);
        } catch (cause) {
          setWorkflowError(cause instanceof Error ? cause.message : "Could not add step");
        }
      } else void save(source, channelDraft);
    },
    [
      channelDraft,
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
    ],
  );

  const activateAutomation = useCallback(() => submitAutomation(false), [submitAutomation]);
  const replyFields = (
    <>
      {channelProvider !== "slack" || prioritizeReplies ? (
        <ChannelReplyOutputFields
          provider="slack"
          enabled={channelReplyProviders.includes("slack")}
          limit={replyLimits["slack.reply"] ?? ""}
          limitsValid={replyLimitsValid}
          pending={pending}
          setProviders={setChannelReplyProviders}
          setLimits={setReplyLimits}
        />
      ) : null}
      {channelProvider !== "telegram" || prioritizeReplies ? (
        <ChannelReplyOutputFields
          provider="telegram"
          enabled={channelReplyProviders.includes("telegram")}
          limit={replyLimits["telegram.reply"] ?? ""}
          limitsValid={replyLimitsValid}
          pending={pending}
          setProviders={setChannelReplyProviders}
          setLimits={setReplyLimits}
        />
      ) : null}
    </>
  );
  if (workflowSource !== null)
    return (
      <AutomationWorkflowEditor
        ChannelInputs={ChannelInputs}
        connections={connections}
        source={workflowSource}
        initialDraft={channelDraft}
        daemons={daemons}
        pending={pending}
        save={(source, draft) => {
          void save(source, draft);
        }}
      />
    );
  return (
    <SettingsSection title={title}>
      {workflowError ? <Alert variant="error" title={workflowError} /> : null}
      {prioritizeReplies ? (
        <View style={[settingsStyles.card, styles.form]}>
          <Text style={styles.sectionTitle}>Channel replies</Text>
          {replyFields}
          <Button size="sm" disabled={pending || !canSave} onPress={activateAutomation}>
            Save reply settings
          </Button>
        </View>
      ) : null}
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
            editable={
              !pending && initialValue === null && channelDraft === null && !editingChannelInput
            }
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
        <Text style={styles.sectionTitle}>Inputs</Text>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || editingChannelInput}
          onPress={openSources}
        >
          Add input
        </Button>
        <View style={styles.actions}>
          {ChannelInputs && hasSlackInputs ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || editingChannelInput}
              onPress={editSlackInputs}
            >
              Edit Slack inputs
            </Button>
          ) : null}
          {ChannelInputs && hasTelegramInputs ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || editingChannelInput}
              onPress={editTelegramInputs}
            >
              Edit Telegram inputs
            </Button>
          ) : null}
        </View>
        {addingSource ? (
          <SelectField
            label="Input source"
            selectedDisplay={null}
            emptyText="No input sources available."
            title="Add input"
            value={null}
            options={[
              ...(ChannelInputs
                ? [
                    { id: "slack", value: "slack", label: "Slack" },
                    { id: "telegram", value: "telegram", label: "Telegram" },
                  ]
                : []),
              ...AUTOMATION_EVENTS.filter((event) => event.name !== "slack.mention").map(
                (event) => ({
                  id: event.name,
                  value: event.name,
                  label: event.provider ? capitalize(event.provider) : "Manual / API",
                }),
              ),
            ]}
            onChange={chooseSource}
            placeholder="Choose an input source"
            disabled={pending}
          />
        ) : null}
        {channelDraft && !enabled ? (
          <Alert
            variant="error"
            title="Enable Active to save Channel inputs. Routes require an active Automation."
          />
        ) : null}
        {channelProvider && ChannelInputs ? (
          <>
            {normalizedName ? (
              <AutomationInputDraftContext.Provider value={inputDraftContext}>
                <ChannelInputs key={channelProvider} automationName={normalizedName} />
              </AutomationInputDraftContext.Provider>
            ) : (
              <Alert variant="info" title="Enter an Automation name to configure Channel inputs." />
            )}
            {!prioritizeReplies ? (
              <ChannelReplyOutputFields
                provider={channelProvider}
                enabled={channelReplyProviders.includes(channelProvider)}
                limit={replyLimits[`${channelProvider}.reply`] ?? ""}
                limitsValid={replyLimitsValid}
                pending={pending}
                setProviders={setChannelReplyProviders}
                setLimits={setReplyLimits}
              />
            ) : null}
          </>
        ) : null}
        {AUTOMATION_EVENTS.filter((definition) =>
          events.some((event) => event.name === definition.name),
        ).map((definition) => (
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
              eventName !== "channel.message" &&
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
          <Alert variant="error" title="Choose a Connection for each selected provider event." />
        ) : null}
      </View>

      <View style={[settingsStyles.card, styles.form, styles.sectionCard]}>
        <Text style={styles.sectionTitle}>Parameters</Text>
        <Text style={settingsStyles.rowHint}>
          Callers may supply only these parameters. Parameters never replace the fixed Host,
          Project, Agent controls, or output actions.
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
          Add parameter
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
          serverId={selectedDaemonServerId}
          value={projectId}
          cwd={cwd}
          onChange={setProjectId}
          onCwdChange={setCwd}
          disabled={pending}
        />
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
        <Text style={settingsStyles.rowHint}>
          Channel replies apply when a Channel Route invokes this Automation. Direct event reply
          settings remain above.
        </Text>
        {!prioritizeReplies ? replyFields : null}

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

      <Button
        size="sm"
        variant="outline"
        disabled={pending || !canSave}
        onPress={() => submitAutomation(true)}
      >
        Add step
      </Button>

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

function ChannelReplyOutputFields({
  provider,
  enabled,
  limit,
  limitsValid,
  pending,
  setProviders,
  setLimits,
}: {
  provider: "slack" | "telegram";
  enabled: boolean;
  limit: string;
  limitsValid: boolean;
  pending: boolean;
  setProviders: Dispatch<SetStateAction<Array<"slack" | "telegram">>>;
  setLimits: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const label = provider === "slack" ? "Slack" : "Telegram";
  const toggle = useCallback(
    (value: boolean) => {
      setProviders((current) =>
        value
          ? [...current.filter((item) => item !== provider), provider]
          : current.filter((item) => item !== provider),
      );
    },
    [provider, setProviders],
  );
  const changeLimit = useCallback(
    (value: string) => setLimits((current) => ({ ...current, [`${provider}.reply`]: value })),
    [provider, setLimits],
  );
  return (
    <>
      <SwitchRow
        title={`Allow ${label} Channel replies`}
        hint={`The Agent may reply to the invoking ${label} conversation. A Route using Channel tools also allows Project files without a separate approval.`}
        value={enabled}
        onValueChange={toggle}
        disabled={pending}
        accessibilityLabel={`Allow ${label} Channel replies`}
      />
      {enabled ? (
        <Field
          label={`Maximum ${label} replies`}
          hint="Leave empty for unlimited replies within the Route's existing policy."
          error={limitsValid ? null : "Enter a positive whole number."}
        >
          <FormTextInput
            initialValue={limit}
            onChangeText={changeLimit}
            placeholder="Unlimited"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />
        </Field>
      ) : null}
    </>
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
  const removeEvent = useCallback(
    () => setEvents((current) => current.filter(({ name }) => name !== definition.name)),
    [definition.name, setEvents],
  );
  const changeRepository = useCallback(
    (repository: string) => updateEvent(definition.name, { repository }),
    [definition.name, updateEvent],
  );
  const changeContains = useCallback(
    (contains: string) => updateEvent(definition.name, { contains }),
    [definition.name, updateEvent],
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
      <View style={styles.actions}>
        <Text style={settingsStyles.rowTitle}>{definition.label}</Text>
        <Button size="xs" variant="ghost" onPress={removeEvent} disabled={pending}>
          Remove {definition.label}
        </Button>
      </View>
      <Text style={settingsStyles.rowHint}>{definition.description}</Text>
      {definition.name === "slack.mention" ? (
        <Text style={settingsStyles.rowHint}>
          Existing direct event. New Slack inputs use Channel Routes.
        </Text>
      ) : null}
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
          {definition.provider === "github" ? (
            <>
              <Field
                label="Repository"
                hint="Optional owner/repository filter. Leave empty for repositories available to this Connection."
              >
                <FormTextInput
                  initialValue={event.repository ?? ""}
                  onChangeText={changeRepository}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!pending}
                  placeholder="org/repo"
                />
              </Field>
              <Field
                label="Comment contains"
                hint="Optional text required in the comment, for example @bot review."
              >
                <FormTextInput
                  initialValue={event.contains ?? ""}
                  onChangeText={changeContains}
                  editable={!pending}
                />
              </Field>
              <Text style={settingsStyles.rowHint}>
                Replies are posted to the issue or pull request that supplied the comment.
              </Text>
            </>
          ) : null}
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
    <View style={styles.eventFields}>
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
        Native file and command tools follow the selected Mode and Daemon approval policy. Channel
        tool replies are separately preapproved for the invoking conversation, including files
        within the selected Project when the Hub can access that folder. Callers cannot change these
        fixed targets or grants through an input or prompt.
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
    (eventName === "channel.message" ? "Channel Routes" : eventName)
  );
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function humanize(value: string): string {
  return capitalize(value.replace(/[_-]+/gu, " "));
}

const styles = StyleSheet.create((theme) => ({
  hidden: { display: "none" },
  listRow: { minHeight: theme.spacing[12], borderRadius: theme.borderRadius.lg },
  highlight: { backgroundColor: theme.colors.interactionHighlight },
  chevron: {
    width: theme.iconSize.sm,
    height: theme.iconSize.sm,
    color: theme.colors.foregroundMuted,
  },
  detailHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[4],
  },
  headingTitle: { flex: 1 },
  detailTabs: { marginBottom: theme.spacing[6] },
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
  eventFields: {
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
