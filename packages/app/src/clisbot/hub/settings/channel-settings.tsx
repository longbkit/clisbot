import { AutomationInputDraftContext } from "./automation-input-draft";
import { useContext } from "react";
import { type ChannelAccountRef } from "../channel-account-requests";
import {
  useChannelRouteAdminScope,
  useChannelSettingsQueries,
  useReportDraftEditing,
  useScrollToTopOn,
} from "./channel-settings-hooks";
import { useChannelYamlForm } from "./channel-advanced-configuration";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { RouteHostProvider } from "./route-host-context";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { ConfirmationProvider, useConfirmation } from "@/components/confirmation-provider";
import { useHubAccount } from "../account-provider";
import { createAutomation } from "../automation-management";
import { parseChannelConfigurationYaml } from "../channel-configuration";
import { routeBotKey, type RouteBotRequest } from "../channel-route-bot";
import { HubChannelValidationSchema } from "../contracts";
import { buildHubSettingsRoute } from "../navigation";
import { ChannelActivity, initialChannelActivityState } from "./channel-activity";
import { ChannelCatalogView } from "./channel-catalog-view";
import { ChannelOperationsView } from "./channel-operations-view";
import { useWideContent } from "./wide-content";
import { ViewTabs, type ViewTab } from "./view-tabs";
import {
  type ChannelEditor,
  type ConnectionsPanel,
  type EditingRoute,
  type HubAutomations,
  type HubChannelConfiguration,
  type HubConnections,
  type HubDaemons,
  type HubRuntimeStatus,
  type HubTeams,
} from "./channel-settings-types";
import {
  useChannelMutation,
  useReplaceConfiguration,
  useRouteEditorSaves,
} from "./channel-settings-mutations";
import { useAccountActions, useRouteActions, useTestMessage } from "./channel-connection-actions";
import { AutomationChannelInputs } from "./channel-automation-inputs";
import { ChannelAccountsSection, ChannelConfigurationExtras } from "./channel-accounts-section";
import { ChannelManagementSection, channelFormKey } from "./channel-route-editor";

/** What a Connection Admin's editor gets for the organization-wide resources it never reads. */
const EMPTY_CONNECTIONS: HubConnections = { connections: [], providerApplications: [] };
const EMPTY_AUTOMATIONS: HubAutomations = { automations: [] };
const EMPTY_DAEMONS: HubDaemons = { daemons: [] };
const EMPTY_TEAMS: HubTeams = { teams: [] };

export interface AutomationChannelScope {
  automationName: string;
}

export function ChannelSettings({
  automationName,
  embedded = false,
  connectBot = null,
  onConnectBotOpened,
}: Partial<AutomationChannelScope> & {
  embedded?: boolean;
  /** "Connect to a channel…" asked for Add Route on this Bot. */
  connectBot?: RouteBotRequest | null;
  /** Called once the Add Route form opened on `connectBot`, to clear the request. */
  onConnectBotOpened?: () => void;
} = {}) {
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
        connectBot={connectBot}
        onConnectBotOpened={onConnectBotOpened}
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
  connectBot,
  onConnectBotOpened,
}: Partial<AutomationChannelScope> & {
  embedded: boolean;
  /** The accounts a Connection Admin administers; null for the organization capability. */
  adminAccounts: readonly ChannelAccountRef[] | null;
  connectBot: RouteBotRequest | null;
  onConnectBotOpened: (() => void) | undefined;
}) {
  const [choosingInput, setChoosingInput] = useState(false);
  const toggleChoosingInput = useCallback(() => setChoosingInput((current) => !current), []);
  const confirmDialog = useConfirmation();
  const queries = useChannelSettingsQueries(adminAccounts);
  const {
    hub,
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
  } = queries;
  const adminScoped = adminAccounts !== null;
  const yamlForm = useChannelYamlForm(channels.data);
  const { mutationError, mutationPending, mutate } = useChannelMutation();
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
  useConnectBotEditor({
    connectBot,
    // An Automation's inputs and a Connection Admin's editor cannot pick what a Route runs.
    allowed: automationName === undefined && adminAccounts === null,
    ready: channels.data !== undefined,
    editing: editor !== null,
    confirm: confirmDialog,
    beginEdit,
    onOpened: onConnectBotOpened,
  });
  const [panel, setPanel] = useState<ConnectionsPanel | null>(null);
  const closePanel = useCallback(() => setPanel(null), []);
  const [channelView, setChannelView] = useState<ChannelView>("accounts");
  const [activityState, setActivityState] = useState(initialChannelActivityState);
  const openActivity = useCallback((accountKey: string | null) => {
    setActivityState(initialChannelActivityState(accountKey ?? "all"));
    setChannelView("activity");
  }, []);
  // An embedded or draft editor scrolls inside its own container.
  useScrollToTopOn(
    !embedded && !inputDraft,
    useMemo(() => [editor, channelView], [editor, channelView]),
  );

  const replaceConfiguration = useReplaceConfiguration(queries, adminScoped);
  const { removeAccount, updateAccount, retryAccount, disconnectConnection } = useAccountActions({
    queries,
    mutate,
    replaceConfiguration,
    confirmDialog,
  });
  const { moveRoute, removeRoute } = useRouteActions({
    accounts: channels.data?.accounts,
    mutate,
    replaceConfiguration,
    confirmDialog,
  });
  const { testResult, sendTestMessage } = useTestMessage({ hub, mutate, confirmDialog });

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
  // Add Route from an Automation's inputs picks the Connection; from a
  // Connection's card it belongs to that Connection.
  const addRoute = useCallback(
    () => beginEdit({ kind: "add", accountKey: null, fixed: false }),
    [beginEdit],
  );
  const addConnection = useCallback(
    () => beginEdit({ kind: "add", accountKey: null, fixed: false, connect: true }),
    [beginEdit],
  );
  const addRouteToConnection = useCallback(
    (connectionId: string) =>
      beginEdit({ kind: "add", accountKey: null, fixed: false, connectionId }),
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
  const { saveChannelBehavior, saveConnection } = useRouteEditorSaves({
    queries,
    adminScoped,
    mutate,
    replaceConfiguration,
    editorRevisionId,
    setEditorRevisionId,
    setEditor,
  });
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
        configuration={channels.data}
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
          queries={sources.accountQueries}
          refreshing={statusRefreshing}
          mutationError={mutationError}
          testResult={testResult}
          adminScoped={adminScoped}
          pending={pending}
          refreshStatus={refreshStatus}
          openPanel={setPanel}
          updateAccount={updateAccount}
          removeAccount={removeAccount}
          retryAccount={retryAccount}
          editRoute={editRoute}
          channelConnections={channelConnections}
          addConnection={addConnection}
          addRouteTo={addRouteTo}
          addRouteToConnection={addRouteToConnection}
          disconnectConnection={disconnectConnection}
          openActivity={openActivity}
          sendTestMessage={sendTestMessage}
          moveRoute={moveRoute}
          removeRoute={removeRoute}
        >
          <ChannelConfigurationExtras
            panel={adminScoped ? null : panel}
            close={closePanel}
            revisions={history.data?.revisions}
            channels={channels.data}
            yamlForm={yamlForm}
            error={mutationError}
            pending={pending}
            validate={validateAdvancedConfiguration}
            save={saveAdvancedConfiguration}
          />
        </ChannelAccountsSection>
      </RouteHostProvider>
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

/**
 * Opens Add Route on the Bot "Connect to a channel…" named, once per request; a request that ends
 * (the query cleared) lets the same Bot be asked for again. A Route form being edited is
 * discarded only when the user agrees.
 */
function useConnectBotEditor({
  connectBot,
  allowed,
  ready,
  editing,
  confirm,
  beginEdit,
  onOpened,
}: {
  connectBot: RouteBotRequest | null;
  allowed: boolean;
  ready: boolean;
  editing: boolean;
  confirm: ReturnType<typeof useConfirmation>;
  beginEdit(next: ChannelEditor): void;
  onOpened: (() => void) | undefined;
}) {
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (connectBot === null) {
      opened.current = null;
      return;
    }
    // Nothing here may pick what a Route runs: the request is spent.
    if (!allowed) {
      onOpened?.();
      return;
    }
    const key = routeBotKey(connectBot.serverId, connectBot.botId);
    if (!ready || opened.current === key) return;
    opened.current = key;
    onOpened?.();
    void (async () => {
      if (editing && !(await confirm(DISCARD_ROUTE_DRAFT))) return;
      beginEdit({ kind: "add", accountKey: null, fixed: false, bot: connectBot });
    })();
  }, [allowed, beginEdit, confirm, connectBot, editing, onOpened, ready]);
}

const DISCARD_ROUTE_DRAFT = {
  title: "Discard this Route?",
  message: "Connect to a channel… opens a new Route. The Route you are editing is not saved.",
  confirmLabel: "Discard",
  destructive: true,
};
