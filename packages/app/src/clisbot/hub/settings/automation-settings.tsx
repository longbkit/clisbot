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
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { ScreenTitle } from "@/components/headers/screen-title";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { useLatchedBoolean } from "@/hooks/use-latched-boolean";
import { useFetchQuery } from "@/data/query";
import { i18n } from "@/i18n/i18next";
import { SettingsSection } from "@/components/settings/headings/settings-section";
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
  HubChannelConfigurationSchema,
  HubConnectionsSchema,
  HubDaemonsSchema,
  HubEffectiveAccessSchema,
  type HubAutomationRunResult,
} from "../contracts";
import {
  automationViewerAccess,
  HubScopedAutomationsSchema,
  type HubScopedAutomation,
} from "./automation-access";
import { AutomationAccessSection } from "./automation-access-section";
import { AutomationList } from "./automation-list";
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
import { AutomationActivity } from "./automation-run-details";
import { BackLink } from "./back-link";
import { ViewTabs, type ViewTab } from "./view-tabs";
import { HubEmptyState } from "./empty-state";
import { Plus, Workflow } from "lucide-react-native";

export interface AutomationConnection {
  id: string;
  provider: string;
  name: string;
  externalName: string | null;
  status: string;
}

type ManagedAutomation = HubScopedAutomation;
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

/** The direct events the structured editor offers, worded in the current language. */
function automationEvents(): readonly AutomationEventDefinition[] {
  return [
    {
      name: "manual.run",
      label: i18n.t("hub.automations.events.manualRun.label"),
      description: i18n.t("hub.automations.events.manualRun.description"),
    },
    {
      name: "slack.mention",
      label: i18n.t("hub.automations.events.slackMention.label"),
      provider: "slack",
      description: i18n.t("hub.automations.events.slackMention.description"),
    },
    {
      name: "discord.mention",
      label: i18n.t("hub.automations.events.discordMention.label"),
      provider: "discord",
      description: i18n.t("hub.automations.events.discordMention.description"),
    },
    {
      name: "github.issue_comment",
      label: i18n.t("hub.automations.events.githubIssueComment.label"),
      provider: "github",
      description: i18n.t("hub.automations.events.githubIssueComment.description"),
    },
    {
      name: "linear.issue_created",
      label: i18n.t("hub.automations.events.linearIssueCreated.label"),
      provider: "linear",
      description: i18n.t("hub.automations.events.linearIssueCreated.description"),
    },
  ];
}

export interface AutomationSettingsProps {
  initialCreate?: boolean;
  ChannelInputs?: ComponentType<{ automationName: string; embedded?: boolean }>;
}

// eslint-disable-next-line complexity -- one settings coordinator owns the query/load/detail states.
export function AutomationSettings({
  ChannelInputs,
  initialCreate = false,
}: AutomationSettingsProps = {}) {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const accountId = hub.signedIn?.account.id ?? null;
  const queryScope = { origin: hub.origin, organizationId, accountId };
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  // The Hub scopes the list itself: Organization Admins get every Automation,
  // a Member the ones they hold Admin or Run on.
  const automations = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "automations"),
    queryFn: () => hub.api().get("automations", HubScopedAutomationsSchema),
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const daemons = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "daemons"),
    queryFn: () => hub.api().get("daemons", HubDaemonsSchema),
    enabled: organizationId.length > 0,
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
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(initialCreate);
  const creationProgress = useRef<AutomationInputSaveProgress>({});
  const startCreate = useCallback(() => {
    creationProgress.current = {};
    setCreating(true);
  }, []);
  const cancelCreate = useCallback(() => setCreating(false), []);
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<AutomationDetailView>("overview");

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
        setError(cause instanceof Error ? cause.message : t("hub.automations.hubRequestFailed"));
      } finally {
        setPending(false);
      }
    },
    [automations, hub, t],
  );
  const openAutomation = useCallback((automationId: string) => {
    setDetailView("overview");
    setSelectedAutomationId(automationId);
  }, []);
  const reviewAutomation = useCallback((automationId: string) => {
    setDetailView("configuration");
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
  const viewer = automationViewerAccess({
    canManage,
    selected: selectedAutomation,
    access: effectiveAccess.data,
    daemons: daemons.data?.daemons ?? [],
  });
  // COMPAT(automation-scope): an older Hub sends no `scope`; fall back to the viewer's own grants.
  const canRunSelectedAutomation =
    viewer.canRun || canRunAutomation(selectedAutomation, effectiveAccess.data);
  const newAutomationButton = useMemo(
    () =>
      viewer.canCreate ? (
        <Button size="sm" variant="outline" leftIcon={Plus} onPress={startCreate}>
          {t("hub.automations.newAutomation")}
        </Button>
      ) : undefined,
    [startCreate, t, viewer.canCreate],
  );

  return (
    <View>
      {!selectedAutomationId && !creating ? (
        <SettingsSection
          title={t("hub.automations.title")}
          info={t("hub.automations.info")}
          // Empty, the button is the empty state's own action, so it is not shown twice.
          trailing={automations.data?.automations.length === 0 ? undefined : newAutomationButton}
        >
          <QueryFeedback pending={automations.isPending} error={automations.error} />
          {error ? <Alert variant="error" title={error} /> : null}
          {automations.data?.automations.length === 0 ? (
            <HubEmptyState
              icon={Workflow}
              title={
                viewer.canCreate
                  ? t("hub.automations.empty.title")
                  : t("hub.automations.empty.sharedTitle")
              }
              description={t("hub.automations.info")}
              action={newAutomationButton}
            />
          ) : (
            <AutomationList
              automations={automations.data?.automations ?? []}
              viewerUserId={accountId}
              canManage={canManage}
              open={openAutomation}
              review={reviewAutomation}
            />
          )}
        </SettingsSection>
      ) : null}
      {selectedAutomationId ? (
        <AutomationDetail
          key={selectedAutomationId}
          automation={selectedAutomation}
          ChannelInputs={ChannelInputs}
          daemons={viewer.visibleDaemons}
          connections={connections.data?.connections ?? []}
          backlinks={backlinks}
          canManage={viewer.canEdit}
          allowConnectionInputs={canManage}
          canRun={canRunSelectedAutomation}
          initialView={detailView}
          close={closeAutomation}
          saved={refreshAutomation}
        />
      ) : null}
      {viewer.canCreate && creating ? (
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
            daemons={viewer.visibleDaemons}
            connections={connections.data?.connections ?? []}
            allowConnectionInputs={canManage}
            pending={
              pending || daemons.data === undefined || (canManage && connections.data === undefined)
            }
            cancel={cancelCreate}
            save={createFromYaml}
          />
        </View>
      ) : null}
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
  const { t } = useTranslation();
  return (
    <>
      <BackLink to={t("hub.automations.title")} onPress={close} disabled={disabled} />
      <View style={styles.detailHeading}>
        <View style={styles.headingTitle}>
          <ScreenTitle>{name}</ScreenTitle>
        </View>
        {enabled !== undefined ? (
          <StatusBadge
            label={
              enabled ? t("hub.automations.state.active") : t("hub.automations.state.disabled")
            }
            variant={enabled ? "success" : "muted"}
          />
        ) : null}
      </View>
    </>
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

type AutomationDetailView = "overview" | "channels" | "configuration" | "runs" | "revisions";
function automationDetailViews(): ViewTab<AutomationDetailView>[] {
  return [
    { value: "overview", label: i18n.t("hub.automations.detail.tabs.overview") },
    { value: "configuration", label: i18n.t("hub.automations.detail.tabs.configuration") },
    { value: "runs", label: i18n.t("hub.automations.detail.tabs.runs") },
    { value: "revisions", label: i18n.t("hub.automations.detail.tabs.revisions") },
  ];
}

// eslint-disable-next-line complexity -- one detail route owns its mutually exclusive view states.
function AutomationDetail({
  ChannelInputs,
  automation,
  daemons,
  connections,
  backlinks,
  canManage,
  allowConnectionInputs,
  canRun,
  initialView,
  close,
  saved,
}: {
  ChannelInputs?: AutomationSettingsProps["ChannelInputs"];
  automation: ManagedAutomation | null;
  daemons: {
    id: string;
    slug: string;
    connectionOffer: { serverId: string } | null;
  }[];
  connections: AutomationConnection[];
  backlinks: readonly AutomationRouteBacklink[];
  /** Admin of this Automation (or an Organization Admin): may edit, enable, and grant. */
  canManage: boolean;
  allowConnectionInputs: boolean;
  canRun: boolean;
  initialView: AutomationDetailView;
  close(): void;
  saved(): Promise<unknown>;
}) {
  const { t } = useTranslation();
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
    enabled: automationId.length > 0 && canManage,
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
  const [view, setView] = useState<AutomationDetailView>(initialView);
  const detailViews = canManage
    ? automationDetailViews()
    : automationDetailViews().filter(({ value }) => value === "overview" || value === "runs");
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
        setResult({ tone: "success", message: t("hub.automations.detail.activated") });
      } catch (cause) {
        setResult({
          tone: "error",
          message: cause instanceof Error ? cause.message : t("hub.automations.detail.saveFailed"),
        });
      } finally {
        setPending(null);
      }
    },
    [activity, automation, history, hub, saved, t, yaml],
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
      <SettingsSection title={t("hub.automations.detail.automation")}>
        <Alert variant="error" title={t("hub.automations.detail.unavailable")} />
        <Button size="sm" variant="outline" onPress={close}>
          {t("common.actions.close")}
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
      <View style={styles.detailTabs}>
        <ViewTabs tabs={detailViews} value={view} onChange={setView} />
      </View>
      {typeof automation.pausedReason === "string" ? (
        <Alert
          variant="warning"
          title={t("hub.automations.pausedReason", { reason: automation.pausedReason })}
        >
          {canManage
            ? t("hub.automations.detail.pausedReviewAdmin")
            : t("hub.automations.detail.pausedReviewMember")}
        </Alert>
      ) : null}
      {view === "configuration" && result ? (
        <Alert variant={result.tone} title={result.message} />
      ) : null}
      {view === "overview" ? (
        <SettingsSection title={t("hub.automations.detail.workflow")}>
          <View style={settingsStyles.card}>
            <SummaryRow
              title={t("hub.automations.detail.type")}
              hint={t("hub.automations.detail.steps", { count: workflowSteps })}
            />
            {structuredValue?.description ? (
              <SummaryRow
                title={t("hub.automations.detail.description")}
                hint={structuredValue.description}
                border
              />
            ) : null}
            {structuredValue ? (
              <>
                <SummaryRow
                  title={t("hub.automations.detail.host")}
                  hint={
                    daemons.find(
                      ({ id, slug }) =>
                        id === structuredValue.daemonId || slug === structuredValue.daemonId,
                    )?.slug ?? t("hub.automations.detail.unavailableHost")
                  }
                  border
                />
                <SummaryRow
                  title={t("hub.automations.detail.workingDirectory")}
                  hint={structuredValue.cwd}
                  border
                />
                <SummaryRow
                  title={t("hub.automations.detail.agent")}
                  hint={`${structuredValue.provider}${structuredValue.model ? ` · ${structuredValue.model}` : ""}`}
                  border
                />
                <SummaryRow
                  title={t("hub.automations.detail.declaredOutputs")}
                  hint={
                    structuredValue.outputs.length === 0
                      ? t("hub.automations.detail.noExplicitOutputs")
                      : structuredValue.outputs
                          .map(
                            (output) =>
                              `${output.type} · ${output.max ?? t("hub.automations.unlimited")}`,
                          )
                          .join("; ")
                  }
                  border
                />
                <SummaryRow
                  title={t("hub.automations.detail.continuity")}
                  hint={
                    structuredValue.reuseBinding
                      ? t("hub.automations.detail.continueAgent")
                      : t("hub.automations.detail.newAgentEachRun")
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
        <SettingsSection title={t("hub.automations.detail.inputs")}>
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
                hint={t("hub.automations.detail.routeNumber", {
                  number: backlink.routePosition + 1,
                })}
                border={(structuredValue?.events.length ?? 0) + index > 0}
              />
            ))}
            {(structuredValue?.events.length ?? 0) === 0 && backlinks.length === 0 ? (
              <EmptyRow message={t("hub.automations.detail.seeAdvancedYaml")} />
            ) : null}
          </View>
        </SettingsSection>
      ) : null}
      {view === "overview" && canManage ? (
        <AutomationAccessSection automation={automation} />
      ) : null}
      {configurationVisited && canManage ? (
        <View style={view === "configuration" ? undefined : styles.hidden}>
          <AutomationWorkflowEditor
            source={yaml}
            ChannelInputs={ChannelInputs}
            daemons={daemons}
            connections={connections}
            allowConnectionInputs={allowConnectionInputs}
            pending={pending !== null}
            save={saveStructured}
          />
        </View>
      ) : null}
      {view === "revisions" ? (
        <SettingsSection title={t("hub.automations.detail.revisionHistory")}>
          <View style={settingsStyles.card}>
            {history.data?.revisions.map((revision, index) => (
              <View
                key={revision.id}
                style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
              >
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>
                    {revision.id === automation.activeRevisionId
                      ? t("hub.automations.detail.revisionActive", { version: revision.version })
                      : t("hub.automations.detail.revision", { version: revision.version })}
                  </Text>
                  <Text style={settingsStyles.rowHint}>
                    {new Date(revision.createdAt).toLocaleString()}
                  </Text>
                </View>
              </View>
            )) ?? <EmptyRow message={t("hub.automations.detail.loadingRevisions")} />}
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
  const { t } = useTranslation();
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
          message: t(`hub.automations.run.dispatched.${response.workflowStatus}`),
        });
        await completed();
      } else {
        setResult({ tone: "error", message: automationRunResultMessage(response) });
      }
    } catch (cause) {
      setResult({
        tone: "error",
        message: cause instanceof Error ? cause.message : t("hub.automations.run.failed"),
      });
    } finally {
      setPending(false);
    }
  }, [automationId, completed, hub, parsed, prompt, t]);
  const runAutomation = useCallback(() => {
    void run();
  }, [run]);

  return (
    <SettingsSection title={t("hub.automations.run.title")}>
      <Alert
        variant="info"
        title={t("hub.automations.run.infoTitle")}
        description={t("hub.automations.run.infoDescription")}
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
        <Field label={t("hub.automations.run.prompt")} hint={t("hub.automations.run.promptHint")}>
          <FormTextInput initialValue="" onChangeText={setPrompt} multiline editable={!pending} />
        </Field>
        {!parsed.ok ? <Alert variant="error" title={parsed.message} /> : null}
        {result ? <Alert variant={result.tone} title={result.message} /> : null}
        <View style={styles.actions}>
          <Button size="sm" disabled={pending || !parsed.ok} onPress={runAutomation}>
            {pending ? t("hub.automations.run.starting") : t("hub.automations.run.submit")}
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
        return {
          ok: false,
          message: i18n.t("hub.automations.run.required", { name: humanize(definition.name) }),
        };
      }
      continue;
    }
    let value: string | number | boolean = raw;
    if (definition.type === "number") {
      value = Number(raw);
      if (!Number.isFinite(value)) {
        return {
          ok: false,
          message: i18n.t("hub.automations.run.mustBeNumber", { name: humanize(definition.name) }),
        };
      }
    } else if (definition.type === "boolean") {
      if (raw !== "true" && raw !== "false") {
        return {
          ok: false,
          message: i18n.t("hub.automations.run.mustBeBoolean", { name: humanize(definition.name) }),
        };
      }
      value = raw === "true";
    }
    if (
      definition.choices !== undefined &&
      !definition.choices.some((choice) => Object.is(choice, value))
    ) {
      return {
        ok: false,
        message: i18n.t("hub.automations.run.mustBeChoice", { name: humanize(definition.name) }),
      };
    }
    inputs[definition.name] = value;
  }
  return { ok: true, inputs };
}

function runInputHint(input: AutomationInputValue): string {
  const choices = input.choices?.map(String).join(", ");
  const options = { type: input.type, choices };
  if (choices) {
    return input.required
      ? i18n.t("hub.automations.run.hint.requiredChoices", options)
      : i18n.t("hub.automations.run.hint.optionalChoices", options);
  }
  return input.required
    ? i18n.t("hub.automations.run.hint.required", options)
    : i18n.t("hub.automations.run.hint.optional", options);
}

function automationRunResultMessage(
  result: Exclude<HubAutomationRunResult, { status: "dispatched" }>,
): string {
  switch (result.status) {
    case "invalid_input":
      return result.issues[0]?.message ?? i18n.t("hub.automations.run.errors.invalidInput");
    case "actor_forbidden":
      return i18n.t("hub.automations.run.errors.actorForbidden");
    case "daemon_offline":
      return i18n.t("hub.automations.run.errors.daemonOffline");
    case "expected_configuration_not_current":
      return i18n.t("hub.automations.run.errors.notCurrent");
    case "configuration_not_found":
    case "trigger_not_found":
      return i18n.t("hub.automations.run.errors.cannotAcceptManualRun");
    case "dispatch_conflict":
      return i18n.t("hub.automations.run.errors.dispatchConflict");
    case "infrastructure_unavailable":
      return i18n.t("hub.automations.run.errors.runtimeUnavailable");
  }
}

// eslint-disable-next-line complexity -- this stateful editor keeps one Automation draft coherent.
export function SingleAgentAutomationForm({
  title,
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
  const { t } = useTranslation();
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
  const workspaceField = useMemo(() => ({ value: workspace, onChange: setWorkspace }), [workspace]);
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
    const definition = automationEvents().find(({ name: eventName }) => eventName === event.name);
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
          setWorkflowError(
            cause instanceof Error ? cause.message : t("hub.automations.form.couldNotAddStep"),
          );
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
      t,
      workspace,
    ],
  );

  const activateAutomation = useCallback(() => submitAutomation(false), [submitAutomation]);
  const addStep = useCallback(() => submitAutomation(true), [submitAutomation]);
  const saveWorkflow = useCallback(
    (...args: Parameters<typeof save>) => {
      void save(...args);
    },
    [save],
  );
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
        save={saveWorkflow}
      />
    );
  return (
    <SettingsSection title={title ?? t("hub.automations.createAutomation")}>
      {workflowError ? <Alert variant="error" title={workflowError} /> : null}
      {prioritizeReplies ? (
        <View style={[settingsStyles.card, styles.form]}>
          <Text style={styles.sectionTitle}>{t("hub.automations.form.channelReplies")}</Text>
          {replyFields}
          <Button size="sm" disabled={pending || !canSave} onPress={activateAutomation}>
            {t("hub.automations.form.saveReplySettings")}
          </Button>
        </View>
      ) : null}
      <View style={[settingsStyles.card, styles.form]}>
        <Field
          label={t("hub.automations.form.name")}
          hint={
            normalizedName && normalizedName !== name.trim()
              ? t("hub.automations.form.savedAs", { name: normalizedName })
              : undefined
          }
          error={duplicate ? t("hub.automations.form.duplicate") : null}
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
        <Field
          label={t("hub.automations.form.description")}
          hint={t("hub.automations.form.descriptionHint")}
        >
          <FormTextInput
            initialValue={initialValue?.description ?? ""}
            onChangeText={setDescription}
            placeholder={t("hub.automations.form.descriptionPlaceholder")}
            multiline
            editable={!pending}
          />
        </Field>
        <SwitchRow
          title={t("hub.automations.form.active")}
          hint={t("hub.automations.form.activeHint")}
          value={enabled}
          onValueChange={setEnabled}
          disabled={pending}
          accessibilityLabel={t("hub.automations.form.activeLabel")}
        />
      </View>

      <View style={[settingsStyles.card, styles.form, styles.sectionCard]}>
        <Text style={styles.sectionTitle}>{t("hub.automations.form.inputs")}</Text>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || editingChannelInput}
          onPress={openSources}
        >
          {t("hub.automations.form.addInput")}
        </Button>
        <View style={styles.actions}>
          {ChannelInputs && hasSlackInputs ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || editingChannelInput}
              onPress={editSlackInputs}
            >
              {t("hub.automations.form.editSlackInputs")}
            </Button>
          ) : null}
          {ChannelInputs && hasTelegramInputs ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || editingChannelInput}
              onPress={editTelegramInputs}
            >
              {t("hub.automations.form.editTelegramInputs")}
            </Button>
          ) : null}
        </View>
        {addingSource ? (
          <SelectField
            label={t("hub.automations.form.inputSource")}
            selectedDisplay={null}
            emptyText={t("hub.automations.form.noInputSources")}
            title={t("hub.automations.form.addInput")}
            value={null}
            options={[
              ...(ChannelInputs
                ? [
                    { id: "slack", value: "slack", label: "Slack" },
                    { id: "telegram", value: "telegram", label: "Telegram" },
                  ]
                : []),
              ...automationEvents()
                .filter((event) => event.name !== "slack.mention")
                .map((event) => ({
                  id: event.name,
                  value: event.name,
                  label: event.provider
                    ? capitalize(event.provider)
                    : t("hub.automations.events.manualApi"),
                })),
            ]}
            onChange={chooseSource}
            placeholder={t("hub.automations.form.chooseInputSource")}
            disabled={pending}
          />
        ) : null}
        {channelDraft && !enabled ? (
          <Alert variant="error" title={t("hub.automations.form.enableActiveForChannel")} />
        ) : null}
        {channelProvider && ChannelInputs ? (
          <>
            {normalizedName ? (
              <AutomationInputDraftContext.Provider value={inputDraftContext}>
                <ChannelInputs key={channelProvider} automationName={normalizedName} />
              </AutomationInputDraftContext.Provider>
            ) : (
              <Alert variant="info" title={t("hub.automations.form.enterNameForChannel")} />
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
        {automationEvents()
          .filter((definition) => events.some((event) => event.name === definition.name))
          .map((definition) => (
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
              !automationEvents().some(({ name: definitionName }) => definitionName === eventName),
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
          <Alert variant="error" title={t("hub.automations.form.chooseConnectionForEvents")} />
        ) : null}
      </View>

      <View style={[settingsStyles.card, styles.form, styles.sectionCard]}>
        <Text style={styles.sectionTitle}>{t("hub.automations.form.parameters")}</Text>
        <Text style={settingsStyles.rowHint}>{t("hub.automations.form.parametersHint")}</Text>
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
          <Alert variant="error" title={t("hub.automations.form.uniqueInputNames")} />
        ) : null}
        <Button size="xs" variant="outline" disabled={pending || !inputsValid} onPress={addInput}>
          {t("hub.automations.form.addParameter")}
        </Button>
      </View>

      <View style={[settingsStyles.card, styles.form, styles.sectionCard]}>
        <Text style={styles.sectionTitle}>{t("hub.automations.form.targetAndAgent")}</Text>
        <SelectField
          label={t("hub.automations.form.host")}
          value={daemonId}
          selectedDisplay={selectedDaemonDisplay}
          options={daemonOptions}
          onChange={changeDaemon}
          placeholder={t("hub.automations.form.chooseHost")}
          emptyText={t("hub.automations.form.enrollDaemon")}
          searchable={daemonOptions.length > 6}
          title={t("hub.automations.form.host")}
          disabled={pending}
        />
        <DaemonProjectField
          daemonId={daemonId}
          serverId={selectedDaemonServerId}
          value={projectId}
          cwd={cwd}
          onChange={setProjectId}
          onCwdChange={setCwd}
          workspace={workspaceField}
          disabled={pending}
        />
        <ManagedAgentConfigurationFields
          serverId={selectedDaemonServerId}
          cwd={cwd}
          value={agentConfiguration}
          onChange={setAgentConfiguration}
          disabled={pending}
        />
        <SwitchRow
          title={t("hub.automations.form.continueAgent")}
          hint={t("hub.automations.form.continueAgentHint")}
          value={reuseBinding}
          onValueChange={setReuseBinding}
          disabled={pending}
          accessibilityLabel={t("hub.automations.form.continueAgentLabel")}
        />
        <Field
          label={t("hub.automations.form.providerOptions")}
          hint={t("hub.automations.form.providerOptionsHint")}
          error={options.valid ? null : t("hub.automations.form.enterJsonObject")}
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
          label={t("hub.automations.form.instruction")}
          hint={t("hub.automations.form.instructionHint")}
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
        <Text style={styles.sectionTitle}>{t("hub.automations.form.limitsAndOutputs")}</Text>
        <Text style={settingsStyles.rowHint}>{t("hub.automations.form.limitsHint")}</Text>
        {!prioritizeReplies ? replyFields : null}

        <Field
          label={t("hub.automations.form.maxRuntime")}
          hint={t("hub.automations.form.maxRuntimeHint")}
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
        <Field
          label={t("hub.automations.form.idleTimeout")}
          hint={t("hub.automations.form.idleTimeoutHint")}
        >
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
          title={t("hub.automations.form.archive")}
          hint={t("hub.automations.form.archiveHint")}
          value={autoArchive}
          onValueChange={setAutoArchive}
          disabled={pending}
          accessibilityLabel={t("hub.automations.form.archiveLabel")}
        />
        <Field
          label={t("hub.automations.form.resultSchema")}
          hint={t("hub.automations.form.resultSchemaHint")}
          error={parsedOutputSchema.valid ? null : t("hub.automations.form.enterJsonObject")}
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

      <Button size="sm" variant="outline" disabled={pending || !canSave} onPress={addStep}>
        {t("hub.automations.form.addStep")}
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
          {initialValue === null
            ? t("hub.automations.createAutomation")
            : t("hub.automations.form.activateChanges")}
        </Button>
        {cancel ? (
          <Button variant="ghost" disabled={pending} onPress={cancel}>
            {t("common.actions.cancel")}
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
  const { t } = useTranslation();
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
        title={t("hub.automations.replies.allow", { channel: label })}
        hint={t("hub.automations.replies.allowHint", { channel: label })}
        value={enabled}
        onValueChange={toggle}
        disabled={pending}
        accessibilityLabel={t("hub.automations.replies.allow", { channel: label })}
      />
      {enabled ? (
        <Field
          label={t("hub.automations.replies.max", { channel: label })}
          hint={t("hub.automations.replies.maxHint")}
          error={limitsValid ? null : t("hub.automations.replies.positiveWholeNumber")}
        >
          <FormTextInput
            initialValue={limit}
            onChangeText={changeLimit}
            placeholder={t("hub.automations.unlimited")}
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
  const { t } = useTranslation();
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
          {t("hub.automations.eventEditor.remove", { label: definition.label })}
        </Button>
      </View>
      <Text style={settingsStyles.rowHint}>{definition.description}</Text>
      {definition.name === "slack.mention" ? (
        <Text style={settingsStyles.rowHint}>{t("hub.automations.eventEditor.legacySlack")}</Text>
      ) : null}
      {event !== undefined && definition.provider !== undefined ? (
        <>
          <SelectField
            label={t("hub.automations.eventEditor.connection")}
            value={event.connection ?? null}
            selectedDisplay={selectedConnectionDisplay}
            options={connectionOptions}
            onChange={changeConnection}
            placeholder={t("hub.automations.eventEditor.chooseConnection", {
              provider: capitalize(definition.provider),
            })}
            emptyText={t("hub.automations.eventEditor.configureConnection", {
              provider: capitalize(definition.provider),
            })}
            searchable={connectionOptions.length > 6}
            title={t("hub.automations.eventEditor.connectionTitle", { label: definition.label })}
            disabled={pending}
          />
          {definition.provider === "github" ? (
            <>
              <Field
                label={t("hub.automations.eventEditor.repository")}
                hint={t("hub.automations.eventEditor.repositoryHint")}
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
                label={t("hub.automations.eventEditor.commentContains")}
                hint={t("hub.automations.eventEditor.commentContainsHint")}
              >
                <FormTextInput
                  initialValue={event.contains ?? ""}
                  onChangeText={changeContains}
                  editable={!pending}
                />
              </Field>
              <Text style={settingsStyles.rowHint}>
                {t("hub.automations.eventEditor.repliesPosted")}
              </Text>
            </>
          ) : null}
          <Field
            label={t("hub.automations.eventEditor.allowedUsers")}
            hint={t("hub.automations.eventEditor.allowedUsersHint")}
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
            label={t("hub.automations.eventEditor.maxReplies")}
            hint={t("hub.automations.eventEditor.maxRepliesHint")}
            error={replyLimitsValid ? null : t("hub.automations.replies.positiveWholeNumber")}
          >
            <FormTextInput
              initialValue={replyLimit}
              onChangeText={changeReplyLimit}
              placeholder={t("hub.automations.unlimited")}
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
  const { t } = useTranslation();
  const remove = useCallback(() => {
    setEvents((current) => current.filter(({ name }) => name !== event.name));
  }, [event.name, setEvents]);
  return (
    <View style={styles.eventFields}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{eventLabel(event.name)}</Text>
        <Text style={settingsStyles.rowHint}>{t("hub.automations.eventEditor.legacyHint")}</Text>
      </View>
      <Button size="xs" variant="ghost" disabled={pending} onPress={remove}>
        {t("hub.automations.eventEditor.removeEvent")}
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
  const { t } = useTranslation();
  const typeOptions = useMemo<SelectFieldOption<AutomationInputValue["type"]>[]>(
    () => [
      { id: "string", value: "string", label: t("hub.automations.inputEditor.types.string") },
      { id: "number", value: "number", label: t("hub.automations.inputEditor.types.number") },
      { id: "boolean", value: "boolean", label: t("hub.automations.inputEditor.types.boolean") },
    ],
    [t],
  );
  const selectedTypeDisplay = useMemo(
    () => ({
      label: typeOptions.find(({ value }) => value === input.type)?.label ?? input.type,
    }),
    [input.type, typeOptions],
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
      <Field
        label={t("hub.automations.inputEditor.label", { number: index + 1 })}
        hint={automationInputHint(input)}
      >
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
        label={t("hub.automations.inputEditor.type")}
        value={input.type}
        selectedDisplay={selectedTypeDisplay}
        options={typeOptions}
        onChange={changeType}
        placeholder={t("hub.automations.inputEditor.chooseType")}
        emptyText={t("hub.automations.inputEditor.noTypes")}
        title={t("hub.automations.inputEditor.typeTitle")}
        disabled={pending}
      />
      <SwitchRow
        title={t("hub.automations.inputEditor.required")}
        hint={t("hub.automations.inputEditor.requiredHint")}
        value={input.required}
        onValueChange={changeRequired}
        disabled={pending}
        accessibilityLabel={t("hub.automations.inputEditor.requireLabel", { number: index + 1 })}
      />
      <Button size="xs" variant="ghost" disabled={pending} onPress={remove}>
        {t("hub.automations.inputEditor.remove")}
      </Button>
    </View>
  );
}

function automationInputHint(input: AutomationInputValue): string | undefined {
  const facts: string[] = [];
  if (input.default !== undefined) {
    facts.push(i18n.t("hub.automations.inputEditor.default", { value: String(input.default) }));
  }
  if (input.choices !== undefined) {
    facts.push(
      i18n.t("hub.automations.inputEditor.choices", { choices: input.choices.join(", ") }),
    );
  }
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
  const { t } = useTranslation();
  const automaticActions = [
    t("hub.automations.review.finishAndRecord"),
    ...new Set(
      events.flatMap((event) => {
        const provider = event.name.split(".", 1)[0];
        return ["slack", "discord", "github", "linear"].includes(provider)
          ? [t("hub.automations.review.replyToTrigger", { provider: capitalize(provider) })]
          : [];
      }),
    ),
    ...outputs.map(({ type }) => type),
  ];
  return (
    <View style={[settingsStyles.card, styles.form, styles.sectionCard]}>
      <Text style={styles.sectionTitle}>{t("hub.automations.review.title")}</Text>
      <SummaryRow
        title={t("hub.automations.review.target")}
        hint={
          daemon && projectId
            ? t("hub.automations.review.targetValue", { daemon, project: projectId })
            : t("hub.automations.review.chooseHostAndProject")
        }
      />
      <SummaryRow
        title={t("hub.automations.review.agent")}
        hint={
          [agent.provider, agent.model, agent.thinkingOptionId, agent.mode]
            .filter(Boolean)
            .join(" · ") || t("hub.automations.review.chooseAgent")
        }
        border
      />
      <SummaryRow
        title={t("hub.automations.review.runtimeCeiling")}
        hint={t("hub.automations.review.runtimeValue", {
          maxRuntime: maxRuntime || t("hub.automations.review.notSet"),
          idleTimeout: idleTimeout || t("hub.automations.review.idleNotSet"),
        })}
        border
      />
      <SummaryRow
        title={t("hub.automations.review.automaticActions")}
        hint={automaticActions.join("; ")}
        border
      />
      {agent.featureValues["fast_mode"] === true ? (
        <Alert
          variant="warning"
          title={t("hub.automations.review.fastModeTitle")}
          description={t("hub.automations.review.fastModeDescription")}
        />
      ) : null}
      <Text style={settingsStyles.rowHint}>{t("hub.automations.review.toolPolicy")}</Text>
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
  const { t } = useTranslation();
  if (pending) return <Text style={settingsStyles.rowHint}>{t("hub.automations.loading")}</Text>;
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
  if (event.connection) {
    return i18n.t("hub.automations.events.connectionHint", { connection: event.connection });
  }
  return event.name === "manual.run"
    ? i18n.t("hub.automations.events.manualHint")
    : i18n.t("hub.automations.events.configuredHint");
}

function eventLabel(eventName: string): string {
  return (
    automationEvents().find(({ name }) => name === eventName)?.label ??
    (eventName === "channel.message" ? i18n.t("hub.automations.events.routes") : eventName)
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
