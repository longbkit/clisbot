import { AutomationInputDraftContext, draftBaseline } from "./automation-input-draft";
import { useContext } from "react";
import { AutomationReplyNavigationContext } from "./automation-reply-navigation";
import { saveChangedAccounts, type ChannelAccountRef } from "../channel-account-requests";
import {
  useChannelConfigurationPreview,
  useChannelRouteAdminScope,
  useChannelRouteWarnings,
  useChannelSettingsQueries,
  useReportDraftEditing,
  useScrollToTopOn,
} from "./channel-settings-hooks";
import {
  audienceRuleErrors,
  audienceRuleFromDraft,
  audienceRuleSentence,
  audienceRulesComplete,
  isOpenAudienceDraft,
  newRouteRule,
  routeAudienceDraft,
  type AudienceNames,
  type AudienceRuleDraft,
} from "./channel-route-audience";
import { AudienceRulesEditor, type AudienceOption } from "./channel-route-audience-fields";
import { AdvancedConfigurationSection, useChannelYamlForm } from "./channel-advanced-configuration";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from "react";
import { ArrowDown, ArrowUp } from "lucide-react-native";
import { StatusBadge } from "@/components/ui/status-badge";
import { hostConnectionPresentation } from "@/clisbot/hub/channel-host-connection";
import { RouteHostProvider, useRouteHost } from "./route-host-context";
import { ChannelActionsMenu } from "./channel-actions-menu";
import { ConnectionSettingRow, ConnectionTestMessagePanel } from "./channel-connection-settings";
import { ChoiceRow } from "./channel-route-behavior-rows";
import {
  FoldedRouteFormSection,
  FoldedRouteFormSubgroup,
  RouteFormSection,
  RoutePermissionFields,
  RouteReplyFields,
  RouteTriggerFields,
  approvalSummary,
  DEFAULT_ROUTE_QUESTIONS,
  QUESTION_VALUES,
  type RouteApprovalChoice,
} from "./channel-route-form-sections";
import { ChannelIcon } from "@/clisbot/channels/channel-icon";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { useFetchQuery } from "@/data/query";
import { useIsCompactFormFactor } from "@/constants/layout";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { ConfirmationProvider, useConfirmation } from "@/components/confirmation-provider";
import { useHubAccount } from "../account-provider";
import { HubApiError } from "../api-client";
import { hubResourceQueryKey } from "../query-keys";
import {
  CHANNEL_ROUTE_TARGET_VALUES,
  initialChannelRouteTarget,
  initialChannelReplyAnchor,
} from "../channel-onboarding";
import { automationYamlChannelReplyGrant } from "../automation-configuration";
import { createAutomation } from "../automation-management";
import {
  channelAccountResourceId,
  buildChannelAccountCandidate,
  buildChannelRouteCandidate,
  DEFAULT_MEMBER_ROUTE_BEHAVIOR,
  channelRouteFollowUp,
  parseChannelFollowUpTtlMinutes,
  DEFAULT_OPEN_AUDIENCE_ROUTE_BEHAVIOR,
  DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS,
  insertChannelRoute,
  isDirectMessageOnly,
  parseChannelConfigurationYaml,
  replaceChannelRouteCandidate,
  routeContainsText,
  routeEffectiveAgent,
  type ChannelConfigurationRecord,
  type ChannelRouteBehavior,
  type ChannelRouteQuestions,
  type ChannelRouteTarget,
} from "../channel-configuration";
import { inheritedChannelRouteConversation } from "../channel-route-conversation";
import {
  RouteConversationSection,
  useRouteConversationDraft,
} from "./channel-route-conversation-fields";
import {
  ChannelAccountLimitsPanel,
  ChannelLimitsFields,
  NO_DEFAULTS,
  channelLimitsDraft,
  channelLimitsSummary,
  parseChannelLimitsDraft,
  type ChannelLimitsDraft,
} from "./channel-limits-fields";
import {
  HubAutomationsSchema,
  HubAccessAssignmentsSchema,
  HubChannelConfigurationSchema,
  HubChannelRevisionsSchema,
  HubChannelRuntimeRetrySchema,
  HubChannelRuntimeStatusSchema,
  HubChannelTestSchema,
  HubChannelTestPreviewSchema,
  HubObservedChannelConversationsSchema,
  HubChannelValidationSchema,
  HubConnectionSchema,
  HubConnectionsSchema,
  HubDaemonsSchema,
  HubTeamsSchema,
} from "../contracts";
import { buildHubSettingsRoute } from "../navigation";
import { splitConversationIds } from "../conversation-picker";
import { channelConnectionDetail } from "../channel-identity-directory";
import { ChannelActivity, initialChannelActivityState } from "./channel-activity";
import { AddChannelConnection } from "./channel-connection-add";
import { ChannelCatalogView } from "./channel-catalog-view";
import { ChannelPairingPanel } from "./channel-pairing-panel";
import { ChannelQrLinkPanel } from "./channel-qr-link-panel";
import { CHANNEL_QR_OPERATIONS_AVAILABLE, useChannelQrVerbs } from "./channel-qr-verbs";
import { ChannelOperationsView } from "./channel-operations-view";
import { DaemonProjectField } from "./daemon-project-field";
import {
  ManagedAgentConfigurationFields,
  ManagedAgentFastModeSwitch,
  type ManagedAgentConfigurationValue,
} from "./managed-agent-configuration-fields";
import {
  isWorkspaceConfigurationValid,
  workspaceConfigurationFromTarget,
  worktreeTargetFromConfiguration,
} from "../workspace-configuration";
import { type AutomationConnection, SingleAgentAutomationForm } from "./automation-settings";
import { BackLink } from "./back-link";
import { useWideContent } from "./wide-content";
import { ViewTabs, type ViewTab } from "./view-tabs";

type RecordValue = ChannelConfigurationRecord;
type RouteTarget = "agent" | "automation";
type RouteCondition = "all" | "contains";
const FOLLOW_UP_TTL_ERROR = "Use a positive whole number of minutes.";
type ConfigurationKind = "account" | "route";
type HubConnection = z.infer<typeof HubConnectionsSchema>["connections"][number];
type HubConnections = z.infer<typeof HubConnectionsSchema>;
type HubAutomation = z.infer<typeof HubAutomationsSchema>["automations"][number];
type HubAutomations = z.infer<typeof HubAutomationsSchema>;
type HubDaemon = z.infer<typeof HubDaemonsSchema>["daemons"][number];
type HubDaemons = z.infer<typeof HubDaemonsSchema>;
type HubTeam = z.infer<typeof HubTeamsSchema>["teams"][number];
type HubTeams = z.infer<typeof HubTeamsSchema>;
type HubAssignment = z.infer<typeof HubAccessAssignmentsSchema>["assignments"][number];
type HubAssignments = z.infer<typeof HubAccessAssignmentsSchema>;
type HubRuntimeAccount = z.infer<typeof HubChannelRuntimeStatusSchema>["accounts"][number];
type HubRuntimeStatus = z.infer<typeof HubChannelRuntimeStatusSchema>;
type HubRevision = z.infer<typeof HubChannelRevisionsSchema>["revisions"][number];
type HubChannelConfiguration = z.infer<typeof HubChannelConfigurationSchema>;

const EMPTY_RECORD: RecordValue = {};
/** What a Connection Admin's editor gets for the organization-wide resources it never reads. */
const EMPTY_CONNECTIONS: HubConnections = { connections: [], providerApplications: [] };
const EMPTY_AUTOMATIONS: HubAutomations = { automations: [] };
const EMPTY_DAEMONS: HubDaemons = { daemons: [] };
const EMPTY_TEAMS: HubTeams = { teams: [] };
const ROUTE_CONDITION_VALUES = ["all", "contains"];
const ROUTE_CONDITION_LABELS = {
  all: "Every eligible message",
  contains: "Only messages containing…",
};
const ROUTE_TARGET_LABELS = {
  agent: "Start or continue an Agent",
  automation: "Run an Automation",
};
const EXPERIMENTAL_ROUTE_TARGET_NOTE = "Experimental";
interface EditingRoute {
  accountKey: string;
  routeIndex: number;
}

/**
 * One Add Route flow. `accountKey` preselects a Connection; `fixed` means the
 * form was opened from inside that Connection, so it shows it instead of a picker.
 */
type ChannelEditor =
  | { kind: "add"; accountKey: string | null; fixed: boolean }
  | { kind: "edit"; route: EditingRoute };

export interface AutomationChannelScope {
  automationName: string;
}

export function ChannelSettings({
  automationName,
  embedded = false,
}: Partial<AutomationChannelScope> & { embedded?: boolean } = {}) {
  const hub = useHubAccount();
  const router = useRouter();
  const adminScope = useChannelRouteAdminScope();
  const automationInput = useContext(AutomationInputDraftContext) !== null;
  const openAccount = useCallback(() => router.push(buildHubSettingsRoute("account")), [router]);
  if (hub.loading || adminScope.status === "loading")
    return <Text style={settingsStyles.rowHint}>Loading Channels...</Text>;
  if (adminScope.status === "none" && automationInput)
    // A Channel input is a Route on a bot, so adding one is Connection Admin work.
    return (
      <Alert
        variant="info"
        title="Channel inputs need Connection Admin"
        description="A Channel input adds a Route to a Channel bot. Ask an Organization Admin to make you Connection Admin of that bot, or to add this input for you."
      />
    );
  if (adminScope.status === "none")
    return (
      <SettingsSection title="Channels">
        <Alert
          variant="info"
          title="Ask an owner or administrator to configure Channels"
          description="Link your Channel identity in Account settings to use the conversations shared with you."
        />
        <Button size="sm" variant="outline" onPress={openAccount}>
          Open Account settings
        </Button>
      </SettingsSection>
    );
  return (
    <ConfirmationProvider
      key={JSON.stringify([hub.origin, hub.signedIn?.account.id, hub.signedIn?.organization.id])}
    >
      <ChannelSettingsContent
        automationName={automationName}
        embedded={embedded}
        adminAccounts={adminScope.status === "accounts" ? adminScope.accounts : null}
      />
    </ConfirmationProvider>
  );
}

/** Connections is the canonical Route editor; Channel Integrations is setup
 * and capabilities, Operations is the durable ingress queue, Activity is inbound
 * admission. The `accounts`/`catalog` values stay as the stored view ids. */
type ChannelView = "accounts" | "catalog" | "operations" | "activity";

const CHANNEL_VIEWS: ViewTab<ChannelView>[] = [
  { value: "accounts", label: "Connections" },
  { value: "catalog", label: "Channel Integrations" },
  { value: "operations", label: "Operations" },
  { value: "activity", label: "Activity" },
];

/** The views that render on their own, with no state from the accounts editor. */
const CHANNEL_SECONDARY_VIEWS: Partial<
  Record<
    ChannelView,
    (props: { adminAccounts: readonly ChannelAccountRef[] | null }) => ReactElement
  >
> = {
  catalog: ChannelCatalogView,
  operations: ChannelOperationsView,
};

function ChannelSettingsContent({
  automationName,
  embedded,
  adminAccounts,
}: Partial<AutomationChannelScope> & {
  embedded: boolean;
  /** The accounts a Connection Admin administers; null for the organization capability. */
  adminAccounts: readonly ChannelAccountRef[] | null;
}) {
  const [choosingInput, setChoosingInput] = useState(false);
  const toggleChoosingInput = useCallback(() => setChoosingInput((current) => !current), []);
  const confirmDialog = useConfirmation();
  const queryClient = useQueryClient();
  const {
    hub,
    scope: queryScope,
    isInstanceOperator,
    inputDraft,
    draftPending,
    channels,
    connections,
    channelConnections,
    statusRefreshing,
    automations,
    daemons,
    history,
    runtimeStatus,
    teams,
    assignments,
  } = useChannelSettingsQueries(adminAccounts);
  const adminScoped = adminAccounts !== null;
  const { organizationId, accountId: hubAccountId } = queryScope;
  const yamlForm = useChannelYamlForm(channels.data);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [mutationPending, setPending] = useState(false);
  const pending = mutationPending || draftPending;
  const [editor, setEditor] = useState<ChannelEditor | null>(null);
  // One width for every Channels tab and page (Channel Integrations is two
  // columns), so switching never resizes it. The Route form is a page of narrow
  // fields, so it keeps Settings' own column, as every other form does.
  useWideContent(
    !useIsCompactFormFactor() && automationName === undefined && !embedded && editor === null,
  );
  useReportDraftEditing(editor !== null);
  const [editorRevisionId, setEditorRevisionId] = useState<string | null>(null);
  const beginEdit = useCallback(
    (next: ChannelEditor) => {
      setEditorRevisionId(channels.data?.revision?.id ?? null);
      setChoosingInput(false);
      setEditor(next);
    },
    [channels.data?.revision?.id],
  );
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | null>(null);
  const [channelView, setChannelView] = useState<ChannelView>("accounts");
  const [activityState, setActivityState] = useState(initialChannelActivityState);
  const openAccountActivity = useCallback(() => {
    setActivityState(initialChannelActivityState(selectedAccountKey ?? "all"));
    setChannelView("activity");
  }, [selectedAccountKey]);
  // An embedded or draft editor scrolls inside its own container.
  useScrollToTopOn(
    !embedded && !inputDraft,
    useMemo(
      () => [editor, selectedAccountKey, channelView],
      [editor, selectedAccountKey, channelView],
    ),
  );

  const mutate = useCallback(async (operation: () => Promise<void>) => {
    setMutationError(null);
    setPending(true);
    try {
      await operation();
      return true;
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Hub request failed.");
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  const replaceConfiguration = useCallback(
    async (
      accounts: RecordValue[],
      resource = channels.data?.resource ?? {},
      policy = channels.data?.policy ?? {},
    ) => {
      const current = channels.data;
      if (current === undefined) throw new Error("Channel configuration is still loading.");
      const candidate = {
        policy,
        accounts,
        resource,
      };
      if (inputDraft) {
        inputDraft.stage({
          ...candidate,
          ...draftBaseline(
            inputDraft.draft,
            { revisionId: current.revision?.id ?? null, accounts: current.accounts },
            adminScoped,
          ),
        });
        return;
      }
      if (adminScoped) {
        // A Connection Admin saves one account file at a time; the Hub
        // validates it and refuses a changed Connection.
        await saveChangedAccounts(
          hub.api(),
          accounts,
          current.accounts,
          current.revision?.id ?? null,
        );
        await Promise.all([channels.refetch(), runtimeStatus.refetch()]);
        return;
      }
      await hub.api().post("channel-configuration/validate", candidate, HubChannelValidationSchema);
      const saved = await hub.api().put(
        "channel-configuration",
        {
          expectedRevisionId: current.revision?.id ?? null,
          ...candidate,
        },
        HubChannelConfigurationSchema,
      );
      queryClient.setQueryData(
        hubResourceQueryKey(
          { origin: hub.origin, organizationId, accountId: hubAccountId },
          "channel-configuration",
        ),
        saved,
      );
      void Promise.all([channels.refetch(), history.refetch(), runtimeStatus.refetch()]);
    },
    [
      adminScoped,
      channels,
      history,
      hub,
      runtimeStatus,
      queryClient,
      organizationId,
      hubAccountId,
      inputDraft,
    ],
  );

  const removeAccount = useCallback(
    async (account: RecordValue) => {
      const channel = stringField(account, "channel") ?? "Channel";
      const accountId = stringField(account, "accountId") ?? "account";
      const connectionId = stringField(account, "connectionId");
      const connection = connections.data?.connections.find(({ id }) => id === connectionId);
      const resourceId = `${channel}/${accountId}`;
      const remainingConsumers =
        connection?.consumers.filter(
          (consumer) =>
            consumer.resourceKind !== "channel_account" || consumer.resourceId !== resourceId,
        ) ?? [];
      const confirmed = await confirmDialog({
        title: `Remove ${accountId}?`,
        message:
          remainingConsumers.length > 0
            ? `This removes all of its Routes, so nobody can talk to this bot. The Connection's credential stays, in use by ${remainingConsumers.map(({ name }) => name).join(", ")}.`
            : `This removes all of its Routes, so nobody can talk to this bot. You can also disconnect its credential next.`,
        confirmLabel: "Remove Routes",
        destructive: true,
      });
      if (!confirmed) return;
      await mutate(async () => {
        await replaceConfiguration(
          (channels.data?.accounts ?? []).filter(
            (candidate) =>
              stringField(candidate, "channel") !== channel ||
              stringField(candidate, "accountId") !== accountId,
          ),
        );
        setSelectedAccountKey((current) =>
          current === channelAccountKey(account) ? null : current,
        );
        await connections.refetch();
        if (connectionId === null || remainingConsumers.length > 0) return;
        const disconnect = await confirmDialog({
          title: "Disconnect its credential too?",
          message: "This removes its saved credentials and Channel identity mappings.",
          confirmLabel: "Disconnect",
          cancelLabel: "Keep credential",
          destructive: true,
        });
        if (!disconnect) return;
        await hub.api().delete(`connections/${encodeURIComponent(connectionId)}`);
        await connections.refetch();
      });
    },
    [channels.data?.accounts, connections, hub, mutate, replaceConfiguration, confirmDialog],
  );

  const replaceAccountRoutes = useCallback(
    (account: RecordValue, routes: RecordValue[]) =>
      replaceConfiguration(
        (channels.data?.accounts ?? []).map((candidate) =>
          candidate === account ? Object.assign({}, candidate, { routes }) : candidate,
        ),
      ),
    [channels.data?.accounts, replaceConfiguration],
  );

  const removeRoute = useCallback(
    async (account: RecordValue, routeIndex: number) => {
      const routes = arrayField(account, "routes") as RecordValue[];
      const confirmed = await confirmDialog({
        title: `Remove Route ${String(routeIndex + 1)}?`,
        message:
          "New messages will no longer use this Route. Existing bound sessions keep their captured target until they end or become invalid.",
        confirmLabel: "Remove Route",
        destructive: true,
      });
      if (!confirmed) return;
      await mutate(() =>
        replaceAccountRoutes(
          account,
          routes.filter((_, index) => index !== routeIndex),
        ),
      );
    },
    [mutate, replaceAccountRoutes, confirmDialog],
  );

  const moveRoute = useCallback(
    async (account: RecordValue, from: number, to: number) => {
      const routes = [...(arrayField(account, "routes") as RecordValue[])];
      if (to < 0 || to >= routes.length) return;
      const [route] = routes.splice(from, 1);
      if (route === undefined) return;
      routes.splice(to, 0, route);
      await mutate(() => replaceAccountRoutes(account, routes));
    },
    [mutate, replaceAccountRoutes],
  );

  /** One account-level edit (`enabled`, `limits`); an undefined value removes the key. */
  const updateAccount = useCallback(
    async (account: RecordValue, patch: RecordValue) => {
      await mutate(() =>
        replaceConfiguration(
          (channels.data?.accounts ?? []).map((candidate) =>
            candidate === account ? withAccountPatch(candidate, patch) : candidate,
          ),
        ),
      );
    },
    [channels.data?.accounts, mutate, replaceConfiguration],
  );

  // A test message checks the Connection itself: it is sent where the user
  // picks, not tied to a Route.
  const sendTestMessage = useCallback(
    async (account: RecordValue, conversationId: string) => {
      const channel = stringField(account, "channel");
      const accountId = stringField(account, "accountId");
      if (channel === null || accountId === null) return;
      const target = { conversationId };
      setTestResult(null);
      await mutate(async () => {
        const resource = `channel-accounts/${encodeURIComponent(channel)}/${encodeURIComponent(accountId)}`;
        const params = new URLSearchParams({
          conversationId: target.conversationId,
        });
        let preview: z.infer<typeof HubChannelTestPreviewSchema>;
        try {
          preview = await hub
            .api()
            .get(`${resource}/test-preview?${params.toString()}`, HubChannelTestPreviewSchema);
        } catch (error) {
          if (error instanceof HubApiError && error.status === 404)
            throw new Error(
              "This Hub cannot preview test messages. Update the Hub before sending a test.",
              { cause: error },
            );
          throw error;
        }
        const confirmed = await confirmDialog({
          title: "Send test message?",
          message: "Review the destination and exact message before sending.",
          body: <ChannelTestPreview preview={preview} />,
          confirmLabel: "Send test message",
        });
        if (!confirmed) return;
        await hub.api().post(
          `${resource}/test`,
          {
            ...target,
            expectedText: preview.text,
            expectedRevisionId: preview.revisionId,
            expectedPreviewId: preview.previewId,
          },
          HubChannelTestSchema,
        );
        setTestResult(`Test message sent to ${preview.label ?? preview.conversationId}.`);
      });
    },
    [hub, mutate, confirmDialog],
  );

  const retryAccount = useCallback(
    async (account: RecordValue) => {
      const channel = stringField(account, "channel");
      const accountId = stringField(account, "accountId");
      if (channel === null || accountId === null) return;
      await mutate(async () => {
        const response = await hub
          .api()
          .post(
            `channel-accounts/${encodeURIComponent(channel)}/${encodeURIComponent(accountId)}/retry`,
            {},
            HubChannelRuntimeRetrySchema,
          );
        await runtimeStatus.refetch();
        if (response.status?.transport !== "started") {
          throw new Error(response.status?.detail ?? response.result.detail ?? "Retry failed.");
        }
      });
    },
    [hub, mutate, runtimeStatus],
  );

  const refreshStatus = useCallback(() => {
    void Promise.all([
      channels.refetch(),
      connections.refetch(),
      runtimeStatus.refetch(),
      history.refetch(),
      automations.refetch(),
      daemons.refetch(),
      teams.refetch(),
      assignments.refetch(),
    ]);
  }, [channels, connections, runtimeStatus, history, automations, daemons, teams, assignments]);
  const cancelRouteEdit = useCallback(() => setEditor(null), []);
  const editRoute = useCallback(
    (route: EditingRoute) => beginEdit({ kind: "edit", route }),
    [beginEdit],
  );
  // Add Route from the list header picks the Connection; from inside a
  // Connection it belongs to that Connection.
  const addRoute = useCallback(
    () => beginEdit({ kind: "add", accountKey: null, fixed: false }),
    [beginEdit],
  );
  const addRouteTo = useCallback(
    (accountKey: string) => beginEdit({ kind: "add", accountKey, fixed: true }),
    [beginEdit],
  );
  const createRouteAutomation = useCallback(
    async (yaml: string) => {
      const created = await createAutomation(hub.api(), yaml);
      await automations.refetch();
      return created.name;
    },
    [automations, hub],
  );
  const saveChannelBehavior = useCallback(
    (accounts: RecordValue[], resource: RecordValue, createdAccountKey?: string) => {
      void mutate(async () => {
        if (inputDraft) {
          if (!channels.data) throw new Error("Channel configuration is still loading.");
          inputDraft.stage({
            ...draftBaseline(
              inputDraft.draft,
              { revisionId: editorRevisionId, accounts: channels.data.accounts },
              adminScoped,
            ),
            accounts,
            resource,
            policy: channels.data.policy ?? {},
          });
          setEditor(null);
          return;
        }
        // An admin-scoped screen holds its accounts under its own query key, so
        // the loaded view is the freshest revision it can compare against.
        const currentConfiguration = adminScoped
          ? channels.data
          : queryClient.getQueryData<HubChannelConfiguration>(
              hubResourceQueryKey(
                { origin: hub.origin, organizationId, accountId: hubAccountId },
                "channel-configuration",
              ),
            );
        if ((currentConfiguration?.revision?.id ?? null) !== editorRevisionId) {
          throw new Error(
            "Channel configuration changed while editing. Cancel and reopen this Route before saving.",
          );
        }
        await replaceConfiguration(accounts, resource);
        setEditor(null);
        if (createdAccountKey !== undefined) setSelectedAccountKey(createdAccountKey);
      });
    },
    [
      adminScoped,
      inputDraft,
      channels.data,
      hub,
      mutate,
      replaceConfiguration,
      queryClient,
      organizationId,
      hubAccountId,
      editorRevisionId,
    ],
  );
  const saveConnection = useCallback(
    async (body: unknown) => {
      const created = await hub.api().post("connections", body, HubConnectionSchema);
      queryClient.setQueryData<HubConnections>(
        hubResourceQueryKey(
          { origin: hub.origin, organizationId, accountId: hubAccountId },
          "connections",
        ),
        (current) =>
          current
            ? {
                ...current,
                connections: [
                  ...current.connections.filter(({ id }) => id !== created.id),
                  created,
                ],
              }
            : current,
      );
      void connections.refetch();
      return created;
    },
    [connections, hub, queryClient, organizationId, hubAccountId],
  );
  const validateAdvancedConfiguration = useCallback(
    async (candidate: ReturnType<typeof parseChannelConfigurationYaml>) => {
      await hub.api().post("channel-configuration/validate", candidate, HubChannelValidationSchema);
    },
    [hub],
  );
  const saveAdvancedConfiguration = useCallback(
    (candidate: ReturnType<typeof parseChannelConfigurationYaml>) => {
      return mutate(() =>
        replaceConfiguration(candidate.accounts, candidate.resource, candidate.policy),
      );
    },
    [mutate, replaceConfiguration],
  );

  const sources = editorSourcesFor(adminScoped, {
    channels,
    connections,
    automations,
    daemons,
    teams,
    runtimeStatus,
  });
  if (editor !== null)
    return (
      <ChannelManagementSection
        key={channelFormKey(editor)}
        editor={editor}
        automationName={automationName}
        queries={sources.editorQueries}
        retry={refreshStatus}
        error={mutationError}
        channels={channels.data}
        connections={sources.connections}
        automations={sources.automations}
        daemons={sources.daemons}
        teams={sources.teams}
        channelConnections={channelConnections}
        pending={pending}
        isInstanceOperator={isInstanceOperator}
        adminScoped={adminScoped}
        cancelRouteEdit={cancelRouteEdit}
        createRouteAutomation={createRouteAutomation}
        saveChannelBehavior={saveChannelBehavior}
        saveConnection={saveConnection}
      />
    );
  if (automationName !== undefined) {
    return (
      <AutomationChannelInputs
        automationName={automationName}
        embedded={embedded}
        accounts={channels.data?.accounts}
        queries={[channels, connections, automations]}
        mutationError={mutationError}
        testResult={testResult}
        choosingInput={choosingInput}
        toggleChoosingInput={toggleChoosingInput}
        pending={pending}
        editRoute={editRoute}
        addRoute={addRoute}
        addRouteTo={addRouteTo}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
      />
    );
  }
  const navigation = (
    <SettingsSection title="Channels">
      <ViewTabs tabs={CHANNEL_VIEWS} value={channelView} onChange={setChannelView} />
    </SettingsSection>
  );
  const SecondaryView = CHANNEL_SECONDARY_VIEWS[channelView];
  if (SecondaryView !== undefined)
    return (
      <View>
        {navigation}
        <SecondaryView adminAccounts={adminAccounts} />
      </View>
    );
  if (channelView === "activity")
    return (
      <View>
        {navigation}
        <ChannelActivity
          accounts={channels.data?.accounts}
          connections={connections.data?.connections}
          accountScoped={adminScoped}
          state={activityState}
          onChange={setActivityState}
        />
      </View>
    );
  return (
    <View>
      {navigation}
      <RouteHostProvider configuration={channels.data} daemons={sources.daemons}>
        <ChannelAccountsSection
          channels={channels.data}
          connections={connections.data}
          runtimeStatus={runtimeStatus.data}
          teams={teams.data}
          assignments={assignments.data}
          queries={sources.accountQueries}
          refreshing={statusRefreshing}
          mutationError={mutationError}
          testResult={testResult}
          selectedAccountKey={selectedAccountKey}
          adminScoped={adminScoped}
          pending={pending}
          refreshStatus={refreshStatus}
          selectAccount={setSelectedAccountKey}
          updateAccount={updateAccount}
          removeAccount={removeAccount}
          retryAccount={retryAccount}
          editRoute={editRoute}
          addRoute={addRoute}
          addRouteTo={addRouteTo}
          openActivity={openAccountActivity}
          sendTestMessage={sendTestMessage}
          moveRoute={moveRoute}
          removeRoute={removeRoute}
        />
      </RouteHostProvider>
      <ChannelConfigurationExtras
        visible={!adminScoped}
        showHistory={selectedAccountKey === null}
        revisions={history.data?.revisions}
        channels={channels.data}
        yamlForm={yamlForm}
        error={mutationError}
        pending={pending}
        validate={validateAdvancedConfiguration}
        save={saveAdvancedConfiguration}
      />
    </View>
  );
}

/**
 * What the editor and the accounts list read, by viewer. A Connection Admin
 * never reads the organization-wide Connections, Automations, Hosts or
 * revisions: the form shows the target as managed elsewhere instead.
 */
function editorSourcesFor(
  adminScoped: boolean,
  queries: {
    channels: SourceQuery<HubChannelConfiguration>;
    connections: SourceQuery<HubConnections>;
    automations: SourceQuery<HubAutomations>;
    daemons: SourceQuery<HubDaemons>;
    teams: SourceQuery<HubTeams>;
    runtimeStatus: SourceQuery<HubRuntimeStatus>;
  },
) {
  const { channels, connections, automations, daemons, teams, runtimeStatus } = queries;
  if (adminScoped) {
    return {
      editorQueries: [channels],
      accountQueries: [channels, runtimeStatus],
      connections: EMPTY_CONNECTIONS,
      automations: EMPTY_AUTOMATIONS,
      daemons: EMPTY_DAEMONS,
      teams: teams.data ?? EMPTY_TEAMS,
    };
  }
  return {
    editorQueries: [channels, connections, automations, daemons, teams],
    accountQueries: [channels, connections, runtimeStatus],
    connections: connections.data,
    automations: automations.data,
    daemons: daemons.data,
    teams: teams.data,
  };
}

interface SourceQuery<Data> {
  data: Data | undefined;
  isPending: boolean;
  error: Error | null;
}

/** Revision history and Advanced YAML: organization-wide, so hidden from a Connection Admin. */
function ChannelConfigurationExtras({
  visible,
  showHistory,
  revisions,
  channels,
  yamlForm,
  error,
  pending,
  validate,
  save,
}: {
  visible: boolean;
  showHistory: boolean;
  revisions: HubRevision[] | undefined;
  channels: HubChannelConfiguration | undefined;
  yamlForm: ReturnType<typeof useChannelYamlForm>;
  error: string | null;
  pending: boolean;
  validate(candidate: ReturnType<typeof parseChannelConfigurationYaml>): Promise<void>;
  save(candidate: ReturnType<typeof parseChannelConfigurationYaml>): Promise<boolean>;
}) {
  if (!visible) return null;
  return (
    <>
      {showHistory ? (
        <ChannelRevisionHistory revisions={revisions} activeRevisionId={channels?.revision?.id} />
      ) : null}
      <AdvancedConfigurationSection
        model={yamlForm}
        error={error}
        channels={channels}
        pending={pending}
        validate={validate}
        save={save}
      />
    </>
  );
}

/** The Connections whose Routes feed one Automation, and the picker that adds one. */
function AutomationChannelInputs({
  automationName,
  embedded,
  accounts,
  queries,
  mutationError,
  testResult,
  choosingInput,
  toggleChoosingInput,
  pending,
  editRoute,
  addRoute,
  addRouteTo,
  moveRoute,
  removeRoute,
}: {
  automationName: string;
  embedded: boolean;
  accounts: RecordValue[] | undefined;
  queries: Array<{ isPending: boolean; error: Error | null }>;
  mutationError: string | null;
  testResult: string | null;
  choosingInput: boolean;
  toggleChoosingInput(): void;
  pending: boolean;
  editRoute(route: EditingRoute): void;
  addRoute(): void;
  addRouteTo(accountKey: string): void;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  const inputDraft = useContext(AutomationInputDraftContext);
  const choosing = Boolean(inputDraft) || choosingInput;
  const inputAccounts = (accounts ?? []).filter((account) =>
    inputDraft
      ? account.channel === inputDraft.provider
      : choosingInput || accountFeedsAutomation(account, automationName),
  );
  const trailing = useMemo(
    () =>
      embedded || inputDraft ? undefined : (
        <Button size="sm" variant="outline" onPress={toggleChoosingInput}>
          {choosingInput ? "Cancel" : "Add input"}
        </Button>
      ),
    [choosingInput, embedded, inputDraft, toggleChoosingInput],
  );
  const empty =
    !choosing &&
    accounts !== undefined &&
    !accounts.some((account) => accountFeedsAutomation(account, automationName));
  return (
    <AutomationInputSection embedded={embedded} trailing={trailing}>
      <QueryFeedback queries={queries} />
      {mutationError ? <Alert variant="error" title={mutationError} /> : null}
      {testResult ? <Alert variant="success" title={testResult} /> : null}
      {empty ? <Text style={settingsStyles.rowHint}>No Channel inputs configured.</Text> : null}
      {inputAccounts.map((account) => (
        <AutomationChannelAccount
          key={channelAccountKey(account)}
          account={account}
          choosing={choosing}
          automationName={automationName}
          pending={pending}
          editRoute={editRoute}
          addRouteTo={addRouteTo}
          moveRoute={moveRoute}
          removeRoute={removeRoute}
        />
      ))}
      {choosing ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending || accounts === undefined}
          onPress={addRoute}
        >
          Use another Connection
        </Button>
      ) : null}
    </AutomationInputSection>
  );
}

/** True when one of the account's Routes runs this Automation. */
function accountFeedsAutomation(account: RecordValue, automationName: string): boolean {
  return arrayField(account, "routes").some(
    (route) => (route as RecordValue).workflow === automationName,
  );
}

function AutomationChannelAccount({
  choosing,
  account,
  automationName,
  pending,
  editRoute,
  addRouteTo,
  removeRoute,
  moveRoute,
}: {
  choosing: boolean;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  account: RecordValue;
  automationName: string;
  pending: boolean;
  editRoute(route: EditingRoute): void;
  addRouteTo(accountKey: string): void;
  removeRoute(account: RecordValue, index: number): Promise<void>;
}) {
  const add = useCallback(() => addRouteTo(channelAccountKey(account)), [account, addRouteTo]);
  const routes = arrayField(account, "routes") as RecordValue[];
  return (
    <View style={settingsStyles.card}>
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.rowTitle}>{channelAccountLabel(account)}</Text>
        {choosing ? (
          <Button size="sm" variant="outline" disabled={pending} onPress={add}>
            Add input here
          </Button>
        ) : null}
      </View>
      <ChannelAccountRouteList
        visible
        account={account}
        accountKey={channelAccountKey(account)}
        routes={routes}
        canManage
        pending={pending}
        editRoute={editRoute}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
        automationName={automationName}
      />
    </View>
  );
}

function ChannelRouteEditorHeader({
  title,
  backTo = "Connections",
  pending,
  error,
  back,
}: {
  title: string;
  pending: boolean;
  error: string | null;
  back(): void;
  backTo?: string;
}) {
  return (
    <>
      <BackLink to={backTo} onPress={back} disabled={pending} />
      <SettingsSection title={title}>
        {error ? <Alert variant="error" title={error} /> : null}
      </SettingsSection>
    </>
  );
}

function ChannelAccountsSection({
  channels,
  connections,
  runtimeStatus,
  teams,
  assignments,
  queries,
  refreshing,
  mutationError,
  testResult,
  selectedAccountKey,
  adminScoped,
  pending,
  refreshStatus,
  selectAccount,
  updateAccount,
  removeAccount,
  retryAccount,
  editRoute,
  addRoute,
  addRouteTo,
  openActivity,
  sendTestMessage,
  moveRoute,
  removeRoute,
}: {
  channels: HubChannelConfiguration | undefined;
  connections: HubConnections | undefined;
  runtimeStatus: HubRuntimeStatus | undefined;
  teams: HubTeams | undefined;
  assignments: HubAssignments | undefined;
  queries: Array<{ isPending: boolean; error: Error | null }>;
  refreshing: boolean;
  mutationError: string | null;
  testResult: string | null;
  selectedAccountKey: string | null;
  /** A Connection Admin: their accounts only, nothing organization-wide. */
  adminScoped: boolean;
  pending: boolean;
  refreshStatus(): void;
  selectAccount(key: string | null): void;
  updateAccount(account: RecordValue, patch: RecordValue): Promise<void>;
  removeAccount(account: RecordValue): Promise<void>;
  retryAccount(account: RecordValue): Promise<void>;
  editRoute(route: EditingRoute): void;
  addRoute(): void;
  addRouteTo(accountKey: string): void;
  openActivity(): void;
  sendTestMessage(account: RecordValue, conversationId: string): Promise<void>;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  const closeAccount = useCallback(() => selectAccount(null), [selectAccount]);
  return (
    <SettingsSection title="Connections" info={CONNECTIONS_INFO}>
      <QueryFeedback queries={queries} />
      {selectedAccountKey === null ? (
        <View style={styles.actions}>
          {/* One Add Route: here its form picks the Connection or connects a new
              one; inside an open Connection the page's own Add Route takes over. */}
          <Button size="sm" disabled={pending} onPress={addRoute}>
            Add Route
          </Button>
          <Button size="xs" variant="outline" disabled={refreshing} onPress={refreshStatus}>
            Refresh status
          </Button>
          <Button size="sm" variant="ghost" onPress={openActivity}>
            View activity
          </Button>
        </View>
      ) : (
        // An open Connection is a page of its own: the way back leads it.
        <BackLink to="Connections" onPress={closeAccount} />
      )}
      {mutationError ? <Alert variant="error" title={mutationError} /> : null}
      {testResult ? <Alert variant="success" title={testResult} /> : null}
      <ChannelAccountList
        accounts={channels?.accounts ?? []}
        connections={connections?.connections ?? []}
        runtimes={runtimeStatus?.accounts ?? []}
        runtimeAvailable={runtimeStatus?.runtimeAvailable}
        warnings={channels?.warnings}
        assignments={assignments?.assignments}
        teams={teams?.teams ?? []}
        revisionVersion={channels?.revision?.version}
        selectedAccountKey={selectedAccountKey}
        adminScoped={adminScoped}
        pending={pending}
        selectAccount={selectAccount}
        refreshStatus={refreshStatus}
        openActivity={openActivity}
        updateAccount={updateAccount}
        removeAccount={removeAccount}
        retryAccount={retryAccount}
        editRoute={editRoute}
        addRouteTo={addRouteTo}
        sendTestMessage={sendTestMessage}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
      />
    </SettingsSection>
  );
}

const CONNECTIONS_INFO =
  "A Connection is one bot on one channel, such as a Slack workspace install or a Telegram bot. Its Routes decide who may talk to it, where, and which Agent or Automation answers; the first Route that matches a message wins.";

function ChannelManagementSection({
  editor,
  automationName,
  error,
  queries,
  retry,
  channels,
  connections,
  automations,
  daemons,
  teams,
  channelConnections,
  pending,
  isInstanceOperator,
  adminScoped,
  cancelRouteEdit,
  createRouteAutomation,
  saveChannelBehavior,
  saveConnection,
}: {
  editor: ChannelEditor;
  automationName?: string;
  error: string | null;
  queries: Array<{ isPending: boolean; error: Error | null }>;
  retry(): void;
  channels: HubChannelConfiguration | undefined;
  connections: HubConnections | undefined;
  automations: HubAutomations | undefined;
  daemons: HubDaemons | undefined;
  teams: HubTeams | undefined;
  channelConnections: HubConnection[];
  pending: boolean;
  isInstanceOperator: boolean;
  adminScoped: boolean;
  cancelRouteEdit(): void;
  createRouteAutomation(yaml: string): Promise<string>;
  saveChannelBehavior(
    accounts: RecordValue[],
    resource: RecordValue,
    createdAccountKey?: string,
  ): void;
  saveConnection(body: unknown): Promise<HubConnection>;
}) {
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [addingConnection, setAddingConnection] = useState(false);
  const [connectionPending, setConnectionPending] = useState(false);
  const openConnection = useCallback(() => setAddingConnection(true), []);
  const closeConnection = useCallback(() => setAddingConnection(false), []);
  // The form renders the Hub's own guidance for a rejection, so this only has to
  // hold the pending flag the two navigation exits are disabled by, and rethrow.
  const submitConnection = useCallback(
    async (body: Record<string, unknown>) => {
      setConnectionPending(true);
      try {
        const created = await saveConnection(body);
        setCreatedConnectionId(created.id);
        setAddingConnection(false);
      } finally {
        setConnectionPending(false);
      }
    },
    [saveConnection],
  );
  const editing = editor.kind === "edit" ? editor.route : null;
  const accountKey = editor.kind === "add" ? editor.accountKey : null;
  const fixedAccount = editor.kind === "edit" || editor.fixed;
  const title =
    editor.kind === "edit" ? `Edit Route ${String(editor.route.routeIndex + 1)}` : "Add Route";
  if (
    channels === undefined ||
    connections === undefined ||
    automations === undefined ||
    daemons === undefined ||
    teams === undefined
  )
    return (
      <View>
        <ChannelRouteEditorHeader
          title={title}
          backTo={automationName ? "Automation inputs" : undefined}
          pending={pending}
          error={error}
          back={cancelRouteEdit}
        />
        <SettingsSection title="Channel setup">
          <QueryFeedback queries={queries} />
          <Button size="sm" variant="outline" onPress={retry}>
            Retry Channel setup
          </Button>
        </SettingsSection>
      </View>
    );
  return (
    <>
      <ChannelRouteEditorHeader
        title={title}
        backTo={automationName ? "Automation inputs" : undefined}
        pending={pending || connectionPending}
        error={error}
        back={cancelRouteEdit}
      />
      <QueryFeedback queries={queries} />
      <View style={addingConnection ? styles.hidden : undefined}>
        <ChannelAccountForm
          automationName={automationName}
          connections={channelConnections}
          {...(fixedAccount || adminScoped ? {} : { connectChannelAccount: openConnection })}
          automationConnections={connections.connections}
          automations={automations.automations}
          daemons={daemons.daemons}
          teams={teams.teams}
          resource={channels.resource ?? EMPTY_RECORD}
          policy={channels.policy}
          existingAccounts={channels.accounts}
          editing={editing}
          initialAccountKey={accountKey}
          fixedAccount={fixedAccount}
          createdConnectionId={createdConnectionId}
          pending={pending}
          adminScoped={adminScoped}
          saveError={error}
          cancelEdit={cancelRouteEdit}
          createRouteAutomation={createRouteAutomation}
          save={saveChannelBehavior}
        />
      </View>
      {addingConnection ? (
        <View>
          <AddChannelConnection
            allowProviderApplications={isInstanceOperator}
            disabled={connectionPending}
            create={submitConnection}
          />
          <BackLink to="the Route" onPress={closeConnection} disabled={connectionPending} />
        </View>
      ) : null}
    </>
  );
}

function channelFormKey(editor: ChannelEditor): string {
  if (editor.kind === "edit")
    return `${editor.route.accountKey}:${String(editor.route.routeIndex)}`;
  return `add-route:${editor.accountKey ?? ""}:${String(editor.fixed)}`;
}

function ChannelAccountList({
  accounts,
  connections,
  runtimes,
  runtimeAvailable,
  warnings,
  assignments,
  teams,
  revisionVersion,
  selectedAccountKey,
  adminScoped,
  pending,
  selectAccount,
  refreshStatus,
  openActivity,
  updateAccount,
  removeAccount,
  retryAccount,
  editRoute,
  addRouteTo,
  sendTestMessage,
  moveRoute,
  removeRoute,
}: {
  accounts: RecordValue[];
  connections: HubConnection[];
  runtimes: HubRuntimeAccount[];
  runtimeAvailable: boolean | undefined;
  warnings: HubChannelConfiguration["warnings"];
  assignments: HubAssignment[] | undefined;
  teams: HubTeam[];
  revisionVersion: number | undefined;
  selectedAccountKey: string | null;
  adminScoped: boolean;
  pending: boolean;
  selectAccount(key: string | null): void;
  refreshStatus(): void;
  openActivity(): void;
  updateAccount(account: RecordValue, patch: RecordValue): Promise<void>;
  removeAccount(account: RecordValue): Promise<void>;
  retryAccount(account: RecordValue): Promise<void>;
  editRoute(route: EditingRoute): void;
  addRouteTo(accountKey: string): void;
  sendTestMessage(account: RecordValue, conversationId: string): Promise<void>;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  if (accounts.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <EmptyRow message="No Connection has a Route yet. Add Route connects one." />
      </View>
    );
  }
  return (
    <View style={settingsStyles.card}>
      {accounts
        .filter(
          (account) =>
            selectedAccountKey === null || selectedAccountKey === channelAccountKey(account),
        )
        .map((account, index) => (
          <ChannelAccountRow
            key={channelAccountKey(account)}
            account={account}
            index={index}
            connections={connections}
            runtimes={runtimes}
            runtimeAvailable={runtimeAvailable}
            warnings={warnings}
            assignments={assignments}
            teams={teams}
            revisionVersion={revisionVersion}
            selected={selectedAccountKey === channelAccountKey(account)}
            adminScoped={adminScoped}
            pending={pending}
            selectAccount={selectAccount}
            refreshStatus={refreshStatus}
            openActivity={openActivity}
            updateAccount={updateAccount}
            removeAccount={removeAccount}
            retryAccount={retryAccount}
            editRoute={editRoute}
            addRouteTo={addRouteTo}
            sendTestMessage={sendTestMessage}
            moveRoute={moveRoute}
            removeRoute={removeRoute}
          />
        ))}
    </View>
  );
}

function ChannelAccountRow({
  account,
  index,
  connections,
  runtimes,
  runtimeAvailable,
  warnings,
  assignments,
  teams,
  revisionVersion,
  selected,
  adminScoped,
  pending,
  selectAccount,
  refreshStatus,
  openActivity,
  updateAccount,
  removeAccount,
  retryAccount,
  editRoute,
  addRouteTo,
  sendTestMessage,
  moveRoute,
  removeRoute,
}: {
  account: RecordValue;
  index: number;
  connections: HubConnection[];
  runtimes: HubRuntimeAccount[];
  runtimeAvailable: boolean | undefined;
  warnings: HubChannelConfiguration["warnings"];
  assignments: HubAssignment[] | undefined;
  teams: HubTeam[];
  revisionVersion: number | undefined;
  selected: boolean;
  adminScoped: boolean;
  pending: boolean;
  selectAccount(key: string | null): void;
  refreshStatus(): void;
  openActivity(): void;
  updateAccount(account: RecordValue, patch: RecordValue): Promise<void>;
  removeAccount(account: RecordValue): Promise<void>;
  retryAccount(account: RecordValue): Promise<void>;
  editRoute(route: EditingRoute): void;
  addRouteTo(accountKey: string): void;
  sendTestMessage(account: RecordValue, conversationId: string): Promise<void>;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  const compact = useIsCompactFormFactor();
  const channel = stringField(account, "channel") ?? "channel";
  const accountId = stringField(account, "accountId") ?? "account";
  const key = channelAccountKey(account);
  const connectionId = stringField(account, "connectionId");
  const connection = connections.find((candidate) => candidate.id === connectionId);
  const routes = arrayField(account, "routes") as RecordValue[];
  const enabled = account["enabled"] !== false;
  const runtime = runtimes.find(
    (candidate) => candidate.channel === channel && candidate.account === accountId,
  );
  const openAccount = useCallback(() => selectAccount(key), [key, selectAccount]);
  const [testing, setTesting] = useState(false);
  const retry = useCallback(() => {
    void retryAccount(account);
  }, [account, retryAccount]);
  const canRetry = canRetryRuntime({ connection, enabled, runtimeAvailable, runtime });
  const pageActions = useMemo(
    () => [
      { label: "Send test message", onSelect: () => setTesting(true) },
      { label: "Refresh status", onSelect: refreshStatus },
      ...(canRetry ? [{ label: "Retry runtime", onSelect: retry }] : []),
      { label: "View activity", onSelect: openActivity },
    ],
    [canRetry, openActivity, refreshStatus, retry],
  );
  const closeTest = useCallback(() => setTesting(false), []);
  const sendTest = useCallback(
    (conversationId: string) => {
      setTesting(false);
      void sendTestMessage(account, conversationId);
    },
    [account, sendTestMessage],
  );
  const toggleEnabled = useCallback(
    (value: boolean) => {
      void updateAccount(account, { enabled: value });
    },
    [account, updateAccount],
  );
  const remove = useCallback(() => {
    void removeAccount(account);
  }, [account, removeAccount]);
  const addRoute = useCallback(() => addRouteTo(key), [addRouteTo, key]);

  return (
    <View style={index > 0 ? settingsStyles.rowBorder : null}>
      <View style={[settingsStyles.row, styles.row, compact && styles.stackedRow]}>
        <View style={[settingsStyles.rowContent, compact && styles.stackedRowContent]}>
          <View style={styles.channelTitle}>
            <ChannelIcon channel={channel} size={14} />
            <Text style={settingsStyles.rowTitle}>{`${channelLabel(channel)} · ${accountId}`}</Text>
          </View>
          <Text style={settingsStyles.rowHint}>
            {channelAccountStatus(
              enabled,
              runtimeAvailable,
              runtime,
              adminScoped ? MANAGED_BY_ORGANIZATION : channelConnectionLabel(connection),
              routes.length,
            )}
          </Text>
        </View>
        <View style={styles.actions}>
          {selected ? null : (
            <Button size="xs" variant="outline" disabled={pending} onPress={openAccount}>
              Manage
            </Button>
          )}
          <Switch
            value={enabled}
            onValueChange={toggleEnabled}
            disabled={pending}
            accessibilityLabel={`${enabled ? "Disable" : "Enable"} ${accountId}`}
          />
          {selected || !adminScoped ? (
            <ChannelActionsMenu
              label={`Actions for ${accountId}`}
              disabled={pending}
              actions={selected ? pageActions : []}
              {...(adminScoped ? {} : { remove })}
            />
          ) : null}
        </View>
      </View>

      {selected && runtime?.detail ? (
        <View style={settingsStyles.row}>
          <Text style={styles.errorText}>{runtime.detail}</Text>
        </View>
      ) : null}
      {selected ? (
        <ConnectionRuntimeFacts
          channel={channel}
          accountId={accountId}
          runtime={runtime}
          revisionVersion={revisionVersion}
        />
      ) : null}
      {selected && testing ? (
        <ConnectionTestMessage
          account={account}
          pending={pending}
          send={sendTest}
          close={closeTest}
        />
      ) : null}
      {selected ? <RoutesHeaderRow pending={pending} addRoute={addRoute} /> : null}
      <ChannelAccountRouteList
        visible={selected}
        account={account}
        accountKey={key}
        routes={routes}
        warnings={warnings}
        canManage
        pending={pending}
        editRoute={editRoute}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
      />
      <ChannelAccountDetails
        visible={selected}
        account={account}
        channel={channel}
        accountId={accountId}
        connection={connection}
        assignments={assignments}
        teams={teams}
        adminScoped={adminScoped}
        pending={pending}
        updateAccount={updateAccount}
      />
    </View>
  );
}

/** Which Host answers this Route, and whether the Hub is holding it. */
function RouteHostLine({ route }: { route: RecordValue }) {
  const host = useRouteHost(route);
  if (host === null) return null;
  const presentation = hostConnectionPresentation(host);
  // A pill sizes to its label. The Route's content column stretches its children,
  // so the badge needs its own alignment or it spans the row as a grey band.
  return (
    <View style={styles.routeInline}>
      <StatusBadge label={presentation.label} variant={presentation.variant} />
    </View>
  );
}

/** The Connection's Routes start here, with the one way to add another. */
function RoutesHeaderRow({ pending, addRoute }: { pending: boolean; addRoute(): void }) {
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.row]}>
      <View style={settingsStyles.rowContent}>
        <Text style={styles.formHeading}>Routes</Text>
        <Text style={settingsStyles.rowHint}>First match wins, top to bottom.</Text>
      </View>
      <Button size="xs" variant="outline" disabled={pending} onPress={addRoute}>
        Add Route
      </Button>
    </View>
  );
}

/**
 * The Connection's settings, under its Routes: the two things this page decides,
 * each showing its value. Its status and credential are on the header line
 * already, so a row here would only repeat them.
 */
function ChannelAccountDetails({
  visible,
  account,
  channel,
  accountId,
  connection,
  assignments,
  teams,
  adminScoped,
  pending,
  updateAccount,
}: {
  visible: boolean;
  account: RecordValue;
  channel: string;
  accountId: string;
  connection: HubConnection | undefined;
  assignments: HubAssignment[] | undefined;
  teams: HubTeam[];
  adminScoped: boolean;
  pending: boolean;
  updateAccount(account: RecordValue, patch: RecordValue): Promise<void>;
}) {
  if (!visible) return null;
  const adminCount = connectionAdminCount(
    assignments,
    channelAccountResourceId(channel, accountId),
  );
  return (
    <View style={settingsStyles.rowBorder}>
      <View style={settingsStyles.row}>
        <Text style={styles.formHeading}>Connection settings</Text>
      </View>
      <ConnectionSettingRow
        title="Admins"
        value={
          adminCount === 0
            ? "Only Organization Admins"
            : `${String(adminCount)} Admin${adminCount === 1 ? "" : "s"}`
        }
      >
        <ChannelRouteAdmins
          channel={channel}
          accountId={accountId}
          connection={connection}
          assignments={assignments}
          teams={teams}
          adminScoped={adminScoped}
          pending={pending}
        />
      </ConnectionSettingRow>
      <ConnectionSettingRow
        title="Bot limits"
        value={channelLimitsSummary(account["limits"])}
        actionLabel="Change"
      >
        <ChannelAccountLimitsSection
          account={account}
          pending={pending}
          updateAccount={updateAccount}
        />
      </ConnectionSettingRow>
    </View>
  );
}

/**
 * Asking the Host to start the account again can only change something when the
 * Hub holds a credential, the Connection is on, the runtime answers, and it is
 * not already up.
 */
function canRetryRuntime(input: {
  connection: HubConnection | undefined;
  enabled: boolean;
  runtimeAvailable: boolean | undefined;
  runtime: HubRuntimeAccount | undefined;
}): boolean {
  return (
    input.connection !== undefined &&
    input.enabled &&
    input.runtimeAvailable !== false &&
    input.runtime?.transport !== "started"
  );
}

/** How many Members or Teams administer the Connection (Organization Admins aside). */
function connectionAdminCount(
  assignments: readonly HubAssignment[] | undefined,
  resourceId: string,
): number {
  return (assignments ?? []).filter(
    (assignment) =>
      assignment.resourceKind === "channel_account" &&
      assignment.resourceId === resourceId &&
      assignment.privileges.includes("channel.manage"),
  ).length;
}

/**
 * What the header line cannot say in words, and only when there is something to
 * say: which configuration the Host loaded when it did not verify or load, and
 * the QR panel when the account needs relinking. A healthy Connection shows
 * nothing here — its header already reads Running, and Revision history names
 * the revision.
 */
function ConnectionRuntimeFacts({
  channel,
  accountId,
  runtime,
  revisionVersion,
}: {
  channel: string;
  accountId: string;
  runtime: HubRuntimeAccount | undefined;
  revisionVersion: number | undefined;
}) {
  const loaded = runtime !== undefined && runtime.integrity === "ok" && runtime.loadTrace === "ok";
  // The Hub reports `needs-login` for a QR-auth account whose profile has no live
  // session. That is the whole signal: nothing else says an account is linkable.
  const needsLinking = runtime?.transport === "needs-login";
  if (loaded && !needsLinking) return null;
  return (
    <View style={[settingsStyles.row, styles.statusPanel]}>
      {loaded ? null : (
        <Text
          style={settingsStyles.rowHint}
        >{`Configuration revision ${revisionVersion ?? "—"} · Integrity ${runtime?.integrity ?? "not-checked"} · Load ${runtime?.loadTrace ?? "not-loaded"}`}</Text>
      )}
      {needsLinking ? <ChannelAccountQrLinking channel={channel} accountId={accountId} /> : null}
    </View>
  );
}

/**
 * Where a test message can go: every conversation the bot has seen, plus the
 * ones a Route names. It starts on the first a Route names.
 */
function ConnectionTestMessage({
  account,
  pending,
  send,
  close,
}: {
  account: RecordValue;
  pending: boolean;
  send(conversationId: string): void;
  close(): void;
}) {
  const channel = stringField(account, "channel");
  const accountId = stringField(account, "accountId");
  const observed = useObservedConversations(channel, accountId, true);
  const routes = arrayField(account, "routes") as RecordValue[];
  const destinations = useMemo<SelectFieldOption<string>[]>(() => {
    const named = routes.flatMap((route) =>
      routeAudienceDraft(route).rules.flatMap((rule) =>
        splitConversationIds(rule.where.conversations),
      ),
    );
    const seen = [
      ...(observed.data?.destinations ?? []),
      ...(observed.data?.conversations ?? []),
    ].map((item) => item.id);
    return [...new Set([...named, ...seen])].map((id) => ({
      id,
      value: id,
      label: channelDestinationLabel(id, observed.data),
    }));
  }, [observed.data, routes]);
  const initial = routes.map(routeTestTarget).find((target) => target !== null);
  return (
    <ConnectionTestMessagePanel
      key={observed.data === undefined ? "loading" : "loaded"}
      destinations={destinations}
      initialDestination={initial?.conversationId ?? destinations[0]?.value ?? null}
      pending={pending}
      send={send}
      close={close}
    />
  );
}

function ChannelAccountLimitsSection({
  account,
  pending,
  updateAccount,
}: {
  account: RecordValue;
  pending: boolean;
  updateAccount(account: RecordValue, patch: RecordValue): Promise<void>;
}) {
  const save = useCallback(
    (limits: RecordValue | undefined) => updateAccount(account, { limits }),
    [account, updateAccount],
  );
  return <ChannelAccountLimitsPanel limits={account["limits"]} pending={pending} save={save} />;
}

function ChannelAccountQrLinking({ channel, accountId }: { channel: string; accountId: string }) {
  const verbs = useChannelQrVerbs({ channel, accountId });
  return (
    <ChannelQrLinkPanel
      accountId={accountId}
      available={CHANNEL_QR_OPERATIONS_AVAILABLE}
      verbs={verbs}
    />
  );
}

/**
 * The Connection's Access tab: who administers it. Who may talk is decided
 * by each Route's audience rules, so no Use grant is offered here
 * (docs/features/access/scoped-admins.md).
 */
function ChannelRouteAdmins({
  channel,
  accountId,
  connection,
  assignments,
  teams,
  adminScoped,
  pending,
}: {
  channel: string;
  accountId: string;
  connection: HubConnection | undefined;
  assignments: HubAssignment[] | undefined;
  teams: HubTeam[];
  adminScoped: boolean;
  pending: boolean;
}) {
  const hub = useHubAccount();
  const router = useRouter();
  const resourceId = channelAccountResourceId(channel, accountId);
  const openIdentity = useCallback(
    () =>
      router.push({
        pathname: "/settings/hub/[hubSection]",
        params: {
          hubSection: "account",
          ...(connection?.id ? { channelConnectionId: connection.id } : {}),
        },
      }),
    [router, connection?.id],
  );
  // The Access page preselects the Route from these params.
  const openAccess = useCallback(
    () =>
      router.push({
        pathname: "/settings/hub/[hubSection]",
        params: { hubSection: "team", view: "access", resourceKind: "channel_account", resourceId },
      }),
    [router, resourceId],
  );
  const members = hub.signedIn?.team?.members ?? [];
  const subjectName = (assignment: HubAssignment): string => {
    if (assignment.subjectKind === "team") {
      const team = teams.find(({ id }) => id === assignment.subjectId);
      return `Team ${team?.name ?? assignment.subjectId}`;
    }
    return members.find(({ id }) => id === assignment.subjectId)?.name ?? assignment.subjectId;
  };
  const admins = (assignments ?? [])
    .filter(
      (assignment) =>
        assignment.resourceKind === "channel_account" &&
        assignment.resourceId === resourceId &&
        assignment.privileges.includes("channel.manage"),
    )
    .map((assignment) => ({
      id: assignment.id,
      subject: subjectName(assignment),
      by: members.find(({ userId }) => userId === assignment.createdByUserId)?.name ?? null,
    }));
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        {/* The row's title and value already say "Admins" and how many there are,
            so the panel opens straight into the one thing they cannot: what an
            Admin may do, and which subjects hold it. */}
        <Text style={settingsStyles.rowHint}>
          Admins edit this Connection’s Routes, audience rules, status and relink. Who may talk to
          the bot is set on each Route.
        </Text>
        {adminLines(assignments === undefined, admins).map((line, index) => (
          <Text key={admins[index]?.id ?? line} style={settingsStyles.rowHint}>
            {line}
          </Text>
        ))}
        {adminScoped ? null : (
          <ChannelPairingPanel channel={channel} accountId={accountId} disabled={pending} />
        )}
        <View style={styles.actions}>
          {connection?.canLinkIdentity === true ? (
            <Button size="sm" variant="outline" disabled={pending} onPress={openIdentity}>
              Your Channel identities
            </Button>
          ) : null}
          <Button size="sm" variant="outline" disabled={pending} onPress={openAccess}>
            Manage Admins in Access
          </Button>
        </View>
      </View>
    </View>
  );
}

/** One line per Admin, or the one line that says why there are none. */
function adminLines(
  loading: boolean,
  admins: readonly { subject: string; by: string | null }[],
): string[] {
  if (loading) return ["Admins are not loaded yet."];
  // The row's value already reads "Only Organization Admins".
  if (admins.length === 0) return [];
  return admins.map(({ subject, by }) => (by === null ? subject : `${subject} · by ${by}`));
}

/** The conversations the bot has seen on one account, for naming stored ids. */
function useObservedConversations(
  channel: string | null,
  accountId: string | null,
  enabled: boolean,
) {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  return useFetchQuery({
    queryKey: [
      ...hubResourceQueryKey(
        {
          origin: hub.origin,
          organizationId,
          accountId: hub.signedIn?.account.id ?? null,
        },
        "channel-conversations",
      ),
      channel,
      accountId,
    ],
    queryFn: () =>
      hub
        .api()
        .get(
          `channel-accounts/${encodeURIComponent(channel!)}/${encodeURIComponent(accountId!)}/conversations`,
          HubObservedChannelConversationsSchema,
        ),
    enabled: enabled && organizationId.length > 0 && channel !== null && accountId !== null,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
}

/** Names for the ids audience rules store: Teams, Members and observed conversations. */
function useAudienceNames(
  metadata: z.infer<typeof HubObservedChannelConversationsSchema> | undefined,
  teams: readonly HubTeam[] = [],
): AudienceNames {
  const hub = useHubAccount();
  const members = hub.signedIn?.team?.members;
  return useMemo(
    () => ({
      teamName: (id) => teams.find((team) => team.id === id)?.name ?? id,
      memberName: (id) => members?.find((member) => member.id === id)?.name ?? id,
      conversationLabel: (id) => channelDestinationLabel(id, metadata),
    }),
    [members, metadata, teams],
  );
}

function ChannelAccountRouteList({
  automationName,
  visible,
  account,
  accountKey,
  routes,
  warnings,
  canManage,
  pending,
  editRoute,
  moveRoute,
  removeRoute,
}: {
  automationName?: string;
  visible: boolean;
  account: RecordValue;
  accountKey: string;
  routes: RecordValue[];
  warnings?: HubChannelConfiguration["warnings"];
  canManage: boolean;
  pending: boolean;
  editRoute(route: EditingRoute): void;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  const metadata = useObservedConversations(
    stringField(account, "channel"),
    stringField(account, "accountId"),
    visible,
  );
  if (!visible) return null;
  const refusal = automationName === undefined ? <RouteRefusalRow /> : null;
  if (routes.length === 0) {
    return (
      <>
        <EmptyRow message="No Routes yet: nobody can talk to this bot." />
        {refusal}
      </>
    );
  }
  const rows = routes.map((route, routeIndex) =>
    automationName !== undefined && route.workflow !== automationName ? null : (
      <ChannelRouteRow
        key={`${accountKey}:route:${String(routeIndex)}`}
        automationScoped={automationName !== undefined}
        account={account}
        accountKey={accountKey}
        route={route}
        metadata={metadata.data}
        warnings={warnings}
        routeIndex={routeIndex}
        routeCount={routes.length}
        canManage={canManage}
        pending={pending}
        editRoute={editRoute}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
      />
    ),
  );
  return (
    <>
      {rows}
      {refusal}
    </>
  );
}

/** There is no catch-all: a sender needs a Route whose audience rules admit them. */
function RouteRefusalRow() {
  return (
    <View style={settingsStyles.row}>
      <Text style={settingsStyles.rowHint}>Anyone no Route admits is refused.</Text>
    </View>
  );
}

/** Collapsed to a count, so a Route configured wide on purpose does not shout forever. */
function RouteWarnings({ warnings }: { warnings: string[] }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  if (warnings.length === 0) return null;
  const count = `${String(warnings.length)} warning${warnings.length === 1 ? "" : "s"}`;
  return (
    <View style={styles.routeWarnings}>
      <View style={styles.routeInline}>
        <Button size="xs" variant="ghost" onPress={toggle}>
          {open ? `Hide ${count}` : count}
        </Button>
      </View>
      {open ? <Alert variant="warning" title={count} description={warnings.join("\n")} /> : null}
    </View>
  );
}

function ChannelRouteRow({
  automationScoped,
  account,
  accountKey,
  route,
  metadata,
  warnings: accountWarnings,
  routeIndex,
  routeCount,
  canManage,
  pending,
  editRoute,
  moveRoute,
  removeRoute,
}: {
  automationScoped: boolean;
  account: RecordValue;
  accountKey: string;
  route: RecordValue;
  metadata: z.infer<typeof HubObservedChannelConversationsSchema> | undefined;
  warnings: HubChannelConfiguration["warnings"];
  routeIndex: number;
  routeCount: number;
  canManage: boolean;
  pending: boolean;
  editRoute(route: EditingRoute): void;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  const compact = useIsCompactFormFactor();
  const names = useAudienceNames(metadata);
  const edit = useCallback(() => {
    editRoute({ accountKey, routeIndex });
  }, [accountKey, editRoute, routeIndex]);
  const moveUp = useCallback(() => {
    void moveRoute(account, routeIndex, routeIndex - 1);
  }, [account, moveRoute, routeIndex]);
  const moveDown = useCallback(() => {
    void moveRoute(account, routeIndex, routeIndex + 1);
  }, [account, moveRoute, routeIndex]);
  const remove = useCallback(() => {
    void removeRoute(account, routeIndex);
  }, [account, removeRoute, routeIndex]);
  const warnings = useChannelRouteWarnings(
    accountWarnings,
    stringField(account, "channel"),
    stringField(account, "accountId"),
    routeIndex,
  );
  return (
    <View
      style={[
        settingsStyles.row,
        settingsStyles.rowBorder,
        styles.routeRow,
        compact && styles.stackedRow,
      ]}
    >
      <View
        style={[
          settingsStyles.rowContent,
          !compact && styles.routeContent,
          compact && styles.stackedRowContent,
        ]}
      >
        <Text style={settingsStyles.rowTitle}>
          {`Route ${String(routeIndex + 1)} · ${routeTargetSummary(route)}`}
        </Text>
        <RouteHostLine route={route} />
        <Text style={settingsStyles.rowHint}>{routeAudienceLine(route, names)}</Text>
        <Text style={settingsStyles.rowHint}>{routeBehaviorSummary(route)}</Text>
        <Text style={settingsStyles.rowHint}>{channelLimitsSummary(route["limits"])}</Text>
        <RouteWarnings warnings={warnings} />
      </View>
      {canManage ? (
        <View style={styles.actions}>
          <Button size="xs" variant="outline" disabled={pending} onPress={edit}>
            {automationScoped ? "Edit input and replies" : "Edit"}
          </Button>
          {!automationScoped ? (
            <>
              <Button
                size={compact ? "md" : "sm"}
                variant="ghost"
                disabled={pending || routeIndex === 0}
                onPress={moveUp}
                leftIcon={ArrowUp}
                accessibilityLabel={`Move Route ${routeIndex + 1} up`}
              />
              <Button
                size={compact ? "md" : "sm"}
                variant="ghost"
                disabled={pending || routeIndex === routeCount - 1}
                onPress={moveDown}
                leftIcon={ArrowDown}
                accessibilityLabel={`Move Route ${routeIndex + 1} down`}
              />
            </>
          ) : null}
          <ChannelActionsMenu
            label={`Actions for Route ${routeIndex + 1}`}
            disabled={pending}
            remove={remove}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Only the active revision earns permanent space: the older entries are a read-only
 * log, so they stay behind a disclosure instead of growing the page with every save.
 */
function ChannelRevisionHistory({
  revisions,
  activeRevisionId,
}: {
  revisions: HubRevision[] | undefined;
  activeRevisionId: string | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((current) => !current), []);
  if (revisions === undefined || revisions.length === 0) {
    return (
      <SettingsSection title="Revision history">
        <View style={settingsStyles.card}>
          <EmptyRow
            message={
              revisions === undefined
                ? "Loading revisions…"
                : "No Channel configuration revision exists yet."
            }
          />
        </View>
      </SettingsSection>
    );
  }
  const active = revisions.find((revision) => revision.id === activeRevisionId) ?? revisions[0]!;
  const older = revisions.filter((revision) => revision.id !== active.id);
  return (
    <SettingsSection title="Revision history">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <ChannelRevisionLine revision={active} active={active.id === activeRevisionId} />
          </View>
          {older.length === 0 ? null : (
            <Button size="xs" variant="ghost" onPress={toggle}>
              {expanded ? "Hide earlier" : `${String(older.length)} earlier`}
            </Button>
          )}
        </View>
        {expanded
          ? older.map((revision) => (
              <View key={revision.id} style={[settingsStyles.row, settingsStyles.rowBorder]}>
                <View style={settingsStyles.rowContent}>
                  <ChannelRevisionLine revision={revision} active={false} />
                </View>
              </View>
            ))
          : null}
      </View>
    </SettingsSection>
  );
}

function ChannelRevisionLine({ revision, active }: { revision: HubRevision; active: boolean }) {
  return (
    <View style={styles.revisionLine}>
      <Text style={settingsStyles.rowTitle}>
        {`Revision ${String(revision.version)}${active ? " · Active" : ""}`}
      </Text>
      <Text style={styles.revisionTime}>{new Date(revision.createdAt).toLocaleString()}</Text>
    </View>
  );
}

function ChannelAccountForm({
  automationName: fixedAutomationName,
  connections,
  automationConnections,
  automations,
  daemons,
  teams,
  resource,
  policy,
  existingAccounts,
  editing,
  initialAccountKey,
  fixedAccount,
  createdConnectionId,
  pending,
  adminScoped,
  saveError,
  cancelEdit,
  connectChannelAccount,
  createRouteAutomation,
  save,
}: {
  automationName?: string;
  connections: Array<{
    id: string;
    provider: string;
    name: string;
    externalName: string | null;
  }>;
  automationConnections: AutomationConnection[];
  automations: HubAutomation[];
  daemons: HubDaemon[];
  teams: HubTeam[];
  resource: RecordValue;
  /** The organization's `policy.yml`: its `defaults:` are what a Route inherits last. */
  policy: RecordValue;
  existingAccounts: RecordValue[];
  editing: EditingRoute | null;
  initialAccountKey: string | null;
  /** The Connection is shown, not picked: an edit, or Add Route inside a Connection. */
  fixedAccount: boolean;
  createdConnectionId: string | null;
  pending: boolean;
  /** A Connection Admin: the target is shown, not edited, and saved as it is. */
  adminScoped: boolean;
  /** The last save's refusal, so rule-level Hub errors land on their rows. */
  saveError: string | null;
  cancelEdit(): void;
  /** Offered beside the Connection picker; absent when the Connection is fixed. */
  connectChannelAccount?: () => void;
  createRouteAutomation(yaml: string): Promise<string>;
  save(accounts: RecordValue[], resource: RecordValue, createdAccountKey?: string): void;
}) {
  const inputDraft = useContext(AutomationInputDraftContext);
  const hub = useHubAccount();
  const previewWarnings = useChannelConfigurationPreview();
  const confirmDialog = useConfirmation();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const initial = channelFormInitialState(existingAccounts, editing, resource);
  const { editedAccount, editedRoute, editedWorkflow, isEditing } = initial;
  // The picked Connection: one that already has Routes (its account), or one
  // with none yet, which this Route gives its first.
  const [destination, setDestinationState] = useState<RouteDestination | null>(() =>
    initialAccountKey === null ? null : { kind: "account", key: initialAccountKey },
  );
  const [accountIdDraft, setAccountId] = useState<string | null>(null);
  const setDestination = useCallback((next: RouteDestination | null) => {
    setDestinationState(next);
    setAccountId(null);
  }, []);
  useEffect(() => {
    if (createdConnectionId !== null)
      setDestination({ kind: "connection", id: createdConnectionId });
  }, [createdConnectionId, setDestination]);
  const { configurationKind, existingAccountKey, connectionId, destinationValue } =
    routeDestinationState(isEditing, initial.accountKey, destination);
  const accountId =
    accountIdDraft ??
    suggestedChannelAccountId(
      existingAccounts,
      connections.find(({ id }) => id === connectionId),
    );
  const [audienceRules, setAudienceRulesState] = useState<AudienceRuleDraft[]>(
    initial.audienceRules,
  );
  const [routeCondition, setRouteCondition] = useState<RouteCondition>(initial.routeCondition);
  const [behavior, setBehavior] = useState<ChannelRouteBehavior>(initial.behavior.behavior);
  const [approvalChoice, setApprovalChoice] = useState<RouteApprovalChoice>(
    initial.behavior.approvalChoice,
  );
  const [followUpTtlDraft, setFollowUpTtlDraft] = useState(() =>
    String(initial.behavior.behavior.followUpTtlMinutes),
  );
  const open = isOpenAudienceDraft(audienceRules);
  const dmOnly = isDirectMessageOnly(audienceRules.map(audienceRuleFromDraft));
  // Opening the Route to Anyone (or closing it again) starts from that
  // audience's behavior; everything stays editable afterwards.
  const setAudienceRules = useCallback<Dispatch<SetStateAction<AudienceRuleDraft[]>>>(
    (update) => {
      const next = typeof update === "function" ? update(audienceRules) : update;
      setAudienceRulesState(next);
      const nextOpen = isOpenAudienceDraft(next);
      if (nextOpen === open) return;
      const defaults = nextOpen
        ? DEFAULT_OPEN_AUDIENCE_ROUTE_BEHAVIOR
        : DEFAULT_MEMBER_ROUTE_BEHAVIOR;
      setBehavior(defaults);
      setApprovalChoice(defaults.approvalMode ?? "custom");
      setFollowUpTtlDraft(String(defaults.followUpTtlMinutes));
    },
    [audienceRules, open],
  );
  const audienceOptions = useMemo<{ teams: AudienceOption[]; members: AudienceOption[] }>(
    () => ({
      teams: teams.map(({ id, name }) => ({ id, name })),
      members: (hub.signedIn?.team?.members ?? []).map(({ id, name }) => ({ id, name })),
    }),
    [hub.signedIn?.team?.members, teams],
  );
  const audienceErrors = useMemo(
    () =>
      saveError === null
        ? new Map<number, string>()
        : audienceRuleErrors(saveError, editing?.routeIndex ?? 0),
    [editing?.routeIndex, saveError],
  );

  const [contains, setContains] = useState(initial.contains);
  const [routeLimits, setRouteLimits] = useState<ChannelLimitsDraft>(initial.routeLimits);
  const [target, setTarget] = useState<RouteTarget>(() =>
    initialChannelRouteTarget(isEditing, editedWorkflow),
  );
  const [automationName, setAutomationName] = useState<string | null>(
    fixedAutomationName ?? editedWorkflow,
  );
  const [showAutomationCreator, setShowAutomationCreator] = useState(false);
  const [automationCreatePending, setAutomationCreatePending] = useState(false);
  const [automationCreateError, setAutomationCreateError] = useState<string | null>(null);
  const [daemonId, setDaemonId] = useState<string | null>(initial.daemonId);
  const [projectId, setProjectId] = useState<string | null>(initial.projectId);
  const [cwd, setCwd] = useState(initial.cwd);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [agentConfiguration, setAgentConfiguration] = useState<ManagedAgentConfigurationValue>(
    initial.agentConfiguration,
  );
  const [providerOptions, setProviderOptions] = useState(initial.providerOptions);
  const selection = channelFormSelection({
    existingAccounts,
    existingAccountKey,
    connections,
    configurationKind,
    connectionId,
    accountId,
  });
  const {
    selectedAccount,
    selectedConnection,
    effectiveAccountId,
    observedAccountChannel,
    observedAccountId,
  } = selection;
  const inheritedConversation = useMemo(
    () =>
      inheritedChannelRouteConversation([
        objectField(policy, "defaults") ?? undefined,
        objectField(selectedAccount ?? EMPTY_RECORD, "defaults") ?? undefined,
      ]),
    [policy, selectedAccount],
  );
  const conversation = useRouteConversationDraft(editedRoute, inheritedConversation);
  const observedConversations = useObservedConversations(
    observedAccountChannel,
    observedAccountId,
    true,
  );
  const audienceNames = useAudienceNames(observedConversations.data, teams);
  const parsedProviderOptions = parseOptionalObject(providerOptions);
  const parsedRouteLimits = parseChannelLimitsDraft(routeLimits);
  const destinationOptions = useMemo(
    () => routeDestinationOptions(existingAccounts, connections, adminScoped, inputDraft?.provider),
    [adminScoped, connections, existingAccounts, inputDraft?.provider],
  );
  const daemonOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      daemons.map((daemon) => ({
        id: daemon.id,
        value: daemon.id,
        label: daemon.slug,
      })),
    [daemons],
  );
  const selectedDaemonServerId = daemonServerId(daemons, daemonId);
  const automationOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      automations.map((automation) => ({
        id: automation.id,
        value: automation.name,
        label: automation.name,
      })),
    [automations],
  );
  const followUpTtlValid = isFollowUpTtlDraftValid({
    dmOnly,
    behavior,
    draft: followUpTtlDraft,
  });
  // A Connection Admin keeps the Route's target; a new Route of theirs
  // copies the target of one the account already has.
  const [existingTargetIndex, setExistingTargetIndex] = useState<string | null>(null);
  const existingTarget = adminExistingTarget(
    adminScoped,
    editedRoute,
    selectedAccount,
    existingTargetIndex,
  );
  const canSave = canSaveChannelRoute({
    followUpTtlValid,
    conversationValid: conversation.parsed.valid,
    selectedConnection,
    effectiveAccountId,
    configurationKind,
    selectedAccount,
    routeCondition,
    contains,
    audienceComplete: audienceRulesComplete(audienceRules),
    parsedRouteLimits,
    existingTarget,
    target,
    automationName,
    daemonId,
    projectId,
    cwd,
    workspaceValid: isWorkspaceConfigurationValid(workspace),
    provider: agentConfiguration.provider,
    providerOptionsValid: parsedProviderOptions.valid,
  });
  const duplicateAccount =
    configurationKind === "account" &&
    isDuplicateChannelAccount(existingAccounts, selectedConnection, accountId);

  const destinationDisplay = useMemo(
    () => selectedOptionDisplay(destinationOptions, destinationValue),
    [destinationOptions, destinationValue],
  );
  const changeDestination = useCallback(
    (value: string | null) => setDestination(parseRouteDestination(value)),
    [setDestination],
  );
  const automationDisplay = useMemo(
    () => selectedOptionDisplay(automationOptions, automationName),
    [automationName, automationOptions],
  );
  const daemonDisplay = useMemo(
    () => selectedOptionDisplay(daemonOptions, daemonId),
    [daemonId, daemonOptions],
  );
  const automationNames = useMemo(() => automations.map(({ name }) => name), [automations]);
  const changeRouteCondition = useCallback(
    (value: string) => setRouteCondition(value as RouteCondition),
    [],
  );
  const changeRequireMention = useCallback(
    (requireMention: boolean) => setBehavior((current) => ({ ...current, requireMention })),
    [],
  );
  const changeFollowUpAuto = useCallback(
    (auto: boolean) =>
      setBehavior((current) => ({
        ...current,
        followUpMode: auto ? "auto" : "mention-only",
        followUpEdited: true,
      })),
    [],
  );
  const changeFollowUpTtlMinutes = useCallback((value: string) => {
    setFollowUpTtlDraft(value);
    const minutes = parseChannelFollowUpTtlMinutes(value);
    if (minutes === null) return;
    setBehavior((current) => ({
      ...current,
      followUpTtlMinutes: minutes,
      followUpEdited: true,
      followUpTtlAuthored: true,
    }));
  }, []);
  const changeReplyThread = useCallback(
    (thread: boolean) =>
      setBehavior((current) => ({
        ...current,
        replyAnchor: thread ? "thread" : "default",
      })),
    [],
  );
  const changeOutboundPath = useCallback(
    (value: string) =>
      setBehavior((current) => ({
        ...current,
        outboundPath: value as "relay" | "tool",
      })),
    [],
  );
  const changeFinalAnswers = useCallback(
    (finalAnswers: boolean) => setBehavior((current) => ({ ...current, finalAnswers })),
    [],
  );
  const changeProgressMessage = useCallback(
    (progressMessage: boolean) => setBehavior((current) => ({ ...current, progressMessage })),
    [],
  );
  const changeTypingIndicator = useCallback(
    (typingIndicator: boolean) => setBehavior((current) => ({ ...current, typingIndicator })),
    [],
  );
  const changeToolCalls = useCallback(
    (toolCalls: boolean) => setBehavior((current) => ({ ...current, toolCalls })),
    [],
  );
  const changeApprovalChoice = useCallback(
    (value: string) => setApprovalChoice(value as RouteApprovalChoice),
    [],
  );
  const changeQuestions = useCallback(
    (value: string) =>
      setBehavior((current) => ({ ...current, questions: value as ChannelRouteQuestions })),
    [],
  );
  const changeTarget = useCallback((value: string) => setTarget(value as RouteTarget), []);
  const showAutomationForm = useCallback(() => {
    if (selectedConnection === undefined) {
      setAutomationCreateError("Choose a Connection before creating its Automation.");
      return;
    }
    setAutomationCreateError(null);
    setShowAutomationCreator(true);
  }, [selectedConnection]);
  const changeDaemon = useCallback((value: string | null) => {
    setDaemonId(value);
    setProjectId(null);
    setCwd("");
  }, []);
  const cancelAutomationCreate = useCallback(() => {
    setShowAutomationCreator(false);
    setAutomationCreateError(null);
  }, []);
  const saveAutomation = useCallback(
    async (yaml: string) => {
      setAutomationCreatePending(true);
      setAutomationCreateError(null);
      try {
        const createdName = await createRouteAutomation(yaml);
        setAutomationName(createdName);
        setTarget("automation");
        setShowAutomationCreator(false);
      } catch (error) {
        setAutomationCreateError(
          error instanceof Error ? error.message : "Automation could not be created.",
        );
      } finally {
        setAutomationCreatePending(false);
      }
    },
    [createRouteAutomation],
  );

  const submit = useCallback(async () => {
    if (!canSave || duplicateAccount) return;
    const routeTarget = formRouteTarget(existingTarget, {
      target,
      automationName,
      daemonId,
      projectId,
      cwd,
      worktree: worktreeTargetFromConfiguration(workspace),
      agentConfiguration,
      parsedProviderOptions,
    });
    if (routeTarget === null) return;
    const next = nextConfiguration({
      routeInput: {
        accountId: effectiveAccountId,
        audience: audienceRules.map(audienceRuleFromDraft),
        ...(routeCondition === "contains" ? { contains } : {}),
        ...(parsedRouteLimits.valid ? { limits: parsedRouteLimits.value } : {}),
        behavior: behaviorWithApprovalChoice(behavior, approvalChoice),
        ...(conversation.parsed.valid ? { conversation: conversation.parsed.value } : {}),
        target: routeTarget,
        resource,
      },
      existingAccounts,
      editing: isEditing ? editing : null,
      editedRoute,
      configurationKind,
      selectedConnection,
      selectedAccount,
    });
    if (next === null) return;
    const { nextAccounts, nextResource, nextRoute, createdAccountKey } = next;
    const review: RouteReviewInput = {
      warnings: warningsForRoute(
        await previewWarnings(nextAccounts, nextResource),
        nextAccounts,
        nextRoute,
      ),
      route: nextRoute,
      target:
        existingTarget === null
          ? routeTargetReviewLabel(target, automationName, agentConfiguration)
          : routeTargetSummary(existingTarget),
      audience: audienceRules.map((rule) => audienceRuleSentence(rule, audienceNames)),
    };
    const confirmed = await confirmDialog({
      title: inputDraft
        ? "Use this input in the Automation?"
        : routeConfirmationTitle(open, approvalChoice, isEditing),
      message: routeReviewMessage(review),
      body: routeReviewBody(review),
      confirmLabel: inputDraft ? "Use input" : channelFormSubmitLabel(isEditing),
      destructive: open || approvalChoice === "auto-allow",
    });
    if (!confirmed || !mounted.current) return;
    save(nextAccounts, nextResource, createdAccountKey);
  }, [
    inputDraft,
    agentConfiguration,
    approvalChoice,
    audienceNames,
    audienceRules,
    automationName,
    behavior,
    canSave,
    confirmDialog,
    configurationKind,
    contains,
    conversation.parsed,
    cwd,
    daemonId,
    duplicateAccount,
    editedRoute,
    editing,
    effectiveAccountId,
    existingAccounts,
    existingTarget,
    isEditing,
    open,
    parsedProviderOptions,
    parsedRouteLimits,
    projectId,
    resource,
    routeCondition,
    save,
    selectedAccount,
    selectedConnection,
    target,
    workspace,
    previewWarnings,
  ]);

  const renderConnection = () => (
    <RouteFormSection title="Connection">
      {fixedAccount ? (
        <View style={styles.channelTitle}>
          <ChannelIcon
            channel={
              stringField(isEditing ? editedAccount : selectedAccount, "channel") ?? undefined
            }
            size={14}
          />
          <Text style={settingsStyles.rowTitle}>
            {channelAccountLabel(isEditing ? editedAccount : selectedAccount)}
          </Text>
        </View>
      ) : (
        <View style={styles.accountRow}>
          <View style={styles.accountSelect}>
            <SelectField
              label="Connection"
              field={false}
              value={destinationValue}
              selectedDisplay={destinationDisplay}
              options={destinationOptions}
              onChange={changeDestination}
              placeholder="Choose a Connection"
              emptyText="Nothing is connected yet."
              searchable={destinationOptions.length > 6}
              title="Connection"
              disabled={pending}
            />
          </View>
          {connectChannelAccount === undefined ? null : (
            <View style={styles.accountConnect}>
              <Text style={styles.accountOr}>Or</Text>
              <Button
                size="sm"
                variant={destinationOptions.length === 0 ? "secondary" : "outline"}
                disabled={pending}
                onPress={connectChannelAccount}
              >
                Connect a new one
              </Button>
            </View>
          )}
        </View>
      )}
      {configurationKind === "account" ? (
        // A Connection's first Route also names the bot in Paseo; the name
        // defaults from the Connection and is what the list shows.
        <Field
          label="Name"
          error={duplicateAccount ? "Another Connection on this channel uses this name." : null}
        >
          <FormTextInput
            key={connectionId ?? ""}
            initialValue={accountId}
            onChangeText={setAccountId}
            placeholder="customer-support"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />
        </Field>
      ) : null}
    </RouteFormSection>
  );
  const renderAudience = () => (
    <RouteFormSection title="Who can talk, and where" info={AUDIENCE_INFO}>
      <AudienceRulesEditor
        rules={audienceRules}
        setRules={setAudienceRules}
        teams={audienceOptions.teams}
        members={audienceOptions.members}
        channel={selectedConnection?.provider ?? stringField(selectedAccount, "channel")}
        observedChannel={observedAccountChannel}
        accountId={observedAccountId}
        names={audienceNames}
        errors={audienceErrors}
        disabled={pending}
      />
    </RouteFormSection>
  );
  const renderTrigger = () => (
    <RouteFormSection title="When it answers">
      <RouteTriggerFields
        dmOnly={dmOnly}
        behavior={behavior}
        pending={pending}
        followUpTtlDraft={followUpTtlDraft}
        followUpTtlError={followUpTtlValid ? null : FOLLOW_UP_TTL_ERROR}
        changeRequireMention={changeRequireMention}
        changeFollowUpAuto={changeFollowUpAuto}
        changeFollowUpTtlMinutes={changeFollowUpTtlMinutes}
      />
      <ChoiceRow
        label="Messages"
        values={ROUTE_CONDITION_VALUES}
        selected={routeCondition}
        labels={ROUTE_CONDITION_LABELS}
        onChange={changeRouteCondition}
        disabled={pending}
      />
      {routeCondition === "contains" ? (
        <Field
          label="Only messages containing"
          hint="Case-sensitive literal text used only to select this Route. The full message is still sent to the target."
        >
          <FormTextInput
            initialValue={contains}
            onChangeText={setContains}
            placeholder="#triage"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />
        </Field>
      ) : null}
    </RouteFormSection>
  );
  const renderConversation = () => (
    <RouteConversationSection
      draft={conversation.draft}
      parsed={conversation.parsed}
      commands={conversation.commands}
      showUnmentioned={!dmOnly && behavior.requireMention}
      pending={pending}
    />
  );
  const renderLimits = () => (
    <FoldedRouteFormSection
      title="Limits"
      info={LIMITS_INFO}
      summary={
        parsedRouteLimits.valid
          ? channelLimitsSummary(parsedRouteLimits.value)
          : parsedRouteLimits.error
      }
      inUse={initial.routeLimitsAuthored}
    >
      <ChannelLimitsFields
        draft={routeLimits}
        setDraft={setRouteLimits}
        defaults={open ? DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS : NO_DEFAULTS}
        error={parsedRouteLimits.valid ? null : parsedRouteLimits.error}
        disabled={pending}
      />
    </FoldedRouteFormSection>
  );
  const renderReplies = () => (
    <RouteFormSection title="Replies">
      <RouteReplyFields
        dmOnly={dmOnly}
        behavior={behavior}
        pending={pending}
        changeReplyThread={changeReplyThread}
        changeOutboundPath={changeOutboundPath}
        changeFinalAnswers={changeFinalAnswers}
        changeProgressMessage={changeProgressMessage}
        changeTypingIndicator={changeTypingIndicator}
        changeToolCalls={changeToolCalls}
      />
    </RouteFormSection>
  );
  // How the Agent runs belongs with what runs: its permissions, then its
  // provider settings folded under Advanced.
  const renderRunSettings = () => (
    <>
      {/* Its two fields carry their own labels; a heading over them would repeat them. */}
      <RoutePermissionFields
        approvalChoice={approvalChoice}
        questions={behavior.questions ?? DEFAULT_ROUTE_QUESTIONS}
        pending={pending}
        changeApprovalChoice={changeApprovalChoice}
        changeQuestions={changeQuestions}
      />
      {adminScoped || fixedAutomationName !== undefined || target !== "agent" ? null : (
        <FoldedRouteFormSubgroup
          title="Advanced options"
          summary="Fast mode and provider options"
          inUse={
            initial.providerOptions.trim().length > 0 ||
            initial.agentConfiguration.featureValues["fast_mode"] === true
          }
        >
          <AgentAdvancedFields
            selectedDaemonServerId={selectedDaemonServerId}
            agentConfiguration={agentConfiguration}
            setAgentConfiguration={setAgentConfiguration}
            providerOptions={providerOptions}
            parsedProviderOptions={parsedProviderOptions}
            setProviderOptions={setProviderOptions}
            pending={pending}
          />
        </FoldedRouteFormSubgroup>
      )}
    </>
  );
  const renderTargetChoice = () => {
    if (fixedAutomationName !== undefined)
      return <Text style={settingsStyles.rowTitle}>{`Automation · ${fixedAutomationName}`}</Text>;
    if (adminScoped)
      return (
        <ChannelRouteAdminTarget
          editedRoute={editedRoute}
          routes={arrayField(selectedAccount ?? EMPTY_RECORD, "routes") as RecordValue[]}
          selectedIndex={existingTargetIndex}
          onChange={setExistingTargetIndex}
          disabled={pending}
        />
      );
    return (
      <RouteTargetFields
        target={target}
        changeTarget={changeTarget}
        automationName={automationName}
        automationDisplay={automationDisplay}
        automationOptions={automationOptions}
        setAutomationName={setAutomationName}
        automationCreatePending={automationCreatePending}
        showAutomationCreator={showAutomationCreator}
        showAutomationForm={showAutomationForm}
        automationCreateError={automationCreateError}
        daemonId={daemonId}
        daemonDisplay={daemonDisplay}
        daemonOptions={daemonOptions}
        changeDaemon={changeDaemon}
        projectId={projectId}
        setProjectId={setProjectId}
        cwd={cwd}
        setCwd={setCwd}
        workspace={workspace}
        setWorkspace={setWorkspace}
        selectedDaemonServerId={selectedDaemonServerId}
        agentConfiguration={agentConfiguration}
        setAgentConfiguration={setAgentConfiguration}
        pending={pending}
      />
    );
  };
  const renderTarget = () => (
    <RouteFormSection title="What runs" info={WHAT_RUNS_INFO}>
      {renderTargetChoice()}
      {renderRunSettings()}
    </RouteFormSection>
  );
  const renderAutomationCreator = () => {
    if (target !== "automation" || !showAutomationCreator) return null;
    return (
      <SingleAgentAutomationForm
        key={selectedConnection?.provider}
        title="Create Automation for this Route"
        channelReplyProvider={
          channelReplyProviderName(selectedConnection?.provider ?? null) ?? undefined
        }
        daemons={daemons}
        connections={automationConnections}
        existingNames={automationNames}
        pending={automationCreatePending}
        cancel={cancelAutomationCreate}
        save={saveAutomation}
      />
    );
  };
  return (
    <View>
      {renderConnection()}
      {renderAudience()}
      {renderTrigger()}
      {renderConversation()}
      {renderTarget()}
      {renderReplies()}
      {renderLimits()}
      {target === "automation" && automationName !== null && !adminScoped ? (
        <AutomationReplyAuthority
          automation={automations.find((item) => item.name === automationName)}
          channel={selectedConnection?.provider}
        />
      ) : null}
      <View style={styles.formActions}>
        <Button disabled={pending || !canSave || duplicateAccount} onPress={submit}>
          {inputDraft ? "Use input" : channelFormSubmitLabel(isEditing)}
        </Button>
        <Button variant="ghost" disabled={pending} onPress={cancelEdit}>
          Cancel
        </Button>
      </View>
      {renderAutomationCreator()}
    </View>
  );
}

const AUDIENCE_INFO =
  "A sender is admitted when any row matches both who they are and where they write. Anyone no Route admits is refused.";
const LIMITS_INFO =
  "Counted across every conversation this Route matches. Messages over a rate or run limit wait their turn; a message longer than the input limit is refused. The bot's own limits are on the Connection, under Limits.";
const WHAT_RUNS_INFO =
  "The Agent or Automation that answers, and how it runs. Permissions: what happens when the provider asks before running a tool. Accept automatically answers every request with Allow, for a provider with no mode that runs unattended, or whose own auto mode still asks for review. A question from the Agent is not a permission; anyone who may talk here can answer it.";

/**
 * The accounts and resource a save writes: the edited Route replaced in place, a Connection's first Route (a new account) appended, or a Route inserted into
 * the selected account. Null when the form has nothing to write to.
 */
function nextConfiguration(input: {
  routeInput: Parameters<typeof buildChannelRouteCandidate>[0];
  existingAccounts: RecordValue[];
  editing: EditingRoute | null;
  editedRoute: RecordValue | undefined;
  configurationKind: ConfigurationKind;
  selectedConnection: { id: string; provider: string } | undefined;
  selectedAccount: RecordValue | undefined;
}): {
  nextAccounts: RecordValue[];
  nextResource: RecordValue;
  nextRoute: RecordValue;
  createdAccountKey?: string;
} | null {
  const { routeInput, existingAccounts, editing, editedRoute } = input;
  if (editing !== null) {
    if (editedRoute === undefined) return null;
    const candidate = replaceChannelRouteCandidate({
      ...routeInput,
      currentRoute: editedRoute,
      accounts: existingAccounts,
    });
    const nextAccounts = existingAccounts.map((account) => {
      if (channelAccountKey(account) !== editing.accountKey) return account;
      return {
        ...account,
        routes: arrayField(account, "routes").map((route, index) =>
          index === editing.routeIndex ? candidate.route : route,
        ),
      };
    });
    return { nextAccounts, nextResource: candidate.resource, nextRoute: candidate.route };
  }
  if (input.configurationKind === "account") {
    if (input.selectedConnection === undefined) return null;
    const candidate = buildChannelAccountCandidate({
      ...routeInput,
      connection: input.selectedConnection,
    });
    return {
      nextAccounts: [...existingAccounts, candidate.account],
      nextResource: candidate.resource,
      nextRoute: arrayField(candidate.account, "routes")[0] as RecordValue,
      createdAccountKey: channelAccountKey(candidate.account),
    };
  }
  const { selectedAccount } = input;
  if (selectedAccount === undefined) return null;
  const candidate = buildChannelRouteCandidate(routeInput);
  const nextAccounts = existingAccounts.map((account) =>
    account === selectedAccount
      ? Object.assign({}, account, {
          routes: insertChannelRoute(
            arrayField(account, "routes") as RecordValue[],
            candidate.route,
          ),
        })
      : account,
  );
  return { nextAccounts, nextResource: candidate.resource, nextRoute: candidate.route };
}

/** The Route whose target a Connection Admin's save keeps; null when the form builds one. */
function adminExistingTarget(
  adminScoped: boolean,
  editedRoute: RecordValue | undefined,
  selectedAccount: RecordValue | undefined,
  existingTargetIndex: string | null,
): RecordValue | null {
  if (!adminScoped) return null;
  if (editedRoute !== undefined) return editedRoute;
  if (existingTargetIndex === null) return null;
  const routes = arrayField(selectedAccount ?? EMPTY_RECORD, "routes") as RecordValue[];
  return routes[Number(existingTargetIndex)] ?? null;
}

/**
 * What a Connection Admin sees for the target: the Route keeps the Agent or
 * Automation it has, since the shared resource file that defines it is the
 * organization's. A new Route of theirs copies the target of one the account
 * already runs.
 */
function ChannelRouteAdminTarget({
  editedRoute,
  routes,
  selectedIndex,
  onChange,
  disabled,
}: {
  editedRoute: RecordValue | undefined;
  routes: RecordValue[];
  selectedIndex: string | null;
  onChange(index: string | null): void;
  disabled: boolean;
}) {
  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      routes.map((route, index) => ({
        id: String(index),
        value: String(index),
        label: `Same as Route ${String(index + 1)} · ${routeTargetSummary(route)}`,
      })),
    [routes],
  );
  if (editedRoute !== undefined)
    return (
      <Field label="Target" hint={MANAGED_BY_ORGANIZATION}>
        <Text style={settingsStyles.rowTitle}>{routeTargetSummary(editedRoute)}</Text>
      </Field>
    );
  return (
    <SelectField
      label="Target"
      hint={`${MANAGED_BY_ORGANIZATION}. Pick the target of a Route this account already runs.`}
      value={selectedIndex}
      selectedDisplay={selectedOptionDisplay(options, selectedIndex)}
      options={options}
      onChange={onChange}
      placeholder="Choose a target"
      emptyText="This account has no Route to copy a target from."
      title="Target"
      disabled={disabled}
    />
  );
}

function daemonServerId(daemons: HubDaemon[], daemonId: string | null): string | null {
  return daemons.find((daemon) => daemon.id === daemonId)?.connectionOffer?.serverId ?? null;
}

/** True when the provider already has a Connection with this name. */
function isDuplicateChannelAccount(
  existingAccounts: RecordValue[],
  connection: { provider: string } | undefined,
  accountId: string,
): boolean {
  if (connection === undefined) return false;
  return existingAccounts.some(
    (account) =>
      stringField(account, "channel") === connection.provider &&
      stringField(account, "accountId") === accountId.trim(),
  );
}

function AutomationReplyAuthority({
  automation,
  channel,
}: {
  automation: HubAutomation | undefined;
  channel: string | undefined;
}) {
  const configureReplies = useContext(AutomationReplyNavigationContext);
  const inputDraft = useContext(AutomationInputDraftContext);
  if (inputDraft || automation === undefined || channel === undefined) return null;
  const grant = automationYamlChannelReplyGrant(automation.yaml, channel);
  if (grant === undefined)
    return (
      <View>
        <Alert
          variant="warning"
          title="This Automation has no Channel reply output"
          description={
            configureReplies
              ? "The run can start, but it cannot reply to this conversation. Configure a reply output, then save the Automation."
              : `Open ${automation.name} in Automations, choose Configuration, enable ${channel} replies on the step that responds, then save.`
          }
        />
        {configureReplies ? (
          <Button size="sm" variant="outline" onPress={configureReplies}>
            Configure reply output
          </Button>
        ) : null}
      </View>
    );
  return (
    <Text
      style={settingsStyles.rowHint}
    >{`Output target: source conversation. Automation allows ${grant.max ?? "unlimited"} ${channel} replies per run, subject to this Route’s reply policy.`}</Text>
  );
}

function RouteTargetFields({
  target,
  changeTarget,
  automationName,
  automationDisplay,
  automationOptions,
  setAutomationName,
  automationCreatePending,
  showAutomationCreator,
  showAutomationForm,
  automationCreateError,
  daemonId,
  daemonDisplay,
  daemonOptions,
  changeDaemon,
  projectId,
  setProjectId,
  cwd,
  setCwd,
  workspace,
  setWorkspace,
  selectedDaemonServerId,
  agentConfiguration,
  setAgentConfiguration,
  pending,
}: {
  target: RouteTarget;
  changeTarget(value: string): void;
  automationName: string | null;
  automationDisplay: { label: string; description?: string } | null;
  automationOptions: SelectFieldOption<string>[];
  setAutomationName(value: string | null): void;
  automationCreatePending: boolean;
  showAutomationCreator: boolean;
  showAutomationForm(): void;
  automationCreateError: string | null;
  daemonId: string | null;
  daemonDisplay: { label: string; description?: string } | null;
  daemonOptions: SelectFieldOption<string>[];
  changeDaemon(value: string | null): void;
  projectId: string | null;
  setProjectId(value: string | null): void;
  cwd: string;
  setCwd(value: string): void;
  workspace: ReturnType<typeof workspaceConfigurationFromTarget>;
  setWorkspace(value: ReturnType<typeof workspaceConfigurationFromTarget>): void;
  selectedDaemonServerId: string | null;
  agentConfiguration: ManagedAgentConfigurationValue;
  setAgentConfiguration(value: ManagedAgentConfigurationValue): void;
  pending: boolean;
}) {
  return (
    <>
      <ChoiceRow
        label="What should happen"
        values={CHANNEL_ROUTE_TARGET_VALUES}
        selected={target}
        labels={ROUTE_TARGET_LABELS}
        note={target === "automation" ? EXPERIMENTAL_ROUTE_TARGET_NOTE : undefined}
        onChange={changeTarget}
        disabled={pending}
      />
      {target === "automation" ? (
        <AutomationTargetFields
          automationName={automationName}
          automationDisplay={automationDisplay}
          automationOptions={automationOptions}
          setAutomationName={setAutomationName}
          automationCreatePending={automationCreatePending}
          showAutomationCreator={showAutomationCreator}
          showAutomationForm={showAutomationForm}
          automationCreateError={automationCreateError}
          pending={pending}
        />
      ) : (
        <AgentTargetFields
          daemonId={daemonId}
          daemonDisplay={daemonDisplay}
          daemonOptions={daemonOptions}
          changeDaemon={changeDaemon}
          projectId={projectId}
          setProjectId={setProjectId}
          cwd={cwd}
          setCwd={setCwd}
          workspace={workspace}
          setWorkspace={setWorkspace}
          selectedDaemonServerId={selectedDaemonServerId}
          agentConfiguration={agentConfiguration}
          setAgentConfiguration={setAgentConfiguration}
          pending={pending}
        />
      )}
    </>
  );
}

function AutomationTargetFields({
  automationName,
  automationDisplay,
  automationOptions,
  setAutomationName,
  automationCreatePending,
  showAutomationCreator,
  showAutomationForm,
  automationCreateError,
  pending,
}: {
  automationName: string | null;
  automationDisplay: { label: string; description?: string } | null;
  automationOptions: SelectFieldOption<string>[];
  setAutomationName(value: string | null): void;
  automationCreatePending: boolean;
  showAutomationCreator: boolean;
  showAutomationForm(): void;
  automationCreateError: string | null;
  pending: boolean;
}) {
  return (
    <>
      <SelectField
        label="Automation"
        value={automationName}
        selectedDisplay={automationDisplay}
        options={automationOptions}
        onChange={setAutomationName}
        placeholder="Choose an Automation"
        emptyText="No Automation is available yet."
        searchable={automationOptions.length > 6}
        title="Automation"
        disabled={pending || automationCreatePending}
      />
      <Button
        size="xs"
        variant="outline"
        disabled={pending || automationCreatePending || showAutomationCreator}
        onPress={showAutomationForm}
      >
        Create Automation
      </Button>
      <Text style={settingsStyles.rowHint}>
        The new Automation is selected here without clearing this Route draft.
      </Text>
      {automationCreateError ? <Alert variant="error" title={automationCreateError} /> : null}
    </>
  );
}

function AgentTargetFields({
  daemonId,
  daemonDisplay,
  daemonOptions,
  changeDaemon,
  projectId,
  setProjectId,
  cwd,
  setCwd,
  workspace,
  setWorkspace,
  selectedDaemonServerId,
  agentConfiguration,
  setAgentConfiguration,
  pending,
}: {
  daemonId: string | null;
  daemonDisplay: { label: string; description?: string } | null;
  daemonOptions: SelectFieldOption<string>[];
  changeDaemon(value: string | null): void;
  projectId: string | null;
  setProjectId(value: string | null): void;
  cwd: string;
  setCwd(value: string): void;
  workspace: ReturnType<typeof workspaceConfigurationFromTarget>;
  setWorkspace(value: ReturnType<typeof workspaceConfigurationFromTarget>): void;
  selectedDaemonServerId: string | null;
  agentConfiguration: ManagedAgentConfigurationValue;
  setAgentConfiguration(value: ManagedAgentConfigurationValue): void;
  pending: boolean;
}) {
  const workspaceField = useMemo(
    () => ({ value: workspace, onChange: setWorkspace }),
    [setWorkspace, workspace],
  );
  return (
    <>
      <SelectField
        label="Host"
        value={daemonId}
        selectedDisplay={daemonDisplay}
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
        workspace={workspaceField}
        disabled={pending}
      />
      <ManagedAgentConfigurationFields
        serverId={selectedDaemonServerId}
        cwd={cwd}
        value={agentConfiguration}
        onChange={setAgentConfiguration}
        showFastMode={false}
        disabled={pending}
      />
    </>
  );
}

/** Provider-specific settings, folded under Advanced on a direct Agent Route. */
function AgentAdvancedFields({
  selectedDaemonServerId,
  agentConfiguration,
  setAgentConfiguration,
  providerOptions,
  parsedProviderOptions,
  setProviderOptions,
  pending,
}: {
  selectedDaemonServerId: string | null;
  agentConfiguration: ManagedAgentConfigurationValue;
  setAgentConfiguration(value: ManagedAgentConfigurationValue): void;
  providerOptions: string;
  parsedProviderOptions: ReturnType<typeof parseOptionalObject>;
  setProviderOptions(value: string): void;
  pending: boolean;
}) {
  const providerOptionsError = parsedProviderOptions.valid
    ? null
    : 'Enter a JSON object, for example {"setting": true}.';
  return (
    <>
      <ManagedAgentFastModeSwitch
        serverId={selectedDaemonServerId}
        value={agentConfiguration}
        onChange={setAgentConfiguration}
        disabled={pending}
      />
      <Field
        label="Provider options"
        hint="Optional JSON object for provider-specific settings."
        error={providerOptionsError}
      >
        <FormTextInput
          initialValue={providerOptions}
          onChangeText={setProviderOptions}
          placeholder='{"setting": true}'
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          editable={!pending}
        />
      </Field>
    </>
  );
}

function QueryFeedback({
  queries,
}: {
  queries: Array<{ isPending: boolean; error: Error | null }>;
}) {
  if (queries.some((query) => query.isPending)) {
    return <Text style={settingsStyles.rowHint}>Loading…</Text>;
  }
  const error = queries.find((query) => query.error)?.error;
  return error ? <Alert variant="error" title={error.message} /> : null;
}

function EmptyRow({ message }: { message: string }) {
  return (
    <View style={settingsStyles.row}>
      <Text style={settingsStyles.rowHint}>{message}</Text>
    </View>
  );
}

function selectedOptionDisplay(
  options: SelectFieldOption<string>[],
  value: string | null,
): { label: string; description?: string } | null {
  const option = options.find((candidate) => candidate.value === value);
  return option === undefined
    ? null
    : {
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      };
}

function stringField(record: RecordValue | undefined, key: string): string | null {
  if (record === undefined) return null;
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function channelAccountKey(account: RecordValue): string {
  return `${stringField(account, "channel") ?? "channel"}:${stringField(account, "accountId") ?? "account"}`;
}

function channelAccountLabel(account: RecordValue | undefined): string {
  if (account === undefined) return "Connection unavailable";
  return `${channelLabel(stringField(account, "channel") ?? "channel")} · ${stringField(account, "accountId") ?? "account"}`;
}

/** What a Connection Admin sees where the Connection would be named. */
const MANAGED_BY_ORGANIZATION = "Managed by Organization Admins";

function channelConnectionLabel(connection: HubConnection | undefined): string {
  return connection === undefined ? "Connection unavailable" : channelConnectionDetail(connection);
}

function channelAccountStatus(
  enabled: boolean,
  runtimeAvailable: boolean | undefined,
  runtime: HubRuntimeAccount | undefined,
  connectionLabel: string,
  routeCount: number,
): string {
  const runtimeLabel = enabled ? channelRuntimeLabel(runtimeAvailable, runtime) : "Disabled";
  const routeSuffix = routeCount === 1 ? "" : "s";
  return `${runtimeLabel} · ${connectionLabel} · ${String(routeCount)} route${routeSuffix}`;
}

function arrayField(record: RecordValue, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function withAccountPatch(account: RecordValue, patch: RecordValue): RecordValue {
  const next: RecordValue = { ...account, ...patch };
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
  return next;
}

function objectField(record: RecordValue, key: string): RecordValue | null {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function routeTargetSummary(route: RecordValue): string {
  const workflow = stringField(route, "workflow");
  if (workflow !== null) return `Automation · ${workflow}`;
  const agent = stringField(route, "agent");
  return agent === null ? "Unavailable target" : `Agent · ${agent}`;
}

function routeBehaviorDraft(route: RecordValue | undefined): {
  behavior: ChannelRouteBehavior;
  approvalChoice: RouteApprovalChoice;
} {
  const interaction = objectField(route ?? {}, "interaction") ?? {};
  const reply = objectField(route ?? {}, "reply") ?? {};
  const outbound = objectField(route ?? {}, "outbound") ?? {};
  const sync = objectField(route ?? {}, "sync") ?? {};
  const progress = objectField(sync, "progress");
  const approval = arrayField(route ?? {}, "approval").filter(
    (value): value is RecordValue =>
      typeof value === "object" && value !== null && !Array.isArray(value),
  );
  const approvalMode =
    approval.length === 1 && stringField(approval[0], "match") === "*"
      ? stringField(approval[0], "mode")
      : null;
  const approvalChoice = routeApprovalChoice(approvalMode, approval.length);
  return {
    behavior: {
      requireMention: booleanValue(
        interaction["requireMention"],
        DEFAULT_MEMBER_ROUTE_BEHAVIOR.requireMention,
      ),
      ...channelRouteFollowUp(interaction),
      replyAnchor: initialChannelReplyAnchor(route !== undefined, stringField(reply, "anchor")),
      outboundPath: routeOutboundPath(stringField(outbound, "path")),
      finalAnswers: booleanValue(sync["finalAnswers"], DEFAULT_MEMBER_ROUTE_BEHAVIOR.finalAnswers),
      progressMessage: routeProgressMessage(progress, sync),
      typingIndicator: booleanValue(
        progress?.["typingIndicator"],
        DEFAULT_MEMBER_ROUTE_BEHAVIOR.typingIndicator,
      ),
      toolCalls: booleanValue(sync["toolCalls"], DEFAULT_MEMBER_ROUTE_BEHAVIOR.toolCalls),
      ...(approvalChoice === "custom" ? {} : { approvalMode: approvalChoice }),
      ...routeQuestions(route),
    },
    approvalChoice,
  };
}

/** Only an unsaved Route follows the current default; a stored path wins. */
function routeOutboundPath(path: string | null): ChannelRouteBehavior["outboundPath"] {
  if (path === "tool" || path === "relay") return path;
  return DEFAULT_MEMBER_ROUTE_BEHAVIOR.outboundPath;
}

function routeApprovalChoice(
  approvalMode: string | null,
  approvalCount: number,
): RouteApprovalChoice {
  if (approvalMode === "auto-deny" || approvalMode === "auto-allow" || approvalMode === "require") {
    return approvalMode;
  }
  if (approvalCount > 0) return "custom";
  return DEFAULT_MEMBER_ROUTE_BEHAVIOR.approvalMode!;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function routeProgressMessage(progress: RecordValue | null, sync: RecordValue): boolean {
  const progressMessage = progress?.["progressMessage"];
  if (typeof progressMessage === "boolean") return progressMessage;
  return booleanValue(sync["progress"], DEFAULT_MEMBER_ROUTE_BEHAVIOR.progressMessage);
}

/** The Route's `questions:` leaf as loaded; absent when it authors none. */
function routeQuestions(route: RecordValue | undefined): { questions?: ChannelRouteQuestions } {
  const questions = QUESTION_VALUES.find((value) => value === stringField(route, "questions"));
  return questions === undefined ? {} : { questions };
}

/** The behavior a save writes: Custom YAML keeps the Route's own approval rules. */
function behaviorWithApprovalChoice(
  behavior: ChannelRouteBehavior,
  approvalChoice: RouteApprovalChoice,
): ChannelRouteBehavior {
  const { approvalMode: _, ...settings } = behavior;
  return approvalChoice === "custom" ? settings : { ...settings, approvalMode: approvalChoice };
}

function routeReplySummary(route: RecordValue): string {
  return routeBehaviorDraft(route).behavior.outboundPath === "tool"
    ? "Use Channel tool: text and Project files, preapproved"
    : "Text forward";
}

function routeToolRequestSummary(route: RecordValue): string {
  const { behavior, approvalChoice } = routeBehaviorDraft(route);
  return approvalSummary(approvalChoice, behavior.questions);
}

function routeBehaviorSummary(route: RecordValue): string {
  return `${routeReplySummary(route)} · ${routeToolRequestSummary(route)}`;
}

interface RouteReviewInput {
  route: RecordValue;
  target: string;
  /** One sentence per audience rule. */
  audience: string[];
  /** The Hub's warnings for this Route, from validating the candidate. */
  warnings: string[];
}

/** The warnings the Hub gave for `route`, wherever it sits in the candidate. */
function warningsForRoute(
  warnings: { channel: string; accountId: string; route: number; message: string }[] | undefined,
  accounts: RecordValue[],
  route: RecordValue,
): string[] {
  const holder = accounts.find((account) => arrayField(account, "routes").includes(route));
  if (holder === undefined) return [];
  const index = arrayField(holder, "routes").indexOf(route);
  return (warnings ?? [])
    .filter(
      (warning) =>
        warning.channel === stringField(holder, "channel") &&
        warning.accountId === stringField(holder, "accountId") &&
        warning.route === index,
    )
    .map(({ message }) => message);
}

/** One source for the review the owner confirms, so the sheet body and the
 * platform dialog's plain text cannot drift apart. */
function routeReviewFacts(input: RouteReviewInput): { label: string; value: string }[] {
  return [
    { label: "Audience", value: input.audience.join("\n") },
    ...(routeContainsText(input.route) === null
      ? []
      : [{ label: "Only messages containing", value: routeContainsText(input.route)! }]),
    { label: "Target", value: input.target },
    { label: "Reply method", value: routeReplySummary(input.route) },
    { label: "Permission requests", value: routeToolRequestSummary(input.route) },
    ...(input.warnings.length === 0
      ? []
      : [{ label: "Warnings", value: input.warnings.join("\n") }]),
  ];
}

function routeReviewMessage(input: RouteReviewInput): string {
  return routeReviewFacts(input)
    .map(({ label, value }) => `${label}: ${value}`)
    .join("\n");
}

/** Labels carry the scan line and values the answer, so a long summary stays readable. */
function routeReviewBody(input: RouteReviewInput): React.ReactNode {
  return (
    <View style={styles.reviewList}>
      {routeReviewFacts(input).map(({ label, value }) => (
        <View key={label} style={styles.reviewFact}>
          <Text style={styles.reviewLabel}>{label}</Text>
          <Text style={styles.reviewValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function channelRuntimeLabel(
  runtimeAvailable: boolean | undefined,
  runtime: { transport: string } | undefined,
): string {
  if (runtimeAvailable === false) return "Runtime unavailable";
  if (runtimeAvailable === undefined) return "Checking runtime";
  if (runtime === undefined) return "Not started";
  switch (runtime.transport) {
    case "started":
      return "Running";
    case "starting":
      return "Starting";
    case "failed":
      return "Runtime error";
    case "deferred":
      return "Waiting";
    // The Hub's word for a QR-auth account whose profile has no live session.
    case "needs-login":
      return "Needs linking";
    default:
      return channelLabel(runtime.transport);
  }
}

/** One line per Route row: each rule as a sentence, then the text filter. */
function routeAudienceLine(route: RecordValue, names: AudienceNames): string {
  const { rules, contains } = routeAudienceDraft(route);
  const sentences = rules.map((rule) => audienceRuleSentence(rule, names)).join(" · ");
  return contains.length === 0 ? sentences : `${sentences} · Contains “${contains}”`;
}

/** A conversation id as the observed directory names it; a private room carries a lock. */
function channelDestinationLabel(
  id: string,
  metadata: z.infer<typeof HubObservedChannelConversationsSchema> | undefined,
): string {
  const candidates = [...(metadata?.destinations ?? []), ...(metadata?.conversations ?? [])];
  const named = candidates.find((item) => item.id === id && item.label);
  if (!named?.label || named.label === id) return id;
  const lock = named.visibility === "private" ? "🔒 " : "";
  if (named.threadId !== null) return `${lock}${named.label} · ${channelLabel(named.kind)} ${id}`;
  return `${lock}${named.label} (${id})`;
}

function ChannelTestPreview({ preview }: { preview: z.infer<typeof HubChannelTestPreviewSchema> }) {
  let destination = "New message in this conversation.";
  if (preview.threadId !== null)
    destination = `In thread: ${preview.threadLabel ? `${preview.threadLabel} (${preview.threadId})` : preview.threadId}.`;
  else if (preview.channel === "telegram" && preview.requestedThreadId === "1")
    destination = "In the General topic.";
  return (
    <View style={styles.testPreview}>
      <View>
        <Text style={settingsStyles.rowTitle}>Send to</Text>
        <Text selectable style={settingsStyles.rowHint}>
          {preview.label ? `${preview.label} (${preview.conversationId})` : preview.conversationId}
        </Text>
        <Text style={settingsStyles.rowHint}>{destination}</Text>
      </View>
      <View style={styles.testMessageSection}>
        <Text style={settingsStyles.rowTitle}>Message to send</Text>
        <View testID="channel-test-message" style={[settingsStyles.card, styles.testMessage]}>
          <Text selectable style={settingsStyles.rowTitle}>
            {preview.text}
          </Text>
        </View>
      </View>
      <Text style={settingsStyles.rowHint}>
        No attachments. This checks outbound delivery only; it does not start an Agent or
        Automation.
      </Text>
    </View>
  );
}

/** The first named conversation of the Route's rules: where a test message can go. */
function routeTestTarget(route: RecordValue): { conversationId: string } | null {
  for (const rule of routeAudienceDraft(route).rules) {
    const [conversationId] = splitConversationIds(rule.where.conversations);
    if (conversationId !== undefined) return { conversationId };
  }
  return null;
}

function channelLabel(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

/** The channels whose Automation reply inputs this app can edit. Narrower than
 * the Hub's supported set on purpose: the reply-input editors are per-provider
 * (`automation-configuration.ts`), so a channel without one has no editor to
 * open. */
function channelReplyProviderName(value: string | null): "slack" | "telegram" | null {
  return value === "slack" || value === "telegram" ? value : null;
}

function channelFormInitialState(
  accounts: RecordValue[],
  editing: EditingRoute | null,
  resource: RecordValue,
) {
  const { editedAccount, editedRoute } = findEditedRoute(accounts, editing);
  const route = editedRoute ?? EMPTY_RECORD;
  const audience = initialAudience(editedRoute);
  const editedLimits = objectField(route, "limits") ?? EMPTY_RECORD;
  const editedWorkflow = stringField(editedRoute, "workflow");
  const editedAgentName = stringField(editedRoute, "agent") ?? "";
  const editedEnvironmentName = stringField(editedRoute, "environment") ?? "";
  // What the Route really starts: a `/promoteroutedefault` layer
  // (`agentControls`) over the named agent, so the form shows what runs.
  const editedAgent = routeEffectiveAgent(
    objectField(objectField(resource, "agents") ?? EMPTY_RECORD, editedAgentName),
    editedRoute,
  );
  const editedEnvironment = objectField(
    objectField(resource, "environments") ?? EMPTY_RECORD,
    editedEnvironmentName,
  );
  const contains = audience.contains;
  const isEditing = editing !== null && editedAccount !== undefined && editedRoute !== undefined;
  const environment = managedEnvironmentConfiguration(editedEnvironment);
  return {
    editedAccount,
    editedRoute,
    editedWorkflow,
    isEditing,
    accountKey: editing?.accountKey ?? null,
    audienceRules: audience.rules,
    routeCondition: (contains.length > 0 ? "contains" : "all") as RouteCondition,
    behavior: routeBehaviorDraft(editedRoute),
    contains,
    routeLimits: channelLimitsDraft(editedLimits),
    routeLimitsAuthored: Object.keys(editedLimits).length > 0,
    ...environment,
    agentConfiguration: managedAgentConfiguration(editedAgent),
    providerOptions: formatOptionalObject(objectField(editedAgent ?? EMPTY_RECORD, "options")),
  };
}

/** The rules the form opens with: the stored ones, or Members everywhere for a new Route. */
function initialAudience(editedRoute: RecordValue | undefined): {
  rules: AudienceRuleDraft[];
  contains: string;
} {
  if (editedRoute === undefined) return { rules: [newRouteRule()], contains: "" };
  return routeAudienceDraft(editedRoute);
}

function managedEnvironmentConfiguration(environment: RecordValue | null) {
  const record = environment ?? EMPTY_RECORD;
  return {
    daemonId: stringField(record, "daemon"),
    projectId: stringField(record, "projectId"),
    cwd: stringField(record, "cwd") ?? "",
    workspace: workspaceConfigurationFromTarget(record["worktree"]),
  };
}

/** The account and Route being edited. */
function findEditedRoute(accounts: RecordValue[], editing: EditingRoute | null) {
  if (editing === null) return { editedAccount: undefined, editedRoute: undefined };
  const editedAccount = accounts.find(
    (account) => channelAccountKey(account) === editing.accountKey,
  );
  const editedRoute = arrayField(editedAccount ?? EMPTY_RECORD, "routes")[editing.routeIndex] as
    | RecordValue
    | undefined;
  return { editedAccount, editedRoute };
}

function managedAgentConfiguration(agent: RecordValue | null): ManagedAgentConfigurationValue {
  const record = agent ?? EMPTY_RECORD;
  return {
    provider: stringField(record, "provider") ?? "",
    model: stringField(record, "model") ?? "",
    mode: stringField(record, "mode") ?? "",
    thinkingOptionId: stringField(record, "thinkingOptionId") ?? "",
    featureValues: objectField(record, "featureValues") ?? EMPTY_RECORD,
  };
}

/** What the Route form's Connection picker points at. */
type RouteDestination = { kind: "account"; key: string } | { kind: "connection"; id: string };

const ACCOUNT_DESTINATION = "account:";
const CONNECTION_DESTINATION = "connection:";

function routeDestinationValue(destination: RouteDestination): string {
  return destination.kind === "account"
    ? `${ACCOUNT_DESTINATION}${destination.key}`
    : `${CONNECTION_DESTINATION}${destination.id}`;
}

/** What the picked Connection means for the save: a new account, or a Route on one. */
function routeDestinationState(
  isEditing: boolean,
  editedAccountKey: string | null,
  destination: RouteDestination | null,
): {
  configurationKind: ConfigurationKind;
  existingAccountKey: string | null;
  connectionId: string | null;
  destinationValue: string | null;
} {
  const newConnection = !isEditing && destination?.kind === "connection";
  return {
    configurationKind: newConnection ? "account" : "route",
    existingAccountKey:
      editedAccountKey ?? (destination?.kind === "account" ? destination.key : null),
    connectionId: destination?.kind === "connection" ? destination.id : null,
    destinationValue: destination === null ? null : routeDestinationValue(destination),
  };
}

function parseRouteDestination(value: string | null): RouteDestination | null {
  if (value?.startsWith(ACCOUNT_DESTINATION))
    return { kind: "account", key: value.slice(ACCOUNT_DESTINATION.length) };
  if (value?.startsWith(CONNECTION_DESTINATION))
    return { kind: "connection", id: value.slice(CONNECTION_DESTINATION.length) };
  return null;
}

/**
 * Every Connection a Route can go on: the ones that already have Routes, then
 * (for an Organization Admin) the channel Connections with none yet. A
 * Connection Admin only ever sees their own.
 */
function routeDestinationOptions(
  accounts: readonly RecordValue[],
  connections: readonly { id: string; provider: string; name: string }[],
  adminScoped: boolean,
  /** An Automation input draft is for one channel; only its Connections are offered. */
  provider?: string,
): SelectFieldOption<string>[] {
  const onChannel = (channel: string | null) => provider === undefined || channel === provider;
  const used = new Set(accounts.map((account) => stringField(account, "connectionId")));
  const existing = accounts
    .filter((account) => onChannel(stringField(account, "channel")))
    .map((account) => {
      const connection = connections.find(({ id }) => id === stringField(account, "connectionId"));
      const count = arrayField(account, "routes").length;
      const routes = `${String(count)} Route${count === 1 ? "" : "s"}`;
      const value = routeDestinationValue({ kind: "account", key: channelAccountKey(account) });
      return {
        id: value,
        value,
        label: channelAccountLabel(account),
        description: connection === undefined ? routes : `${connection.name} · ${routes}`,
      };
    });
  if (adminScoped) return existing;
  const unused = connections
    .filter(({ id, provider: channel }) => !used.has(id) && onChannel(channel))
    .map((connection) => {
      const value = routeDestinationValue({ kind: "connection", id: connection.id });
      return {
        id: value,
        value,
        label: `${channelLabel(connection.provider)} · ${connection.name}`,
        description: "No Routes yet",
      };
    });
  return [...existing, ...unused];
}

/** A first Route's default name: the Connection's name as an id, unique on its channel. */
function suggestedChannelAccountId(
  accounts: readonly RecordValue[],
  connection: { provider: string; name: string } | undefined,
): string {
  if (connection === undefined) return "";
  const base =
    connection.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || connection.provider;
  const taken = new Set(
    accounts
      .filter((account) => stringField(account, "channel") === connection.provider)
      .map((account) => stringField(account, "accountId")),
  );
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}-${String(suffix)}`;
  return candidate;
}

function channelFormSelection(input: {
  existingAccounts: RecordValue[];
  existingAccountKey: string | null;
  connections: Array<{ id: string; provider: string }>;
  configurationKind: ConfigurationKind;
  connectionId: string | null;
  accountId: string;
}) {
  const selectedAccount = input.existingAccounts.find(
    (account) => channelAccountKey(account) === input.existingAccountKey,
  );
  const selectedConnectionId =
    input.configurationKind === "account"
      ? input.connectionId
      : stringField(selectedAccount, "connectionId");
  const selectedConnection = input.connections.find(
    (connection) => connection.id === selectedConnectionId,
  );
  const existingAccountId = stringField(selectedAccount, "accountId") ?? "";
  return {
    selectedAccount,
    selectedConnection,
    effectiveAccountId:
      input.configurationKind === "account" ? input.accountId.trim() : existingAccountId,
    observedAccountChannel: stringField(selectedAccount, "channel"),
    observedAccountId: stringField(selectedAccount, "accountId"),
  };
}

/** The minutes field only blocks saving while it is shown. */
function isFollowUpTtlDraftValid(input: {
  dmOnly: boolean;
  behavior: ChannelRouteBehavior;
  draft: string;
}): boolean {
  const shown =
    !input.dmOnly && input.behavior.requireMention && input.behavior.followUpMode === "auto";
  return !shown || parseChannelFollowUpTtlMinutes(input.draft) !== null;
}

function canSaveChannelRoute(input: {
  followUpTtlValid: boolean;
  conversationValid: boolean;
  selectedConnection: { id: string } | undefined;
  effectiveAccountId: string;
  configurationKind: ConfigurationKind;
  selectedAccount: RecordValue | undefined;
  routeCondition: RouteCondition;
  contains: string;
  audienceComplete: boolean;
  parsedRouteLimits: ReturnType<typeof parseChannelLimitsDraft>;
  /** The target the Route keeps (a Connection Admin's edit), or null when the form builds one. */
  existingTarget: RecordValue | null;
  target: RouteTarget;
  automationName: string | null;
  daemonId: string | null;
  projectId: string | null;
  cwd: string;
  workspaceValid: boolean;
  provider: string;
  providerOptionsValid: boolean;
}): boolean {
  if (input.effectiveAccountId.length === 0) return false;
  if (input.configurationKind === "route" && input.selectedAccount === undefined) return false;
  if (input.configurationKind === "account" && input.selectedConnection === undefined) return false;
  if (!input.parsedRouteLimits.valid) return false;
  if (!input.followUpTtlValid || !input.audienceComplete) return false;
  if (!input.conversationValid) return false;
  if (input.routeCondition === "contains" && input.contains.trim().length === 0) return false;
  if (input.existingTarget !== null) return true;
  if (input.target === "automation") return input.automationName !== null;
  return (
    input.daemonId !== null &&
    input.projectId !== null &&
    input.cwd.trim().length > 0 &&
    input.workspaceValid &&
    input.provider.trim().length > 0 &&
    input.providerOptionsValid
  );
}

/** The Route keeps its target when the form was not allowed to rebuild one. */
function formRouteTarget(
  existingTarget: RecordValue | null,
  form: Parameters<typeof buildRouteTarget>[0],
): ChannelRouteTarget | null {
  if (existingTarget !== null) return { kind: "existing", route: existingTarget };
  return buildRouteTarget(form);
}

function buildRouteTarget(input: {
  target: RouteTarget;
  automationName: string | null;
  daemonId: string | null;
  projectId: string | null;
  cwd: string;
  worktree: ReturnType<typeof worktreeTargetFromConfiguration>;
  agentConfiguration: ManagedAgentConfigurationValue;
  parsedProviderOptions: ReturnType<typeof parseOptionalObject>;
}): ChannelRouteTarget | null {
  if (input.target === "automation") {
    if (input.automationName === null) return null;
    return { kind: "automation", automationName: input.automationName };
  }
  if (input.daemonId === null || input.projectId === null || !input.parsedProviderOptions.valid) {
    return null;
  }
  const target: Extract<ChannelRouteTarget, { kind: "agent" }> = {
    kind: "agent",
    daemonId: input.daemonId,
    projectId: input.projectId,
    cwd: input.cwd,
    provider: input.agentConfiguration.provider,
    model: input.agentConfiguration.model,
    mode: input.agentConfiguration.mode,
    thinkingOptionId: input.agentConfiguration.thinkingOptionId,
  };
  if (input.worktree !== undefined) target.worktree = input.worktree;
  if (Object.keys(input.agentConfiguration.featureValues).length > 0) {
    target.featureValues = input.agentConfiguration.featureValues;
  }
  if (input.parsedProviderOptions.value !== undefined) {
    target.options = input.parsedProviderOptions.value;
  }
  return target;
}

function routeConfirmationTitle(
  open: boolean,
  approvalChoice: RouteApprovalChoice,
  isEditing: boolean,
): string {
  if (open) return "Open this Route to anyone in the matching conversations?";
  if (approvalChoice === "auto-allow") return "Accept every permission request automatically?";
  return isEditing ? "Save Route?" : "Activate Route?";
}

function routeTargetReviewLabel(
  target: RouteTarget,
  automationName: string | null,
  agent: ManagedAgentConfigurationValue,
): string {
  if (target === "automation") return `Automation · ${automationName ?? "Unavailable"}`;
  const model = agent.model.length > 0 ? ` / ${agent.model}` : "";
  return `Agent · ${agent.provider}${model}`;
}

function channelFormSubmitLabel(isEditing: boolean): string {
  return isEditing ? "Save Route" : "Activate Route";
}

function parseOptionalObject(
  value: string,
): { valid: true; value?: Record<string, unknown> } | { valid: false } {
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

function formatOptionalObject(value: RecordValue | null): string {
  return value === null || Object.keys(value).length === 0 ? "" : JSON.stringify(value, null, 2);
}

const styles = StyleSheet.create((theme) => ({
  hidden: { display: "none" },
  testPreview: {
    gap: theme.spacing[4],
  },
  testMessageSection: {
    gap: theme.spacing[2],
  },
  testMessage: {
    padding: theme.spacing[3],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  stackedRow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing[3],
  },
  stackedRowContent: {
    flex: 0,
    marginRight: 0,
  },
  routeRow: {
    paddingLeft: theme.spacing[6],
    flexWrap: "wrap",
  },
  routeContent: {
    flexBasis: 256,
  },
  // The Route's summary lines are a stretched column: anything that should size
  // to its own content says so here.
  routeInline: {
    alignSelf: "flex-start",
    marginTop: theme.spacing[1],
  },
  routeWarnings: {
    alignItems: "stretch",
    gap: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  accountRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  accountSelect: {
    flexBasis: 240,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  accountConnect: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: theme.spacing[3],
  },
  accountOr: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  revisionLine: {
    alignItems: "baseline",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  revisionTime: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  channelTitle: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  reviewList: {
    gap: theme.spacing[3],
  },
  reviewFact: {
    gap: theme.spacing[0.5],
  },
  reviewLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  reviewValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  formHeading: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  statusPanel: { flexDirection: "column", alignItems: "flex-start", gap: theme.spacing[2] },
  formActions: {
    gap: theme.spacing[2],
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: 12,
  },
}));

function AutomationInputSection({
  embedded,
  children,
  trailing,
}: {
  embedded: boolean;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return embedded ? (
    <View>{children}</View>
  ) : (
    <SettingsSection title="Inputs" trailing={trailing}>
      {children}
    </SettingsSection>
  );
}
