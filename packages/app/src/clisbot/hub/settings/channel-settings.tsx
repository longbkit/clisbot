import { AutomationInputDraftContext } from "./automation-input-draft";
import { useContext } from "react";
import { AutomationReplyNavigationContext } from "./automation-reply-navigation";
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
import { ArrowUp, ArrowDown } from "lucide-react-native";
import { ChannelActionsMenu } from "./channel-actions-menu";
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
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { ConfirmationProvider, useConfirmation } from "@/components/confirmation-provider";
import { useHubAccount } from "../account-provider";
import { HubApiError } from "../api-client";
import { hubResourceQueryKey } from "../query-keys";
import {
  CHANNEL_ROUTE_TARGET_VALUES,
  channelMembersAudienceLabel,
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
  DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS,
  hasRequiredChannelConversationIds,
  insertChannelRoute,
  parseChannelConfigurationYaml,
  replaceChannelRouteCandidate,
  type ChannelConfigurationRecord,
  type ChannelRouteBehavior,
  type ChannelRouteLimits,
  type ChannelRouteMatchKind,
  type ChannelRouteTarget,
} from "../channel-configuration";
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
import { ChannelActivity, initialChannelActivityState } from "./channel-activity";
import { AddChannelConnection } from "./channel-connection-add";
import { ChannelCatalogView } from "./channel-catalog-view";
import { ChannelPairingPanel } from "./channel-pairing-panel";
import { ChannelQrLinkPanel } from "./channel-qr-link-panel";
import { CHANNEL_QR_OPERATIONS_AVAILABLE, useChannelQrVerbs } from "./channel-qr-verbs";
import { ChannelOperationsView } from "./channel-operations-view";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useHubSettingsDetailScroll } from "./detail-scroll";
import { ConversationSelectionFields } from "./conversation-picker-field";
import { DaemonProjectField } from "./daemon-project-field";
import {
  ManagedAgentConfigurationFields,
  type ManagedAgentConfigurationValue,
} from "./managed-agent-configuration-fields";
import { ManagedWorkspaceFields } from "./managed-workspace-fields";
import {
  isWorkspaceConfigurationValid,
  workspaceConfigurationFromTarget,
  worktreeTargetFromConfiguration,
} from "../workspace-configuration";
import { type AutomationConnection, SingleAgentAutomationForm } from "./automation-settings";

type RecordValue = ChannelConfigurationRecord;
type RouteTarget = "agent" | "automation";
type MatchKind = ChannelRouteMatchKind;
type RouteCondition = "all" | "contains";
type RouteAudience = "members" | "conversationParticipants";
type RouteApprovalChoice = NonNullable<ChannelRouteBehavior["approvalMode"]> | "custom";
type RouteLimitsDraft = Record<keyof ChannelRouteLimits, string>;
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
const MATCH_KIND_VALUES = ["dm", "channel", "thread", "group", "topic"];
const CONVERSATION_SCOPE_VALUES = ["specific", "all"];
const CONVERSATION_SCOPE_LABELS = {
  specific: "Selected conversations",
  all: "Any matching conversation",
};
const ROUTE_CONDITION_VALUES = ["all", "contains"];
const ROUTE_CONDITION_LABELS = {
  all: "Every eligible message",
  contains: "Message contains…",
};
const ROUTE_AUDIENCE_VALUES = ["members", "conversationParticipants"];
const ROUTE_AUDIENCE_LABELS = {
  members: "Members with access",
  conversationParticipants: "Anyone in matching conversations",
};
const ROUTE_TARGET_LABELS = {
  automation: "Run an Automation",
  agent: "Start or continue an Agent",
};
const OUTBOUND_PATH_VALUES = ["relay", "tool"];
const OUTBOUND_PATH_LABELS = {
  relay: "Text forward",
  tool: "Use Channel tool",
};
const APPROVAL_VALUES = ["require", "auto-deny", "auto-allow"];
const CUSTOM_APPROVAL_VALUES = ["custom", ...APPROVAL_VALUES];
const APPROVAL_LABELS = {
  custom: "Custom YAML",
  require: "Ask authorized members",
  "auto-deny": "Deny",
  "auto-allow": "Allow automatically",
};
interface EditingRoute {
  accountKey: string;
  routeIndex: number;
}

type ChannelEditor =
  | { kind: "account" }
  | { kind: "route"; accountKey: string }
  | { kind: "edit"; route: EditingRoute };

interface ChannelTeamGrant {
  channel: string;
  accountId: string;
  teamIds: string[];
  conversation:
    | { kind: "direct_messages" | "public_channels" }
    | { kind: "specific"; conversationIds: string[] };
}

export interface AutomationChannelScope {
  automationName: string;
}

export function ChannelSettings({
  automationName,
  embedded = false,
}: Partial<AutomationChannelScope> & { embedded?: boolean } = {}) {
  const hub = useHubAccount();
  const router = useRouter();
  const openAccount = useCallback(() => router.push(buildHubSettingsRoute("account")), [router]);
  if (hub.loading) return <Text style={settingsStyles.rowHint}>Loading Channels...</Text>;
  if (hub.signedIn?.capabilities.manageResources !== true)
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
      <ChannelSettingsContent automationName={automationName} embedded={embedded} />
    </ConfirmationProvider>
  );
}

/** Accounts is the canonical Route editor; Catalog is setup and capabilities,
 * Operations is the durable ingress queue, Activity is inbound admission. */
type ChannelView = "accounts" | "catalog" | "operations" | "activity";

const CHANNEL_VIEWS: SegmentedControlOption<ChannelView>[] = [
  { value: "accounts", label: "Accounts" },
  { value: "catalog", label: "Catalog" },
  { value: "operations", label: "Operations" },
  { value: "activity", label: "Activity" },
];

/** The views that render on their own, with no state from the accounts editor. */
const CHANNEL_SECONDARY_VIEWS: Partial<Record<ChannelView, () => ReactElement>> = {
  catalog: ChannelCatalogView,
  operations: ChannelOperationsView,
};

function ChannelSettingsContent({
  automationName,
  embedded = false,
}: Partial<AutomationChannelScope> & { embedded?: boolean }) {
  const [choosingInput, setChoosingInput] = useState(false);
  const confirmDialog = useConfirmation();
  const queryClient = useQueryClient();
  const hub = useHubAccount();
  const router = useRouter();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const hubAccountId = hub.signedIn?.account.id ?? null;
  const queryScope = {
    origin: hub.origin,
    organizationId,
    accountId: hubAccountId,
  };
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  const isInstanceOperator = hub.signedIn?.isInstanceOperator === true;
  const channelQuery = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "channel-configuration"),
    queryFn: () => hub.api().get("channel-configuration", HubChannelConfigurationSchema),
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const inputDraft = useContext(AutomationInputDraftContext);
  const channels = useMemo(
    () => ({
      ...channelQuery,
      data:
        channelQuery.data === undefined
          ? undefined
          : {
              ...channelQuery.data,
              ...(inputDraft?.draft
                ? {
                    accounts: inputDraft.draft.accounts,
                    resource: inputDraft.draft.resource,
                    policy: inputDraft.draft.policy,
                    revision:
                      inputDraft.draft.expectedRevisionId !== null && channelQuery.data.revision
                        ? {
                            ...channelQuery.data.revision,
                            id: inputDraft.draft.expectedRevisionId,
                          }
                        : null,
                  }
                : {}),
            },
    }),
    [channelQuery, inputDraft?.draft],
  );
  const yamlForm = useChannelYamlForm(channels.data);
  const connections = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "connections"),
    queryFn: () => hub.api().get("connections", HubConnectionsSchema),
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const automations = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "automations"),
    queryFn: () => hub.api().get("automations", HubAutomationsSchema),
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
  const history = useFetchQuery({
    queryKey: [...hubResourceQueryKey(queryScope, "channel-configuration"), "revisions"],
    queryFn: () => hub.api().get("channel-configuration/revisions", HubChannelRevisionsSchema),
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const runtimeStatus = useFetchQuery({
    queryKey: [...hubResourceQueryKey(queryScope, "channel-accounts"), "status"],
    queryFn: () => hub.api().get("channel-accounts/status", HubChannelRuntimeStatusSchema),
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const teams = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "teams"),
    queryFn: () => hub.api().get("teams", HubTeamsSchema),
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const assignments = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "access-assignments"),
    queryFn: () => hub.api().get("access-assignments", HubAccessAssignmentsSchema),
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [mutationPending, setPending] = useState(false);
  const pending = mutationPending || inputDraft?.pending === true;
  const [editor, setEditor] = useState<ChannelEditor | null>(null);
  const setDraftEditing = inputDraft?.setEditing;
  useEffect(() => {
    setDraftEditing?.(editor !== null);
    return () => setDraftEditing?.(false);
  }, [editor, setDraftEditing]);
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
  const scrollToTop = useHubSettingsDetailScroll();
  const usesParentScroll = !embedded && !inputDraft;
  useEffect(() => {
    if (usesParentScroll) scrollToTop?.();
  }, [editor, selectedAccountKey, channelView, scrollToTop, usesParentScroll]);

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
          expectedRevisionId: inputDraft.draft
            ? inputDraft.draft.expectedRevisionId
            : (current.revision?.id ?? null),
          grants: inputDraft.draft?.grants ?? [],
        });
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
    [channels, history, hub, runtimeStatus, queryClient, organizationId, hubAccountId, inputDraft],
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
            ? `This removes ${channel} behavior and its Routes. The provider Connection remains in use by ${remainingConsumers.map(({ name }) => name).join(", ")}.`
            : `This removes ${channel} behavior and its Routes. You can also disconnect the unused provider Connection next.`,
        confirmLabel: "Remove Channel account",
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
          title: "Disconnect unused provider account?",
          message: "This removes its saved credentials and Channel identity mappings.",
          confirmLabel: "Disconnect",
          cancelLabel: "Keep Connection",
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

  const setAccountEnabled = useCallback(
    async (account: RecordValue, enabled: boolean) => {
      await mutate(() =>
        replaceConfiguration(
          (channels.data?.accounts ?? []).map((candidate) =>
            candidate === account ? Object.assign({}, candidate, { enabled }) : candidate,
          ),
        ),
      );
    },
    [channels.data?.accounts, mutate, replaceConfiguration],
  );

  const testRoute = useCallback(
    async (account: RecordValue, route: RecordValue) => {
      const channel = stringField(account, "channel");
      const accountId = stringField(account, "accountId");
      const target = routeTestTarget(route);
      if (channel === null || accountId === null || target === null) return;
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

  const channelConnections = useMemo(
    () =>
      (connections.data?.connections ?? []).filter((connection) =>
        ["slack", "telegram"].includes(connection.provider),
      ),
    [connections.data?.connections],
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
  const openAccess = useCallback(() => {
    router.push(buildHubSettingsRoute("access"));
  }, [router]);
  const cancelRouteEdit = useCallback(() => setEditor(null), []);
  const editRoute = useCallback(
    (route: EditingRoute) => beginEdit({ kind: "edit", route }),
    [beginEdit],
  );
  const addAccount = useCallback(() => beginEdit({ kind: "account" }), [beginEdit]);
  const addRoute = useCallback(() => {
    if (selectedAccountKey !== null) beginEdit({ kind: "route", accountKey: selectedAccountKey });
  }, [selectedAccountKey, beginEdit]);
  const createRouteAutomation = useCallback(
    async (yaml: string) => {
      const created = await createAutomation(hub.api(), yaml);
      await automations.refetch();
      return created.name;
    },
    [automations, hub],
  );
  const saveChannelBehavior = useCallback(
    (accounts: RecordValue[], resource: RecordValue, teamGrant?: ChannelTeamGrant) => {
      void mutate(async () => {
        if (inputDraft) {
          if (!channels.data) throw new Error("Channel configuration is still loading.");
          inputDraft.stage({
            expectedRevisionId: inputDraft.draft
              ? inputDraft.draft.expectedRevisionId
              : editorRevisionId,
            accounts,
            resource,
            policy: channels.data.policy ?? {},
            grants: teamGrant
              ? [
                  ...(inputDraft.draft?.grants ?? []).filter(
                    (grant) =>
                      grant.channel !== teamGrant.channel ||
                      grant.accountId !== teamGrant.accountId,
                  ),
                  teamGrant,
                ]
              : (inputDraft.draft?.grants ?? []),
          });
          setEditor(null);
          return;
        }
        const currentConfiguration = queryClient.getQueryData<HubChannelConfiguration>(
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
        if (teamGrant !== undefined) {
          setSelectedAccountKey(`${teamGrant.channel}:${teamGrant.accountId}`);
          if (teamGrant.teamIds.length > 0) {
            try {
              await hub.api().post(
                "access-assignments/batch",
                {
                  assignments: teamGrant.teamIds.map((teamId) => ({
                    subjectKind: "team",
                    subjectId: teamId,
                    resourceKind: "channel_account",
                    resourceId: channelAccountResourceId(teamGrant.channel, teamGrant.accountId),
                    privileges: ["channel.use"],
                    constraints: { conversation: teamGrant.conversation },
                  })),
                },
                HubAccessAssignmentsSchema,
              );
              await assignments.refetch();
            } catch (error) {
              const detail = error instanceof Error ? error.message : "Hub request failed.";
              throw new Error(
                `Route saved, but Team access could not be updated. Open Manage access to finish sharing this Channel account. ${detail}`,
                { cause: error },
              );
            }
          }
        }
      });
    },
    [
      inputDraft,
      channels.data,
      assignments,
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

  if (editor !== null)
    return (
      <ChannelManagementSection
        key={channelFormKey(editor)}
        editor={editor}
        automationName={automationName}
        queries={[channels, connections, automations, daemons, teams]}
        retry={refreshStatus}
        error={mutationError}
        channels={channels.data}
        connections={connections.data}
        automations={automations.data}
        daemons={daemons.data}
        teams={teams.data}
        channelConnections={
          inputDraft
            ? channelConnections.filter((connection) => connection.provider === inputDraft.provider)
            : channelConnections
        }
        pending={pending}
        isInstanceOperator={isInstanceOperator}
        cancelRouteEdit={cancelRouteEdit}
        createRouteAutomation={createRouteAutomation}
        saveChannelBehavior={saveChannelBehavior}
        saveConnection={saveConnection}
      />
    );
  if (automationName !== undefined) {
    return (
      <AutomationInputSection
        embedded={embedded}
        trailing={
          !embedded && !inputDraft ? (
            <Button size="sm" variant="outline" onPress={() => setChoosingInput(!choosingInput)}>
              {choosingInput ? "Cancel" : "Add input"}
            </Button>
          ) : undefined
        }
      >
        <QueryFeedback queries={[channels, connections, automations]} />
        {mutationError ? <Alert variant="error" title={mutationError} /> : null}
        {testResult ? <Alert variant="success" title={testResult} /> : null}
        {!inputDraft &&
        !choosingInput &&
        channels.data &&
        !channels.data.accounts.some(
          (account) =>
            arrayField(account, "routes").some(
              (route) => (route as RecordValue).workflow === automationName,
            ) || objectField(account, "fallback")?.workflow === automationName,
        ) ? (
          <Text style={settingsStyles.rowHint}>No Channel inputs configured.</Text>
        ) : null}
        {(channels.data?.accounts ?? [])
          .filter((account) =>
            inputDraft
              ? account.channel === inputDraft.provider
              : choosingInput ||
                arrayField(account, "routes").some(
                  (route) => (route as RecordValue).workflow === automationName,
                ) ||
                objectField(account, "fallback")?.workflow === automationName,
          )
          .map((account) => (
            <AutomationChannelAccount
              key={channelAccountKey(account)}
              account={account}
              choosing={Boolean(inputDraft) || choosingInput}
              automationName={automationName}
              pending={pending}
              editRoute={editRoute}
              addRoute={beginEdit}
              moveRoute={moveRoute}
              runtimes={inputDraft ? [] : (runtimeStatus.data?.accounts ?? [])}
              removeRoute={removeRoute}
              testRoute={testRoute}
            />
          ))}
        {choosingInput || inputDraft ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || channels.data === undefined}
            onPress={addAccount}
          >
            Connect a new account
          </Button>
        ) : null}
      </AutomationInputSection>
    );
  }
  const navigation = (
    <SettingsSection title="Channels">
      <SegmentedControl
        options={CHANNEL_VIEWS}
        value={channelView}
        onValueChange={setChannelView}
        size="sm"
      />
    </SettingsSection>
  );
  const SecondaryView = CHANNEL_SECONDARY_VIEWS[channelView];
  if (SecondaryView !== undefined)
    return (
      <View>
        {navigation}
        <SecondaryView />
      </View>
    );
  if (channelView === "activity")
    return (
      <View>
        {navigation}
        <ChannelActivity
          accounts={channels.data?.accounts}
          connections={connections.data?.connections}
          state={activityState}
          onChange={setActivityState}
        />
      </View>
    );
  return (
    <View>
      {navigation}
      <ChannelAccountsSection
        channels={channels.data}
        connections={connections.data}
        runtimeStatus={runtimeStatus.data}
        teams={teams.data}
        assignments={assignments.data}
        queries={[channels, connections, runtimeStatus, teams, assignments]}
        refreshing={connections.isFetching || runtimeStatus.isFetching}
        mutationError={mutationError}
        testResult={testResult}
        selectedAccountKey={selectedAccountKey}
        canManage={canManage}
        pending={pending}
        refreshStatus={refreshStatus}
        selectAccount={setSelectedAccountKey}
        setAccountEnabled={setAccountEnabled}
        removeAccount={removeAccount}
        openAccess={openAccess}
        retryAccount={retryAccount}
        editRoute={editRoute}
        addAccount={addAccount}
        addRoute={addRoute}
        openActivity={openAccountActivity}
        testRoute={testRoute}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
      />
      {selectedAccountKey === null ? (
        <ChannelRevisionHistory
          revisions={history.data?.revisions}
          activeRevisionId={channels.data?.revision?.id}
        />
      ) : null}
      <AdvancedConfigurationSection
        model={yamlForm}
        error={mutationError}
        channels={channels.data}
        pending={pending}
        validate={validateAdvancedConfiguration}
        save={saveAdvancedConfiguration}
      />
    </View>
  );
}

function AutomationChannelAccount({
  choosing,
  account,
  automationName,
  pending,
  editRoute,
  addRoute,
  removeRoute,
  testRoute,
  moveRoute,
  runtimes,
}: {
  choosing: boolean;
  runtimes: HubRuntimeAccount[];
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  account: RecordValue;
  automationName: string;
  pending: boolean;
  editRoute(route: EditingRoute): void;
  addRoute(editor: ChannelEditor): void;
  removeRoute(account: RecordValue, index: number): Promise<void>;
  testRoute(account: RecordValue, route: RecordValue): Promise<void>;
}) {
  const add = useCallback(
    () => addRoute({ kind: "route", accountKey: channelAccountKey(account) }),
    [account, addRoute],
  );
  const routes = arrayField(account, "routes") as RecordValue[];
  return (
    <View style={settingsStyles.card}>
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.rowTitle}>{channelAccountLabel(account)}</Text>
        {choosing ? (
          <Button size="sm" variant="outline" disabled={pending} onPress={add}>
            Use this connection
          </Button>
        ) : null}
      </View>
      <ChannelAccountRouteList
        visible
        account={account}
        accountKey={channelAccountKey(account)}
        routes={routes}
        enabled={account.enabled !== false}
        runtime={runtimes.find(
          (runtime) => runtime.channel === account.channel && runtime.account === account.accountId,
        )}
        canManage
        pending={pending}
        editRoute={editRoute}
        testRoute={testRoute}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
        automationName={automationName}
      />
      {objectField(account, "fallback")?.workflow === automationName ? (
        <Text style={settingsStyles.rowHint}>
          Fallback invokes this Automation. Edit fallback in Channels advanced configuration.
        </Text>
      ) : null}
    </View>
  );
}

function ChannelRouteEditorHeader({
  backLabel = "Back to Channels",
  pending,
  error,
  back,
}: {
  pending: boolean;
  error: string | null;
  back(): void;
  backLabel?: string;
}) {
  return (
    <SettingsSection title="Route details">
      <Button size="sm" variant="outline" disabled={pending} onPress={back}>
        {backLabel}
      </Button>
      {error ? <Alert variant="error" title={error} /> : null}
    </SettingsSection>
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
  canManage,
  pending,
  refreshStatus,
  selectAccount,
  setAccountEnabled,
  removeAccount,
  openAccess,
  retryAccount,
  editRoute,
  addAccount,
  addRoute,
  openActivity,
  testRoute,
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
  canManage: boolean;
  pending: boolean;
  refreshStatus(): void;
  selectAccount(key: string | null): void;
  setAccountEnabled(account: RecordValue, enabled: boolean): Promise<void>;
  removeAccount(account: RecordValue): Promise<void>;
  openAccess(): void;
  retryAccount(account: RecordValue): Promise<void>;
  editRoute(route: EditingRoute): void;
  addAccount(): void;
  addRoute(): void;
  openActivity(): void;
  testRoute(account: RecordValue, route: RecordValue): Promise<void>;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  return (
    <SettingsSection title="Channel accounts">
      <QueryFeedback queries={queries} />
      <View style={styles.actions}>
        {canManage ? (
          <Button
            size="sm"
            disabled={pending}
            onPress={selectedAccountKey === null ? addAccount : addRoute}
          >
            {selectedAccountKey === null ? "Add Channel account" : "Add Route"}
          </Button>
        ) : null}
        <Button size="xs" variant="outline" disabled={refreshing} onPress={refreshStatus}>
          Refresh status
        </Button>
        <Button size="sm" variant="ghost" onPress={openActivity}>
          View activity
        </Button>
      </View>
      {mutationError ? <Alert variant="error" title={mutationError} /> : null}
      {testResult ? <Alert variant="success" title={testResult} /> : null}
      <ChannelAccountList
        accounts={channels?.accounts ?? []}
        connections={connections?.connections ?? []}
        runtimes={runtimeStatus?.accounts ?? []}
        runtimeAvailable={runtimeStatus?.runtimeAvailable}
        assignments={assignments?.assignments}
        teams={teams?.teams ?? []}
        revisionVersion={channels?.revision?.version}
        selectedAccountKey={selectedAccountKey}
        canManage={canManage}
        pending={pending}
        selectAccount={selectAccount}
        setAccountEnabled={setAccountEnabled}
        removeAccount={removeAccount}
        openAccess={openAccess}
        retryAccount={retryAccount}
        editRoute={editRoute}
        testRoute={testRoute}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
      />
    </SettingsSection>
  );
}

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
  cancelRouteEdit(): void;
  createRouteAutomation(yaml: string): Promise<string>;
  saveChannelBehavior(
    accounts: RecordValue[],
    resource: RecordValue,
    teamGrant?: ChannelTeamGrant,
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
  const accountKey = editor.kind === "route" ? editor.accountKey : null;
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
          backLabel={automationName ? "Back to Automation inputs" : undefined}
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
        backLabel={automationName ? "Back to Automation inputs" : undefined}
        pending={pending || connectionPending}
        error={error}
        back={cancelRouteEdit}
      />
      <QueryFeedback queries={queries} />
      <View style={addingConnection ? styles.hidden : undefined}>
        {editor.kind === "account" ? (
          <Button size="sm" variant="outline" disabled={pending} onPress={openConnection}>
            Connect a provider account
          </Button>
        ) : null}
        <ChannelAccountForm
          automationName={automationName}
          connections={channelConnections}
          automationConnections={connections.connections}
          automations={automations.automations}
          daemons={daemons.daemons}
          teams={teams.teams}
          resource={channels.resource ?? EMPTY_RECORD}
          existingAccounts={channels.accounts}
          editing={editing}
          initialAccountKey={accountKey}
          createdConnectionId={createdConnectionId}
          pending={pending}
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
          <Button variant="outline" disabled={connectionPending} onPress={closeConnection}>
            Back to Channel account
          </Button>
        </View>
      ) : null}
    </>
  );
}

function channelFormKey(editor: ChannelEditor): string {
  if (editor.kind === "edit")
    return `${editor.route.accountKey}:${String(editor.route.routeIndex)}`;
  if (editor.kind === "route") return `add-route:${editor.accountKey}`;
  return "add-account";
}

function ChannelAccountList({
  accounts,
  connections,
  runtimes,
  runtimeAvailable,
  assignments,
  teams,
  revisionVersion,
  selectedAccountKey,
  canManage,
  pending,
  selectAccount,
  setAccountEnabled,
  removeAccount,
  openAccess,
  retryAccount,
  editRoute,
  testRoute,
  moveRoute,
  removeRoute,
}: {
  accounts: RecordValue[];
  connections: HubConnection[];
  runtimes: HubRuntimeAccount[];
  runtimeAvailable: boolean | undefined;
  assignments: HubAssignment[] | undefined;
  teams: HubTeam[];
  revisionVersion: number | undefined;
  selectedAccountKey: string | null;
  canManage: boolean;
  pending: boolean;
  selectAccount(key: string | null): void;
  setAccountEnabled(account: RecordValue, enabled: boolean): Promise<void>;
  removeAccount(account: RecordValue): Promise<void>;
  openAccess(): void;
  retryAccount(account: RecordValue): Promise<void>;
  editRoute(route: EditingRoute): void;
  testRoute(account: RecordValue, route: RecordValue): Promise<void>;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  if (accounts.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <EmptyRow message="No Channel accounts are configured." />
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
            assignments={assignments}
            teams={teams}
            revisionVersion={revisionVersion}
            selected={selectedAccountKey === channelAccountKey(account)}
            canManage={canManage}
            pending={pending}
            selectAccount={selectAccount}
            setAccountEnabled={setAccountEnabled}
            removeAccount={removeAccount}
            openAccess={openAccess}
            retryAccount={retryAccount}
            editRoute={editRoute}
            testRoute={testRoute}
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
  assignments,
  teams,
  revisionVersion,
  selected,
  canManage,
  pending,
  selectAccount,
  setAccountEnabled,
  removeAccount,
  openAccess,
  retryAccount,
  editRoute,
  testRoute,
  moveRoute,
  removeRoute,
}: {
  account: RecordValue;
  index: number;
  connections: HubConnection[];
  runtimes: HubRuntimeAccount[];
  runtimeAvailable: boolean | undefined;
  assignments: HubAssignment[] | undefined;
  teams: HubTeam[];
  revisionVersion: number | undefined;
  selected: boolean;
  canManage: boolean;
  pending: boolean;
  selectAccount(key: string | null): void;
  setAccountEnabled(account: RecordValue, enabled: boolean): Promise<void>;
  removeAccount(account: RecordValue): Promise<void>;
  openAccess(): void;
  retryAccount(account: RecordValue): Promise<void>;
  editRoute(route: EditingRoute): void;
  testRoute(account: RecordValue, route: RecordValue): Promise<void>;
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
  const toggleSelected = useCallback(() => {
    selectAccount(selected ? null : key);
  }, [key, selectAccount, selected]);
  const toggleEnabled = useCallback(
    (value: boolean) => {
      void setAccountEnabled(account, value);
    },
    [account, setAccountEnabled],
  );
  const remove = useCallback(() => {
    void removeAccount(account);
  }, [account, removeAccount]);

  return (
    <View style={index > 0 ? settingsStyles.rowBorder : null}>
      <View style={[settingsStyles.row, styles.row, compact && styles.stackedRow]}>
        <View style={[settingsStyles.rowContent, compact && styles.stackedRowContent]}>
          <Text style={settingsStyles.rowTitle}>{`${channelLabel(channel)} · ${accountId}`}</Text>
          <Text style={settingsStyles.rowHint}>
            {channelAccountStatus(enabled, runtimeAvailable, runtime, connection, routes.length)}
          </Text>
        </View>
        {canManage ? (
          <View style={styles.actions}>
            <Button
              size="xs"
              variant={selected ? "secondary" : "outline"}
              disabled={pending}
              onPress={toggleSelected}
            >
              {selected ? "Back to accounts" : "Manage"}
            </Button>
            <Switch
              value={enabled}
              onValueChange={toggleEnabled}
              disabled={pending}
              accessibilityLabel={`${enabled ? "Disable" : "Enable"} ${accountId}`}
            />
            <ChannelActionsMenu
              label={`Actions for ${accountId}`}
              disabled={pending}
              remove={remove}
            />
          </View>
        ) : null}
      </View>
      <ChannelAccountDetails
        visible={selected}
        account={account}
        channel={channel}
        accountId={accountId}
        connection={connection}
        runtime={runtime}
        runtimeAvailable={runtimeAvailable}
        assignments={assignments}
        teams={teams}
        revisionVersion={revisionVersion}
        enabled={enabled}
        pending={pending}
        openAccess={openAccess}
        retryAccount={retryAccount}
      />
      <ChannelAccountRouteList
        visible={selected}
        account={account}
        accountKey={key}
        routes={routes}
        enabled={enabled}
        runtime={runtime}
        canManage={canManage}
        pending={pending}
        editRoute={editRoute}
        testRoute={testRoute}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
      />
    </View>
  );
}

function ChannelAccountDetails({
  visible,
  account,
  channel,
  accountId,
  connection,
  runtime,
  runtimeAvailable,
  assignments,
  teams,
  revisionVersion,
  enabled,
  pending,
  openAccess,
  retryAccount,
}: {
  visible: boolean;
  account: RecordValue;
  channel: string;
  accountId: string;
  connection: HubConnection | undefined;
  runtime: HubRuntimeAccount | undefined;
  runtimeAvailable: boolean | undefined;
  assignments: HubAssignment[] | undefined;
  teams: HubTeam[];
  revisionVersion: number | undefined;
  enabled: boolean;
  pending: boolean;
  openAccess(): void;
  retryAccount(account: RecordValue): Promise<void>;
}) {
  const [showRuntimeDetails, setShowRuntimeDetails] = useState(false);
  const toggleRuntimeDetails = useCallback(() => setShowRuntimeDetails((value) => !value), []);
  const [showAccess, setShowAccess] = useState(false);
  const toggleAccess = useCallback(() => setShowAccess((value) => !value), []);
  const [showLinking, setShowLinking] = useState(false);
  const toggleLinking = useCallback(() => setShowLinking((value) => !value), []);
  const router = useRouter();
  const openConfiguration = useCallback(
    () => router.push(buildHubSettingsRoute("configuration")),
    [router],
  );
  if (!visible) return null;
  return (
    <View style={settingsStyles.rowBorder}>
      <ChannelAccountActions
        account={account}
        connection={connection}
        runtime={runtime}
        runtimeAvailable={runtimeAvailable}
        enabled={enabled}
        pending={pending}
        showingAccess={showAccess}
        showingRuntimeDetails={showRuntimeDetails}
        showingLinking={showLinking}
        toggleAccess={toggleAccess}
        toggleRuntimeDetails={toggleRuntimeDetails}
        toggleLinking={toggleLinking}
        openConfiguration={openConfiguration}
        retryAccount={retryAccount}
      />
      {runtime?.detail ? (
        <View style={settingsStyles.row}>
          <Text style={styles.errorText}>{runtime.detail}</Text>
        </View>
      ) : null}
      {showLinking ? <ChannelAccountQrLinking channel={channel} accountId={accountId} /> : null}
      {showAccess ? (
        <ChannelAccountAccess
          channel={channel}
          accountId={accountId}
          connection={connection}
          assignments={assignments}
          teams={teams}
          pending={pending}
          openAccess={openAccess}
        />
      ) : null}
      {showRuntimeDetails ? (
        <View style={settingsStyles.row}>
          <Text
            style={settingsStyles.rowHint}
          >{`Configuration revision ${revisionVersion ?? "—"} · Integrity ${runtime?.integrity ?? "not checked"} · Load ${runtime?.loadTrace ?? "not loaded"}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The account's row of runtime actions. What is on offer is entirely the Hub's
 * report: an unconnected Connection, an account waiting to be linked, or a
 * transport that is not running. */
function ChannelAccountActions({
  account,
  connection,
  runtime,
  runtimeAvailable,
  enabled,
  pending,
  showingAccess,
  showingRuntimeDetails,
  showingLinking,
  toggleAccess,
  toggleRuntimeDetails,
  toggleLinking,
  openConfiguration,
  retryAccount,
}: {
  account: RecordValue;
  connection: HubConnection | undefined;
  runtime: HubRuntimeAccount | undefined;
  runtimeAvailable: boolean | undefined;
  enabled: boolean;
  pending: boolean;
  showingAccess: boolean;
  showingRuntimeDetails: boolean;
  showingLinking: boolean;
  toggleAccess(): void;
  toggleRuntimeDetails(): void;
  toggleLinking(): void;
  openConfiguration(): void;
  retryAccount(account: RecordValue): Promise<void>;
}) {
  const retry = useCallback(() => {
    void retryAccount(account);
  }, [account, retryAccount]);
  const connected = connection?.status === "connected";
  // The Hub reports `needs-login` for a QR-auth account whose profile has no live
  // session. That is the whole signal: nothing else says an account is linkable.
  const needsLinking = runtime?.transport === "needs-login";
  const canRetry = connected && enabled && runtime?.transport !== "started";
  return (
    <View style={[settingsStyles.row, styles.actions]}>
      <Button size="sm" variant="ghost" onPress={toggleAccess}>
        {showingAccess ? "Hide access" : "Who can use this?"}
      </Button>
      <Button size="sm" variant="ghost" onPress={toggleRuntimeDetails}>
        {showingRuntimeDetails ? "Hide status details" : "Status details"}
      </Button>
      {needsLinking ? (
        <Button size="sm" variant="secondary" disabled={pending} onPress={toggleLinking}>
          {showingLinking ? "Hide linking" : "Link with QR"}
        </Button>
      ) : null}
      {connected || needsLinking ? null : (
        <Button size="sm" variant="outline" disabled={pending} onPress={openConfiguration}>
          Manage Connection
        </Button>
      )}
      {canRetry ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending || runtimeAvailable === false}
          onPress={retry}
        >
          Retry runtime
        </Button>
      ) : null}
    </View>
  );
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

function ChannelAccountAccess({
  channel,
  accountId,
  connection,
  assignments,
  teams,
  pending,
  openAccess,
}: {
  channel: string;
  accountId: string;
  connection: HubConnection | undefined;
  assignments: HubAssignment[] | undefined;
  teams: HubTeam[];
  pending: boolean;
  openAccess(): void;
}) {
  const router = useRouter();
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
  const access = (assignments ?? []).filter(
    (assignment) =>
      assignment.resourceKind === "channel_account" &&
      assignment.resourceId === channelAccountResourceId(channel, accountId),
  );
  const teamNames = access.flatMap((assignment) => {
    if (assignment.subjectKind !== "team") return [];
    const team = teams.find(({ id }) => id === assignment.subjectId);
    return team === undefined ? [] : [team.name];
  });
  const canLinkIdentity = connection?.canLinkIdentity === true;
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Who can use this Channel account?</Text>
        <Text style={settingsStyles.rowHint}>
          Each Route chooses its audience. Members with access requires a linked Channel identity.
          Owners have access automatically; other Members need a matching grant. Anyone in
          conversation admits participants without a Member grant.
        </Text>
        <Text style={settingsStyles.rowHint}>
          {assignments === undefined
            ? "Access information is not loaded yet. Refresh status to retry."
            : channelAccessStatus(teamNames, access.length)}
        </Text>
        <ChannelPairingPanel channel={channel} accountId={accountId} disabled={pending} />
        <View style={styles.actions}>
          {canLinkIdentity ? (
            <Button size="sm" variant="outline" disabled={pending} onPress={openIdentity}>
              Your Channel identities
            </Button>
          ) : null}
          <Button size="sm" variant="outline" disabled={pending} onPress={openAccess}>
            Manage access
          </Button>
        </View>
      </View>
    </View>
  );
}

function ChannelAccountRouteList({
  automationName,
  visible,
  account,
  accountKey,
  routes,
  enabled,
  runtime,
  canManage,
  pending,
  editRoute,
  testRoute,
  moveRoute,
  removeRoute,
}: {
  automationName?: string;
  visible: boolean;
  account: RecordValue;
  accountKey: string;
  routes: RecordValue[];
  enabled: boolean;
  runtime: HubRuntimeAccount | undefined;
  canManage: boolean;
  pending: boolean;
  editRoute(route: EditingRoute): void;
  testRoute(account: RecordValue, route: RecordValue): Promise<void>;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  const hub = useHubAccount();
  const channel = stringField(account, "channel");
  const accountId = stringField(account, "accountId");
  const organizationId = hub.signedIn?.organization.id ?? "";
  const metadata = useFetchQuery({
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
    enabled: visible && organizationId.length > 0 && channel !== null && accountId !== null,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  if (!visible) return null;
  if (routes.length === 0) {
    return <EmptyRow message="No Routes are configured for this Channel account." />;
  }
  return routes.map((route, routeIndex) =>
    automationName !== undefined && route.workflow !== automationName ? null : (
      <ChannelRouteRow
        key={`${accountKey}:route:${String(routeIndex)}`}
        automationScoped={automationName !== undefined}
        account={account}
        accountKey={accountKey}
        route={route}
        metadata={metadata.data}
        routeIndex={routeIndex}
        routeCount={routes.length}
        enabled={enabled}
        runtime={runtime}
        canManage={canManage}
        pending={pending}
        editRoute={editRoute}
        testRoute={testRoute}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
      />
    ),
  );
}

function ChannelRouteRow({
  automationScoped,
  account,
  accountKey,
  route,
  metadata,
  routeIndex,
  routeCount,
  enabled,
  runtime,
  canManage,
  pending,
  editRoute,
  testRoute,
  moveRoute,
  removeRoute,
}: {
  automationScoped: boolean;
  account: RecordValue;
  accountKey: string;
  route: RecordValue;
  metadata: z.infer<typeof HubObservedChannelConversationsSchema> | undefined;
  routeIndex: number;
  routeCount: number;
  enabled: boolean;
  runtime: HubRuntimeAccount | undefined;
  canManage: boolean;
  pending: boolean;
  editRoute(route: EditingRoute): void;
  testRoute(account: RecordValue, route: RecordValue): Promise<void>;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  const compact = useIsCompactFormFactor();
  const runTest = useCallback(() => {
    void testRoute(account, route);
  }, [account, route, testRoute]);
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
        <Text style={settingsStyles.rowHint}>{routeMatchSummary(route, metadata)}</Text>
        <Text style={settingsStyles.rowHint}>{routeBehaviorSummary(route)}</Text>
      </View>
      {canManage ? (
        <View style={styles.actions}>
          {routeTestTarget(route) !== null ? (
            <Button
              size="xs"
              variant="outline"
              disabled={pending || !enabled || runtime?.transport !== "started"}
              onPress={runTest}
            >
              Send test message
            </Button>
          ) : null}
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

function ChannelRevisionHistory({
  revisions,
  activeRevisionId,
}: {
  revisions: HubRevision[] | undefined;
  activeRevisionId: string | undefined;
}) {
  let content;
  if (revisions === undefined) content = <EmptyRow message="Loading revisions…" />;
  else if (revisions.length === 0) {
    content = <EmptyRow message="No Channel configuration revision exists yet." />;
  } else {
    content = revisions.map((revision, index) => (
      <View
        key={revision.id}
        style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
      >
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {`Revision ${String(revision.version)}${revision.id === activeRevisionId ? " · Active" : ""}`}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {new Date(revision.createdAt).toLocaleString()}
          </Text>
        </View>
      </View>
    ));
  }
  return (
    <SettingsSection title="Revision history">
      <View style={settingsStyles.card}>{content}</View>
    </SettingsSection>
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
  existingAccounts,
  editing,
  initialAccountKey,
  createdConnectionId,
  pending,
  cancelEdit,
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
  existingAccounts: RecordValue[];
  editing: EditingRoute | null;
  initialAccountKey: string | null;
  createdConnectionId: string | null;
  pending: boolean;
  cancelEdit(): void;
  createRouteAutomation(yaml: string): Promise<string>;
  save(accounts: RecordValue[], resource: RecordValue, teamGrant?: ChannelTeamGrant): void;
}) {
  const inputDraft = useContext(AutomationInputDraftContext);
  const hub = useHubAccount();
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
  const configurationKind: ConfigurationKind =
    isEditing || initialAccountKey !== null ? "route" : "account";
  const existingAccountKey = initial.accountKey ?? initialAccountKey;
  const [connectionId, setConnectionId] = useState<string | null>(null);
  useEffect(() => {
    if (createdConnectionId !== null) setConnectionId(createdConnectionId);
  }, [createdConnectionId]);
  const [accountId, setAccountId] = useState("");
  const [matchKind, setMatchKind] = useState<MatchKind>(initial.matchKind);
  const [conversationIds, setConversationIds] = useState(initial.conversationIds);
  const [conversationScope, setConversationScope] = useState(
    initial.conversationIds.length > 0 || initial.audience === "conversationParticipants"
      ? "specific"
      : "all",
  );
  const [routeCondition, setRouteCondition] = useState<RouteCondition>(initial.routeCondition);
  const [audience, setAudience] = useState<RouteAudience>(initial.audience);
  const [behavior, setBehavior] = useState<ChannelRouteBehavior>(initial.behavior.behavior);
  const [approvalChoice, setApprovalChoice] = useState<RouteApprovalChoice>(
    initial.behavior.approvalChoice,
  );
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const memberAudienceLabel = channelMembersAudienceLabel({
    membership: hub.signedIn?.membership ?? null,
    members: hub.signedIn?.team?.members,
    selectedTeamIds,
  });
  const audienceLabels = useMemo(
    () => ({ ...ROUTE_AUDIENCE_LABELS, members: memberAudienceLabel }),
    [memberAudienceLabel],
  );

  const [contains, setContains] = useState(initial.contains);
  const [routeLimits, setRouteLimits] = useState<RouteLimitsDraft>(initial.routeLimits);
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
  const parsedProviderOptions = parseOptionalObject(providerOptions);
  const parsedRouteLimits = parseRouteLimits(routeLimits);
  const connectionOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      connections.map((connection) => ({
        id: connection.id,
        value: connection.id,
        label: `${channelLabel(connection.provider)} · ${connection.name}`,
        description: connection.externalName ?? undefined,
      })),
    [connections],
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
  const selectedDaemonServerId =
    daemons.find((daemon) => daemon.id === daemonId)?.connectionOffer?.serverId ?? null;
  const automationOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      automations.map((automation) => ({
        id: automation.id,
        value: automation.name,
        label: automation.name,
      })),
    [automations],
  );
  const canSave = canSaveChannelRoute({
    selectedConnection,
    effectiveAccountId,
    configurationKind,
    selectedAccount,
    routeCondition,
    contains,
    audience,
    parsedRouteLimits,
    conversationScope,
    conversationIds,
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
    selectedConnection !== undefined &&
    existingAccounts.some(
      (account) =>
        stringField(account, "channel") === selectedConnection.provider &&
        stringField(account, "accountId") === accountId.trim(),
    );

  const connectionDisplay = useMemo(
    () => selectedOptionDisplay(connectionOptions, connectionId),
    [connectionId, connectionOptions],
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
  const changeMatchKind = useCallback((value: string) => {
    setMatchKind(value as MatchKind);
    setConversationIds("");
  }, []);
  const changeConversationScope = useCallback((value: string) => {
    setConversationScope(value);
    if (value === "all") setConversationIds("");
  }, []);
  const changeRouteCondition = useCallback(
    (value: string) => setRouteCondition(value as RouteCondition),
    [],
  );
  const changeAudience = useCallback((value: string) => {
    const nextAudience = value as RouteAudience;
    setAudience(nextAudience);
    if (nextAudience !== "conversationParticipants") return;
    setConversationScope("specific");
    setAgentConfiguration((current) => {
      const featureValues = { ...current.featureValues };
      delete featureValues["fast_mode"];
      return { ...current, featureValues };
    });
  }, []);
  const changeMaxInputCharacters = useCallback(
    (value: string) => setRouteLimits((current) => ({ ...current, maxInputCharacters: value })),
    [],
  );
  const changeMessagesPerMinutePerSender = useCallback(
    (value: string) =>
      setRouteLimits((current) => ({
        ...current,
        messagesPerMinutePerSender: value,
      })),
    [],
  );
  const changeMessagesPerMinute = useCallback(
    (value: string) => setRouteLimits((current) => ({ ...current, messagesPerMinute: value })),
    [],
  );
  const changeMaxConcurrentRuns = useCallback(
    (value: string) => setRouteLimits((current) => ({ ...current, maxConcurrentRuns: value })),
    [],
  );
  const changeMaxRuntimeSeconds = useCallback(
    (value: string) => setRouteLimits((current) => ({ ...current, maxRuntimeSeconds: value })),
    [],
  );
  const changeRequireMention = useCallback(
    (requireMention: boolean) => setBehavior((current) => ({ ...current, requireMention })),
    [],
  );
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
  const changeTarget = useCallback((value: string) => setTarget(value as RouteTarget), []);
  const showAutomationForm = useCallback(() => {
    if (selectedConnection === undefined) {
      setAutomationCreateError("Choose a Channel Connection before creating its Automation.");
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
    if (!canSave || duplicateAccount || selectedConnection === undefined) return;
    const worktree = worktreeTargetFromConfiguration(workspace);
    const routeTarget = buildRouteTarget({
      target,
      automationName,
      daemonId,
      projectId,
      cwd,
      worktree,
      agentConfiguration,
      parsedProviderOptions,
    });
    if (routeTarget === null) return;
    const routeInput = {
      accountId: effectiveAccountId,
      matchKind,
      conversationIds,
      ...(routeCondition === "contains" ? { contains } : {}),
      audience,
      ...(audience === "conversationParticipants" && parsedRouteLimits.valid
        ? { limits: parsedRouteLimits.value }
        : {}),
      ...(audience === "members"
        ? { behavior: behaviorWithApprovalChoice(behavior, approvalChoice) }
        : {}),
      target: routeTarget,
      resource,
    };
    let nextAccounts: RecordValue[];
    let nextResource: RecordValue;
    let nextRoute: RecordValue;
    let teamGrant: ChannelTeamGrant | undefined;
    if (isEditing && editedRoute !== undefined && editing !== null) {
      const candidate = replaceChannelRouteCandidate({
        ...routeInput,
        currentRoute: editedRoute,
        accounts: existingAccounts,
      });
      nextAccounts = existingAccounts.map((account) => {
        if (channelAccountKey(account) !== editing.accountKey) return account;
        return {
          ...account,
          routes: arrayField(account, "routes").map((route, index) =>
            index === editing.routeIndex ? candidate.route : route,
          ),
        };
      });
      nextResource = candidate.resource;
      nextRoute = candidate.route;
    } else if (configurationKind === "account") {
      const candidate = buildChannelAccountCandidate({
        ...routeInput,
        connection: selectedConnection,
      });
      nextAccounts = [...existingAccounts, candidate.account];
      nextResource = candidate.resource;
      nextRoute = arrayField(candidate.account, "routes")[0] as RecordValue;
      teamGrant = {
        channel: selectedConnection.provider,
        accountId: effectiveAccountId,
        teamIds: selectedTeamIds,
        conversation: conversationAccessForRoute(matchKind, splitConversationIds(conversationIds)),
      };
    } else {
      if (selectedAccount === undefined) return;
      const candidate = buildChannelRouteCandidate(routeInput);
      nextAccounts = existingAccounts.map((account) => {
        if (account !== selectedAccount) return account;
        return {
          ...account,
          routes: insertChannelRoute(
            arrayField(account, "routes") as RecordValue[],
            candidate.route,
          ),
        };
      });
      nextResource = candidate.resource;
      nextRoute = candidate.route;
    }
    const confirmed = await confirmDialog({
      title: inputDraft
        ? "Use this input in the Automation?"
        : routeConfirmationTitle(audience, approvalChoice, isEditing),
      message: routeReviewMessage({
        route: nextRoute,
        target: routeTargetReviewLabel(target, automationName, agentConfiguration),
        teams: teams.filter(({ id }) => selectedTeamIds.includes(id)).map(({ name }) => name),
      }),
      confirmLabel: inputDraft ? "Use input" : channelFormSubmitLabel(isEditing),
      destructive: audience === "conversationParticipants" || approvalChoice === "auto-allow",
    });
    if (!confirmed || !mounted.current) return;
    save(nextAccounts, nextResource, teamGrant);
  }, [
    inputDraft,
    agentConfiguration,
    approvalChoice,
    audience,
    automationName,
    behavior,
    canSave,
    confirmDialog,
    configurationKind,
    contains,
    conversationIds,
    cwd,
    daemonId,
    duplicateAccount,
    editedRoute,
    editing,
    effectiveAccountId,
    existingAccounts,
    isEditing,
    matchKind,
    parsedProviderOptions,
    parsedRouteLimits,
    projectId,
    resource,
    routeCondition,
    save,
    selectedAccount,
    selectedConnection,
    selectedTeamIds,
    target,
    teams,
    workspace,
  ]);

  const renderAccountSelection = () => (
    <>
      {isEditing ? (
        <Alert
          variant="info"
          title={channelAccountLabel(editedAccount)}
          description="Saving validates and activates one complete Channel configuration revision."
        />
      ) : null}
      {!isEditing && configurationKind === "account" ? (
        <>
          <SelectField
            label="Connection"
            value={connectionId}
            selectedDisplay={connectionDisplay}
            options={connectionOptions}
            onChange={setConnectionId}
            placeholder="Choose a Connection"
            emptyText="Add a Slack or Telegram Connection first."
            searchable={connectionOptions.length > 6}
            title="Connection"
            disabled={pending}
          />
          <Field
            label="Account name"
            hint="A short name for this behavior configuration; credentials stay on the Connection."
            error={duplicateAccount ? "This account name is already used for the provider." : null}
          >
            <FormTextInput
              initialValue=""
              onChangeText={setAccountId}
              placeholder="customer-support"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
            />
          </Field>
        </>
      ) : null}
      {!isEditing && configurationKind === "route" ? (
        <Alert variant="info" title={channelAccountLabel(selectedAccount)} />
      ) : null}
    </>
  );
  const renderRouteMatch = () => (
    <>
      <ChoiceRow
        label="Conversation type"
        values={MATCH_KIND_VALUES}
        selected={matchKind}
        onChange={changeMatchKind}
        disabled={pending}
      />
      {audience === "members" ? (
        <ChoiceRow
          label="Conversations"
          values={CONVERSATION_SCOPE_VALUES}
          labels={CONVERSATION_SCOPE_LABELS}
          selected={conversationScope}
          onChange={changeConversationScope}
          disabled={pending}
        />
      ) : null}
      {conversationScope === "specific" ? (
        <ConversationSelectionFields
          channel={observedAccountChannel}
          accountId={observedAccountId}
          kind={matchKind}
          value={conversationIds}
          onChange={setConversationIds}
          disabled={pending}
          hint="Select at least one conversation. Only these exact conversations can match this Route."
          placeholder={matchKind === "dm" ? "D0123, D0456" : "C0123, C0456"}
        />
      ) : (
        <Text style={settingsStyles.rowHint}>
          Any conversation of the selected type can match this Route. Member access rules still
          apply.
        </Text>
      )}
      <ChoiceRow
        label="When"
        values={ROUTE_CONDITION_VALUES}
        selected={routeCondition}
        labels={ROUTE_CONDITION_LABELS}
        onChange={changeRouteCondition}
        disabled={pending}
      />
      {routeCondition === "contains" ? (
        <Field
          label="Contains exact text"
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
      <ChoiceRow
        label="Who can use it"
        values={ROUTE_AUDIENCE_VALUES}
        selected={audience}
        labels={audienceLabels}
        onChange={changeAudience}
        disabled={pending}
      />
    </>
  );
  const renderPublicLimits = () => {
    if (audience !== "conversationParticipants") return null;
    return (
      <>
        <Alert
          variant="warning"
          title="Public access to a fixed Route"
          description="Select at least one exact Conversation. Group messages must mention the app, output is final-answer text only, and tool approvals are denied. This does not grant Paseo or Project access."
        />
        <RouteLimitField
          label="Maximum input characters"
          hint={`Up to ${String(DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS.maxInputCharacters)} characters per message.`}
          value={routeLimits.maxInputCharacters}
          onChange={changeMaxInputCharacters}
          disabled={pending}
        />
        <RouteLimitField
          label="Messages per minute, per sender"
          hint={`Up to ${String(DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS.messagesPerMinutePerSender)}.`}
          value={routeLimits.messagesPerMinutePerSender}
          onChange={changeMessagesPerMinutePerSender}
          disabled={pending}
        />
        <RouteLimitField
          label="Messages per minute, total"
          hint={`Up to ${String(DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS.messagesPerMinute)} across this Route.`}
          value={routeLimits.messagesPerMinute}
          onChange={changeMessagesPerMinute}
          disabled={pending}
        />
        <RouteLimitField
          label="Concurrent runs"
          hint={`Up to ${String(DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS.maxConcurrentRuns)} active runs.`}
          value={routeLimits.maxConcurrentRuns}
          onChange={changeMaxConcurrentRuns}
          disabled={pending}
        />
        <RouteLimitField
          label="Maximum runtime (seconds)"
          hint={`Up to ${String(DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS.maxRuntimeSeconds)} seconds per run.`}
          value={routeLimits.maxRuntimeSeconds}
          onChange={changeMaxRuntimeSeconds}
          error={parsedRouteLimits.valid ? null : parsedRouteLimits.error}
          disabled={pending}
        />
      </>
    );
  };
  const renderMemberBehavior = () => {
    if (audience !== "members") return null;
    return (
      <MemberRouteBehaviorFields
        matchKind={matchKind}
        behavior={behavior}
        approvalChoice={approvalChoice}
        showTeamAccess={configurationKind === "account" && !isEditing && teams.length > 0}
        teams={teams}
        selectedTeamIds={selectedTeamIds}
        setSelectedTeamIds={setSelectedTeamIds}
        conversationIds={conversationIds}
        pending={pending}
        changeRequireMention={changeRequireMention}
        changeReplyThread={changeReplyThread}
        changeOutboundPath={changeOutboundPath}
        changeFinalAnswers={changeFinalAnswers}
        changeProgressMessage={changeProgressMessage}
        changeTypingIndicator={changeTypingIndicator}
        changeToolCalls={changeToolCalls}
        changeApprovalChoice={changeApprovalChoice}
      />
    );
  };
  const renderTarget = () => (
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
      allowFastMode={audience === "members"}
      parsedProviderOptions={parsedProviderOptions}
      setProviderOptions={setProviderOptions}
      pending={pending}
    />
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
  const formTitle = channelFormTitle(isEditing, editing, configurationKind);
  return (
    <View>
      <SettingsSection title={formTitle}>
        <View style={[settingsStyles.card, styles.form]}>
          {renderAccountSelection()}
          {renderRouteMatch()}
          {fixedAutomationName === undefined ? (
            renderTarget()
          ) : (
            <Text style={styles.formHeading}>{`Run Automation: ${fixedAutomationName}`}</Text>
          )}
          {renderPublicLimits()}
          {renderMemberBehavior()}
          {target === "automation" && automationName !== null ? (
            <AutomationReplyAuthority
              automation={automations.find((item) => item.name === automationName)}
              channel={selectedConnection?.provider}
            />
          ) : null}
          <Button disabled={pending || !canSave || duplicateAccount} onPress={submit}>
            {inputDraft ? "Use input" : channelFormSubmitLabel(isEditing)}
          </Button>
          <Button variant="ghost" disabled={pending} onPress={cancelEdit}>
            Cancel
          </Button>
        </View>
      </SettingsSection>
      {renderAutomationCreator()}
    </View>
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

function RouteLimitField({
  label,
  hint,
  value,
  onChange,
  error,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange(value: string): void;
  error?: string | null;
  disabled: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      <FormTextInput
        initialValue={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        editable={!disabled}
      />
    </Field>
  );
}

function MemberRouteBehaviorFields({
  matchKind,
  behavior,
  approvalChoice,
  showTeamAccess,
  teams,
  selectedTeamIds,
  setSelectedTeamIds,
  conversationIds,
  pending,
  changeRequireMention,
  changeReplyThread,
  changeOutboundPath,
  changeFinalAnswers,
  changeProgressMessage,
  changeTypingIndicator,
  changeToolCalls,
  changeApprovalChoice,
}: {
  matchKind: MatchKind;
  behavior: ChannelRouteBehavior;
  approvalChoice: RouteApprovalChoice;
  showTeamAccess: boolean;
  teams: HubTeam[];
  selectedTeamIds: string[];
  setSelectedTeamIds: Dispatch<SetStateAction<string[]>>;
  conversationIds: string;
  pending: boolean;
  changeRequireMention(value: boolean): void;
  changeReplyThread(value: boolean): void;
  changeOutboundPath(value: string): void;
  changeFinalAnswers(value: boolean): void;
  changeProgressMessage(value: boolean): void;
  changeTypingIndicator(value: boolean): void;
  changeToolCalls(value: boolean): void;
  changeApprovalChoice(value: string): void;
}) {
  const approvalValues = approvalChoice === "custom" ? CUSTOM_APPROVAL_VALUES : APPROVAL_VALUES;
  return (
    <>
      <Text style={styles.formHeading}>Replies and approvals</Text>
      {matchKind === "dm" ? null : (
        <RouteBehaviorSwitch
          label="Require a mention"
          value={behavior.requireMention}
          onChange={changeRequireMention}
          disabled={pending}
        />
      )}
      {matchKind === "dm" ? null : (
        <RouteBehaviorSwitch
          label="Reply in a thread"
          value={behavior.replyAnchor === "thread"}
          onChange={changeReplyThread}
          disabled={pending}
        />
      )}
      <ChoiceRow
        label="Reply method"
        values={OUTBOUND_PATH_VALUES}
        selected={behavior.outboundPath}
        labels={OUTBOUND_PATH_LABELS}
        onChange={changeOutboundPath}
        disabled={pending}
      />
      <RelayBehaviorFields
        visible={behavior.outboundPath === "relay"}
        behavior={behavior}
        pending={pending}
        changeFinalAnswers={changeFinalAnswers}
        changeProgressMessage={changeProgressMessage}
        changeTypingIndicator={changeTypingIndicator}
        changeToolCalls={changeToolCalls}
      />
      <ChoiceRow
        label="Tool requests"
        values={approvalValues}
        selected={approvalChoice}
        labels={APPROVAL_LABELS}
        onChange={changeApprovalChoice}
        disabled={pending}
      />
      {showTeamAccess ? (
        <View style={styles.inlineFields}>
          <Text style={styles.formHeading}>Team access</Text>
          <TeamAccessChoices
            teams={teams}
            selectedTeamIds={selectedTeamIds}
            setSelectedTeamIds={setSelectedTeamIds}
            disabled={pending}
          />
          <Text style={settingsStyles.rowHint}>{teamAccessHint(conversationIds, matchKind)}</Text>
        </View>
      ) : null}
    </>
  );
}

function RelayBehaviorFields({
  visible,
  behavior,
  pending,
  changeFinalAnswers,
  changeProgressMessage,
  changeTypingIndicator,
  changeToolCalls,
}: {
  visible: boolean;
  behavior: ChannelRouteBehavior;
  pending: boolean;
  changeFinalAnswers(value: boolean): void;
  changeProgressMessage(value: boolean): void;
  changeTypingIndicator(value: boolean): void;
  changeToolCalls(value: boolean): void;
}) {
  if (!visible) {
    return (
      <Alert
        variant="info"
        title="The Agent controls replies"
        description="The Agent can send text and files from the selected Project to this conversation without a separate approval. File sending requires the Hub to access the Project folder. Text forward is disabled to avoid duplicate replies."
      />
    );
  }
  return (
    <>
      <RouteBehaviorSwitch
        label="Send final answers"
        value={behavior.finalAnswers}
        onChange={changeFinalAnswers}
        disabled={pending}
      />
      <RouteBehaviorSwitch
        label="Send progress messages"
        value={behavior.progressMessage}
        onChange={changeProgressMessage}
        disabled={pending}
      />
      <RouteBehaviorSwitch
        label="Show typing indicator"
        value={behavior.typingIndicator}
        onChange={changeTypingIndicator}
        disabled={pending}
      />
      <RouteBehaviorSwitch
        label="Show tool activity"
        value={behavior.toolCalls}
        onChange={changeToolCalls}
        disabled={pending}
      />
    </>
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
  allowFastMode,
  parsedProviderOptions,
  setProviderOptions,
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
  allowFastMode: boolean;
  parsedProviderOptions: ReturnType<typeof parseOptionalObject>;
  setProviderOptions(value: string): void;
  pending: boolean;
}) {
  return (
    <>
      <ChoiceRow
        label="What should happen"
        values={CHANNEL_ROUTE_TARGET_VALUES}
        selected={target}
        labels={ROUTE_TARGET_LABELS}
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
          allowFastMode={allowFastMode}
          parsedProviderOptions={parsedProviderOptions}
          setProviderOptions={setProviderOptions}
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
  allowFastMode,
  parsedProviderOptions,
  setProviderOptions,
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
  allowFastMode: boolean;
  parsedProviderOptions: ReturnType<typeof parseOptionalObject>;
  setProviderOptions(value: string): void;
  pending: boolean;
}) {
  const providerOptionsError = parsedProviderOptions.valid
    ? null
    : 'Enter a JSON object, for example {"setting": true}.';
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
        disabled={pending}
      />
      <ManagedWorkspaceFields value={workspace} onChange={setWorkspace} disabled={pending} />
      <ManagedAgentConfigurationFields
        serverId={selectedDaemonServerId}
        cwd={cwd}
        value={agentConfiguration}
        onChange={setAgentConfiguration}
        allowFastMode={allowFastMode}
        disabled={pending}
      />
      <Field
        label="Provider options"
        hint="Optional JSON object for provider-specific settings."
        error={providerOptionsError}
      >
        <FormTextInput
          initialValue=""
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

function ChoiceRow({
  label,
  values,
  selected,
  labels = {},
  onChange,
  disabled,
}: {
  label: string;
  values: string[];
  selected: string;
  labels?: Record<string, string>;
  onChange(value: string): void;
  disabled: boolean;
}) {
  return (
    <View style={styles.choiceGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.actions}>
        {values.map((value) => (
          <ChoiceButton
            key={value}
            value={value}
            selected={selected === value}
            label={labels[value] ?? channelLabel(value)}
            onChange={onChange}
            disabled={disabled}
          />
        ))}
      </View>
    </View>
  );
}

function ChoiceButton({
  value,
  selected,
  label,
  onChange,
  disabled,
}: {
  value: string;
  selected: boolean;
  label: string;
  onChange(value: string): void;
  disabled: boolean;
}) {
  const select = useCallback(() => onChange(value), [onChange, value]);
  return (
    <Button
      size="xs"
      variant={selected ? "secondary" : "outline"}
      disabled={disabled}
      onPress={select}
    >
      {label}
    </Button>
  );
}

function RouteBehaviorSwitch({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled: boolean;
}) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
      />
    </View>
  );
}

function TeamAccessChoices({
  teams,
  selectedTeamIds,
  setSelectedTeamIds,
  disabled,
}: {
  teams: HubTeam[];
  selectedTeamIds: string[];
  setSelectedTeamIds: Dispatch<SetStateAction<string[]>>;
  disabled: boolean;
}) {
  if (teams.length === 0) {
    return (
      <Text style={settingsStyles.rowHint}>
        Owners can use this Channel account automatically. Add Teams later from Access.
      </Text>
    );
  }
  return teams.map((team) => (
    <TeamAccessSwitch
      key={team.id}
      team={team}
      selected={selectedTeamIds.includes(team.id)}
      setSelectedTeamIds={setSelectedTeamIds}
      disabled={disabled}
    />
  ));
}

function TeamAccessSwitch({
  team,
  selected,
  setSelectedTeamIds,
  disabled,
}: {
  team: HubTeam;
  selected: boolean;
  setSelectedTeamIds: Dispatch<SetStateAction<string[]>>;
  disabled: boolean;
}) {
  const change = useCallback(
    (nextSelected: boolean) => {
      setSelectedTeamIds((current) => {
        if (nextSelected) return [...current, team.id];
        return current.filter((id) => id !== team.id);
      });
    },
    [setSelectedTeamIds, team.id],
  );
  const memberSuffix = team.userIds.length === 1 ? "" : "s";
  return (
    <RouteBehaviorSwitch
      label={`${team.name} · ${String(team.userIds.length)} Member${memberSuffix}`}
      value={selected}
      onChange={change}
      disabled={disabled}
    />
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
  if (account === undefined) return "Channel account unavailable";
  return `${channelLabel(stringField(account, "channel") ?? "channel")} · ${stringField(account, "accountId") ?? "account"}`;
}

function channelAccountStatus(
  enabled: boolean,
  runtimeAvailable: boolean | undefined,
  runtime: HubRuntimeAccount | undefined,
  connection: HubConnection | undefined,
  routeCount: number,
): string {
  const runtimeLabel = enabled ? channelRuntimeLabel(runtimeAvailable, runtime) : "Disabled";
  const connectionLabel = connection?.externalName ?? connection?.name ?? "Connection unavailable";
  const routeSuffix = routeCount === 1 ? "" : "s";
  return `${runtimeLabel} · ${connectionLabel} · ${String(routeCount)} route${routeSuffix}`;
}

function channelAccessStatus(teamNames: string[], assignmentCount: number): string {
  if (assignmentCount === 0)
    return "No Member or Team grants. Owners retain access to Members Routes.";
  const summary = `${assignmentCount} Member or Team access grants; conversation limits may apply.`;
  return teamNames.length === 0 ? summary : `${summary} Teams: ${teamNames.join(", ")}.`;
}

function arrayField(record: RecordValue, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function stringArrayField(record: RecordValue, key: string): string[] {
  return arrayField(record, key)
    .filter(
      (value): value is string | number => typeof value === "string" || typeof value === "number",
    )
    .map(String);
}

function objectField(record: RecordValue, key: string): RecordValue | null {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function routeLimitsDraft(record: RecordValue): RouteLimitsDraft {
  const value = <K extends keyof ChannelRouteLimits>(key: K): string => {
    const candidate = record[key];
    return String(
      typeof candidate === "number" ? candidate : DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS[key],
    );
  };
  return {
    maxInputCharacters: value("maxInputCharacters"),
    messagesPerMinutePerSender: value("messagesPerMinutePerSender"),
    messagesPerMinute: value("messagesPerMinute"),
    maxConcurrentRuns: value("maxConcurrentRuns"),
    maxRuntimeSeconds: value("maxRuntimeSeconds"),
  };
}

function parseRouteLimits(
  draft: RouteLimitsDraft,
): { valid: true; value: ChannelRouteLimits } | { valid: false; error: string } {
  const parse = (value: string, maximum: number): number | null => {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : null;
  };
  const value = {
    maxInputCharacters: parse(
      draft.maxInputCharacters,
      DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS.maxInputCharacters,
    ),
    messagesPerMinutePerSender: parse(
      draft.messagesPerMinutePerSender,
      DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS.messagesPerMinutePerSender,
    ),
    messagesPerMinute: parse(
      draft.messagesPerMinute,
      DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS.messagesPerMinute,
    ),
    maxConcurrentRuns: parse(
      draft.maxConcurrentRuns,
      DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS.maxConcurrentRuns,
    ),
    maxRuntimeSeconds: parse(
      draft.maxRuntimeSeconds,
      DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS.maxRuntimeSeconds,
    ),
  };
  if (Object.values(value).some((candidate) => candidate === null)) {
    return {
      valid: false,
      error: "Use positive whole numbers no higher than the limits shown.",
    };
  }
  return { valid: true, value: value as ChannelRouteLimits };
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
      replyAnchor: initialChannelReplyAnchor(route !== undefined, stringField(reply, "anchor")),
      outboundPath:
        stringField(outbound, "path") === "tool"
          ? "tool"
          : DEFAULT_MEMBER_ROUTE_BEHAVIOR.outboundPath,
      finalAnswers: booleanValue(sync["finalAnswers"], DEFAULT_MEMBER_ROUTE_BEHAVIOR.finalAnswers),
      progressMessage: routeProgressMessage(progress, sync),
      typingIndicator: booleanValue(
        progress?.["typingIndicator"],
        DEFAULT_MEMBER_ROUTE_BEHAVIOR.typingIndicator,
      ),
      toolCalls: booleanValue(sync["toolCalls"], DEFAULT_MEMBER_ROUTE_BEHAVIOR.toolCalls),
      ...(approvalChoice === "custom" ? {} : { approvalMode: approvalChoice }),
    },
    approvalChoice,
  };
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

function behaviorWithApprovalChoice(
  behavior: ChannelRouteBehavior,
  approvalChoice: RouteApprovalChoice,
): ChannelRouteBehavior {
  const { approvalMode: _, ...settings } = behavior;
  return approvalChoice === "custom" ? settings : { ...settings, approvalMode: approvalChoice };
}

function routeBehaviorSummary(route: RecordValue): string {
  const audience = stringField(objectField(route, "audience") ?? {}, "kind");
  if (audience === "conversationParticipants") {
    return "Final answers only · Approvals denied · Conservative limits";
  }
  const { behavior, approvalChoice } = routeBehaviorDraft(route);
  const reply =
    behavior.outboundPath === "tool"
      ? "Use Channel tool: text and Project files, preapproved"
      : "Text forward";
  const approval = approvalSummary(approvalChoice);
  return `${reply} · ${approval}`;
}

function approvalSummary(approvalChoice: RouteApprovalChoice): string {
  if (approvalChoice === "require") return "Ask for approval";
  if (approvalChoice === "auto-deny") return "Requests denied";
  if (approvalChoice === "auto-allow") return "Requests auto-approved";
  return "Custom approvals";
}

function routeReviewMessage(input: {
  route: RecordValue;
  target: string;
  teams: string[];
}): string {
  const teamAccess =
    input.teams.length === 0
      ? "Access: owners and existing assignments"
      : `Access: owners and ${input.teams.join(", ")}`;
  return [
    routeMatchSummary(input.route),
    `Target: ${input.target}`,
    routeBehaviorSummary(input.route),
    teamAccess,
  ].join("\n");
}

function conversationAccessForRoute(
  matchKind: MatchKind,
  conversationIds: string[],
): ChannelTeamGrant["conversation"] {
  if (conversationIds.length > 0) return { kind: "specific", conversationIds };
  return matchKind === "dm" ? { kind: "direct_messages" } : { kind: "public_channels" };
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
    default:
      return channelLabel(runtime.transport);
  }
}

function routeMatchKind(record: RecordValue): MatchKind {
  const value = stringField(record, "kind");
  return value === "channel" || value === "thread" || value === "group" || value === "topic"
    ? value
    : "dm";
}

function routeMatchSummary(
  route: RecordValue,
  metadata?: z.infer<typeof HubObservedChannelConversationsSchema>,
): string {
  const match = objectField(route, "match");
  if (match === null) return "Match unavailable";
  const kind = stringField(match, "kind") ?? "conversation";
  const ids = arrayField(match, "ids").filter(
    (value): value is string => typeof value === "string",
  );
  const contains = stringField(match, "contains");
  const scope =
    ids.length === 0
      ? `Any ${kind}`
      : `${kind} · ${ids.map((id) => channelDestinationLabel(id, kind, metadata)).join(", ")}`;
  const audience = objectField(route, "audience");
  const audienceLabel =
    stringField(audience ?? undefined, "kind") === "conversationParticipants"
      ? "Anyone in conversation"
      : "Members with access";
  const condition = contains === null ? scope : `${scope} · Contains “${contains}”`;
  return `${condition} · ${audienceLabel}`;
}

function channelDestinationLabel(
  id: string,
  kind: string,
  metadata: z.infer<typeof HubObservedChannelConversationsSchema> | undefined,
): string {
  const candidates = [...(metadata?.destinations ?? []), ...(metadata?.conversations ?? [])];
  const named = candidates.find((item) => item.id === id && item.kind === kind && item.label);
  if (!named?.label || named.label === id) return id;
  if (named.threadId !== null) return `${named.label} · ${channelLabel(kind)} ${id}`;
  return `${named.label} (${id})`;
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

function routeTestTarget(route: RecordValue): { conversationId: string } | null {
  const match = objectField(route, "match");
  if (match === null) return null;
  const kind = stringField(match, "kind");
  if (kind === "thread" || kind === "topic") return null;
  const conversationId = arrayField(match, "ids").find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return conversationId === undefined ? null : { conversationId };
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
  const editedMatch = objectField(route, "match") ?? EMPTY_RECORD;
  const editedAudience = objectField(route, "audience") ?? EMPTY_RECORD;
  const editedLimits = objectField(route, "limits") ?? EMPTY_RECORD;
  const editedWorkflow = stringField(editedRoute, "workflow");
  const editedAgentName = stringField(editedRoute, "agent") ?? "";
  const editedEnvironmentName = stringField(editedRoute, "environment") ?? "";
  const editedAgent = objectField(objectField(resource, "agents") ?? EMPTY_RECORD, editedAgentName);
  const editedEnvironment = objectField(
    objectField(resource, "environments") ?? EMPTY_RECORD,
    editedEnvironmentName,
  );
  const contains = stringField(editedMatch, "contains") ?? "";
  const isEditing = editing !== null && editedAccount !== undefined && editedRoute !== undefined;
  const environment = managedEnvironmentConfiguration(editedEnvironment);
  return {
    editedAccount,
    editedRoute,
    editedWorkflow,
    isEditing,
    accountKey: editing?.accountKey ?? null,
    matchKind: routeMatchKind(editedMatch),
    conversationIds: stringArrayField(editedMatch, "ids").join(", "),
    routeCondition: (contains.length > 0 ? "contains" : "all") as RouteCondition,
    audience: (stringField(editedAudience, "kind") === "conversationParticipants"
      ? "conversationParticipants"
      : "members") as RouteAudience,
    behavior: routeBehaviorDraft(editedRoute),
    contains,
    routeLimits: routeLimitsDraft(editedLimits),
    ...environment,
    agentConfiguration: managedAgentConfiguration(editedAgent),
    providerOptions: formatOptionalObject(objectField(editedAgent ?? EMPTY_RECORD, "options")),
  };
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

function findEditedRoute(accounts: RecordValue[], editing: EditingRoute | null) {
  if (editing === null) {
    return { editedAccount: undefined, editedRoute: undefined };
  }
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
    observedAccountChannel: channelReplyProviderName(stringField(selectedAccount, "channel")),
    observedAccountId: stringField(selectedAccount, "accountId"),
  };
}

function channelFormTitle(
  isEditing: boolean,
  editing: EditingRoute | null,
  kind: ConfigurationKind,
): string {
  if (!isEditing) return kind === "account" ? "Add Channel account" : "Add Route";
  return `Edit Route ${String((editing?.routeIndex ?? 0) + 1)}`;
}

function canSaveChannelRoute(input: {
  selectedConnection: { id: string } | undefined;
  effectiveAccountId: string;
  configurationKind: ConfigurationKind;
  selectedAccount: RecordValue | undefined;
  routeCondition: RouteCondition;
  contains: string;
  audience: RouteAudience;
  parsedRouteLimits: ReturnType<typeof parseRouteLimits>;
  conversationScope: string;
  conversationIds: string;
  target: RouteTarget;
  automationName: string | null;
  daemonId: string | null;
  projectId: string | null;
  cwd: string;
  workspaceValid: boolean;
  provider: string;
  providerOptionsValid: boolean;
}): boolean {
  if (input.selectedConnection === undefined || input.effectiveAccountId.length === 0) return false;
  if (input.configurationKind === "route" && input.selectedAccount === undefined) return false;
  if (input.routeCondition === "contains" && input.contains.trim().length === 0) return false;
  if (
    input.conversationScope === "specific" &&
    splitConversationIds(input.conversationIds).length === 0
  )
    return false;
  if (input.audience === "conversationParticipants") {
    if (!input.parsedRouteLimits.valid) return false;
    if (!hasRequiredChannelConversationIds(input.audience, input.conversationIds)) return false;
  }
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
  audience: RouteAudience,
  approvalChoice: RouteApprovalChoice,
  isEditing: boolean,
): string {
  if (audience === "conversationParticipants") return "Activate public Route?";
  if (approvalChoice === "auto-allow") return "Activate automatic tool access?";
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

function teamAccessHint(conversationIds: string, matchKind: MatchKind): string {
  if (splitConversationIds(conversationIds).length > 0) {
    return "Selected Teams receive access only to the listed Conversations.";
  }
  if (matchKind === "dm") return "Selected Teams receive access to direct messages.";
  return "Selected Teams receive access to verified public Conversations. Broader access remains configurable in Access.";
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
  detailRow: {
    paddingLeft: theme.spacing[4],
  },
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  choiceGroup: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: "500",
  },
  formHeading: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: "600",
  },
  inlineFields: {
    gap: theme.spacing[3],
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  switchLabel: {
    color: theme.colors.foreground,
    flex: 1,
    fontSize: 13,
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
