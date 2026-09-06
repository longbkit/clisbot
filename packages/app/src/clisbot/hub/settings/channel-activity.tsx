import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { HubChannelActivitySchema, HubConnectionsSchema } from "../contracts";
import { hubResourceQueryKey } from "../query-keys";
import { useHubSettingsDetailScroll } from "./detail-scroll";

type ActivityPage = z.infer<typeof HubChannelActivitySchema>;
type ActivityEntry = ActivityPage["activity"][number];
type Connection = z.infer<typeof HubConnectionsSchema>["connections"][number];
const EMPTY_ACCOUNTS: AccountRecord[] = [];
const EMPTY_CONNECTIONS: Connection[] = [];
type AccountRecord = Record<string, unknown>;
const OUTCOMES: Record<ActivityEntry["outcome"], string> = {
  bound: "Agent started",
  steered: "Sent to existing Agent",
  workflow: "Automation invoked",
  ignored: "Ignored",
  error: "Failed",
};
const ALL = "all";
const OUTCOME_OPTIONS: SelectFieldOption<string>[] = [
  { id: ALL, value: ALL, label: "All outcomes" },
  ...Object.entries(OUTCOMES).map(([value, label]) => ({ id: value, value, label })),
];

export interface ChannelActivityState {
  accountKey: string;
  route: string;
  outcome: string;
  cursors: Array<string | null>;
  page: number;
  previousPage: number;
  selected: ActivityEntry | null;
}
export function initialChannelActivityState(accountKey = ALL, route = ALL): ChannelActivityState {
  return {
    accountKey,
    route,
    outcome: ALL,
    cursors: [null],
    page: 0,
    previousPage: 0,
    selected: null,
  };
}
type ChangeActivity = Dispatch<SetStateAction<ChannelActivityState>>;

export function ChannelActivity({
  accounts = EMPTY_ACCOUNTS,
  connections = EMPTY_CONNECTIONS,
  state,
  onChange,
}: {
  accounts?: AccountRecord[];
  connections?: Connection[];
  state: ChannelActivityState;
  onChange: ChangeActivity;
}) {
  const compact = useIsCompactFormFactor();
  const accountOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: ALL, value: ALL, label: "All accounts" },
      ...accounts.flatMap((account) => {
        if (typeof account.channel !== "string" || typeof account.accountId !== "string") return [];
        const value = `${account.channel}:${account.accountId}`;
        return [
          { id: value, value, label: `${providerLabel(account.channel)} · ${account.accountId}` },
        ];
      }),
    ],
    [accounts],
  );
  const selectedAccount = accounts.find(
    (account) => `${String(account.channel)}:${String(account.accountId)}` === state.accountKey,
  );
  const routeOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: ALL, value: ALL, label: "All Routes" },
      ...(Array.isArray(selectedAccount?.routes) ? selectedAccount.routes : []).map((_, index) => ({
        id: String(index),
        value: String(index),
        label: `Route ${index + 1}`,
      })),
      { id: "fallback", value: "fallback", label: "Fallback" },
    ],
    [selectedAccount?.routes],
  );
  const changeAccount = useCallback(
    (accountKey: string) =>
      onChange((current) => ({
        ...initialChannelActivityState(accountKey),
        outcome: current.outcome,
      })),
    [onChange],
  );
  const changeRoute = useCallback(
    (route: string) =>
      onChange((current) => ({
        ...initialChannelActivityState(current.accountKey, route),
        outcome: current.outcome,
      })),
    [onChange],
  );
  const changeOutcome = useCallback(
    (outcome: string) =>
      onChange((current) => ({
        ...initialChannelActivityState(current.accountKey, current.route),
        outcome,
      })),
    [onChange],
  );
  const clearFilters = useCallback(() => onChange(initialChannelActivityState()), [onChange]);
  const accountDisplay = useMemo(
    () =>
      accountOptions.find(({ value }) => value === state.accountKey) ?? { label: state.accountKey },
    [accountOptions, state.accountKey],
  );
  const routeDisplay = useMemo(
    () =>
      routeOptions.find(({ value }) => value === state.route) ?? {
        label: `Route ${Number(state.route) + 1}`,
      },
    [routeOptions, state.route],
  );
  const size = compact ? "md" : "sm";
  return (
    <SettingsSection title="Channel activity">
      <Text style={settingsStyles.rowHint}>
        Inbound Route results, newest first. Open an event for details and recovery.
      </Text>
      <View style={styles.filters}>
        <View style={styles.filter}>
          <SelectField
            label="Channel account"
            value={state.accountKey}
            selectedDisplay={accountDisplay}
            options={accountOptions}
            onChange={changeAccount}
            searchable
            size={size}
            placeholder="All accounts"
            emptyText="No Channel accounts"
          />
        </View>
        {state.accountKey !== ALL ? (
          <View style={styles.filter}>
            <SelectField
              label="Route"
              value={state.route}
              selectedDisplay={routeDisplay}
              options={routeOptions}
              onChange={changeRoute}
              size={size}
              placeholder="All Routes"
              emptyText="No Routes"
            />
          </View>
        ) : null}
        <View style={styles.filter}>
          <SelectField
            label="Outcome"
            value={state.outcome}
            selectedDisplay={OUTCOME_OPTIONS.find(({ value }) => value === state.outcome) ?? null}
            options={OUTCOME_OPTIONS}
            onChange={changeOutcome}
            size={size}
            placeholder="All outcomes"
            emptyText="No outcomes"
          />
        </View>
      </View>
      <ChannelActivityResults
        key={JSON.stringify([state.accountKey, state.route, state.outcome])}
        accounts={accounts}
        connections={connections}
        state={state}
        onChange={onChange}
        clearFilters={clearFilters}
      />
    </SettingsSection>
  );
}

function activityResource(state: ChannelActivityState, page: number): string {
  const params = new URLSearchParams({ limit: "25" });
  if (state.accountKey !== ALL) {
    const separator = state.accountKey.indexOf(":");
    params.set("channel", state.accountKey.slice(0, separator));
    params.set("accountId", state.accountKey.slice(separator + 1));
    if (state.route !== ALL) params.set("routePosition", state.route);
  }
  if (state.outcome !== ALL) params.set("outcome", state.outcome);
  const cursor = state.cursors[page];
  if (cursor) params.set("cursor", cursor);
  return `channel-activity?${params.toString()}`;
}

function ChannelActivityResults({
  accounts,
  connections,
  state,
  onChange,
  clearFilters,
}: {
  accounts: AccountRecord[];
  connections: Connection[];
  state: ChannelActivityState;
  onChange: ChangeActivity;
  clearFilters(): void;
}) {
  const hub = useHubAccount();
  const client = useQueryClient();
  const scope = {
    origin: hub.origin,
    organizationId: hub.signedIn?.organization.id ?? null,
    accountId: hub.signedIn?.account.id ?? null,
  };
  const resource = activityResource(state, state.page);
  const activity = useFetchQuery({
    queryKey: hubResourceQueryKey(scope, resource),
    queryFn: () => hub.api().get(resource, HubChannelActivitySchema),
    enabled: hub.enabled && scope.organizationId !== null,
    dataShape: "list",
    retry: false,
    staleTimeMs: 15_000,
  });
  const previous = client.getQueryData<ActivityPage>(
    hubResourceQueryKey(scope, activityResource(state, state.previousPage)),
  );
  const page = activity.data ?? previous;
  const showingPrevious =
    activity.isPlaceholderData || (activity.data === undefined && previous !== undefined);
  const displayedPage = showingPrevious ? state.previousPage : state.page;
  const scrollToTop = useHubSettingsDetailScroll();
  const { refetch } = activity;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const newer = useCallback(() => {
    scrollToTop?.();
    onChange((current) => ({
      ...current,
      previousPage: displayedPage,
      page: Math.max(0, current.page - 1),
      selected: null,
    }));
  }, [displayedPage, onChange, scrollToTop]);
  const older = useCallback(() => {
    if (!page?.nextCursor) return;
    scrollToTop?.();
    onChange((current) => ({
      ...current,
      previousPage: current.page,
      page: current.page + 1,
      cursors: [...current.cursors.slice(0, current.page + 1), page.nextCursor ?? null],
      selected: null,
    }));
  }, [onChange, page?.nextCursor, scrollToTop]);
  const select = useCallback(
    (selected: ActivityEntry | null) => onChange((current) => ({ ...current, selected })),
    [onChange],
  );
  const close = useCallback(() => select(null), [select]);
  const navigate = useCallback(
    (entry: ActivityEntry) => {
      select(entry);
      scrollToTop?.();
    },
    [scrollToTop, select],
  );
  const back = useCallback(() => {
    close();
    scrollToTop?.();
  }, [close, scrollToTop]);
  if (state.selected !== null) {
    const connectionId = currentConnectionId(accounts, connections, state.selected);
    return (
      <ChannelActivityDetails entry={state.selected} connectionId={connectionId} back={back} />
    );
  }
  return (
    <ChannelActivityList
      page={page}
      fetching={activity.isFetching}
      error={activity.error}
      pageIndex={state.page}
      displayedPage={displayedPage}
      showingPrevious={showingPrevious}
      refresh={refresh}
      newer={newer}
      older={older}
      clearFilters={clearFilters}
      navigate={navigate}
    />
  );
}
function currentConnectionId(
  accounts: AccountRecord[],
  connections: Connection[],
  entry: ActivityEntry,
): string | undefined {
  const account = accounts.find(
    (candidate) => candidate.channel === entry.channel && candidate.accountId === entry.accountId,
  );
  return connections.find(
    (connection) =>
      connection.id === account?.connectionId &&
      connection.provider === entry.channel &&
      connection.canLinkIdentity === true,
  )?.id;
}

function ChannelActivityList({
  page,
  fetching,
  error,
  pageIndex,
  displayedPage,
  showingPrevious,
  refresh,
  newer,
  older,
  clearFilters,
  navigate,
}: {
  page: ActivityPage | undefined;
  fetching: boolean;
  error: Error | null;
  pageIndex: number;
  displayedPage: number;
  showingPrevious: boolean;
  refresh(): void;
  newer(): void;
  older(): void;
  clearFilters(): void;
  navigate(entry: ActivityEntry): void;
}) {
  return (
    <View style={styles.results}>
      <View style={styles.toolbar}>
        <Text style={settingsStyles.rowHint}>{`Page ${displayedPage + 1} · up to 25 events`}</Text>
        <Button
          size="sm"
          variant="outline"
          disabled={fetching}
          loading={fetching}
          onPress={refresh}
        >
          Refresh activity
        </Button>
      </View>
      {fetching ? <Text style={settingsStyles.rowHint}>Loading Channel activity…</Text> : null}
      {error ? (
        <Alert
          variant="warning"
          title="Channel activity is unavailable"
          description={
            page
              ? "The requested page could not load. The last loaded events remain below; use Refresh activity to retry."
              : "Retry with Refresh activity. If this Hub version does not provide Channel activity, update the Hub to use this view."
          }
        />
      ) : null}
      {page?.activity.length === 0 && !fetching ? (
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>
            No events match these filters. Only messages evaluated against a Route appear here. Test
            reply checks outbound delivery only.
          </Text>
          <Button size="sm" variant="ghost" onPress={clearFilters}>
            Clear filters
          </Button>
        </View>
      ) : null}
      {page && page.activity.length > 0 ? (
        <View style={settingsStyles.card}>
          {page.activity.map((entry, index) => (
            <ChannelActivityRow
              key={entry.id}
              entry={entry}
              bordered={index > 0}
              select={navigate}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.toolbar}>
        <Button size="sm" variant="ghost" disabled={pageIndex === 0 || fetching} onPress={newer}>
          Newer
        </Button>
        <Text style={settingsStyles.rowHint}>{page ? `${page.activity.length} events` : ""}</Text>
        <Button
          size="sm"
          variant="ghost"
          disabled={!page?.nextCursor || fetching || showingPrevious || !!error}
          onPress={older}
        >
          Older
        </Button>
      </View>
    </View>
  );
}

function ChannelActivityRow({
  entry,
  bordered,
  select,
}: {
  entry: ActivityEntry;
  bordered: boolean;
  select(entry: ActivityEntry): void;
}) {
  const open = useCallback(() => select(entry), [entry, select]);
  return (
    <View style={[settingsStyles.row, bordered && settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text
          style={settingsStyles.rowTitle}
          numberOfLines={1}
        >{`${routeLabel(entry)} · ${outcomeLabel(entry)}`}</Text>
        <Text
          style={settingsStyles.rowHint}
          numberOfLines={1}
        >{`${providerLabel(entry.channel)} · ${entry.accountId ?? "Account"}`}</Text>
        <Text style={settingsStyles.rowHint}>{new Date(entry.createdAt).toLocaleString()}</Text>
      </View>
      <Button size="sm" variant="ghost" onPress={open}>
        Details
      </Button>
    </View>
  );
}
function ChannelActivityDetails({
  entry,
  connectionId,
  back,
}: {
  entry: ActivityEntry;
  connectionId?: string;
  back(): void;
}) {
  const recovery = entry.outcome === "ignored" ? channelAccessRecovery(entry.outcomeDetail) : null;
  return (
    <View style={styles.results}>
      <Text style={settingsStyles.rowHint}>
        Route positions describe the configuration when this event was recorded.
      </Text>
      <Button size="sm" variant="ghost" onPress={back}>
        Back to activity
      </Button>
      <View style={settingsStyles.card}>
        <ActivityDetail
          label={`${routeLabel(entry)} · ${outcomeLabel(entry)}`}
          value={`${providerLabel(entry.channel)} · ${entry.accountId ?? "Account"}`}
        />
        <ActivityDetail label="Time" value={new Date(entry.createdAt).toLocaleString()} />
        <ActivityDetail label="Conversation" value={entry.conversationId} />
        {entry.threadId ? <ActivityDetail label="Thread" value={entry.threadId} /> : null}
        <ActivityDetail label="Sender" value={entry.providerSenderId} />
        {entry.limitReason ? (
          <ActivityDetail label="Route limit" value={entry.limitReason.replaceAll("_", " ")} />
        ) : null}
        {entry.outcomeDetail && recovery === null ? (
          <ActivityDetail label="Result" value={entry.outcomeDetail} />
        ) : null}
      </View>
      {recovery ? <ChannelAccessRecovery recovery={recovery} connectionId={connectionId} /> : null}
    </View>
  );
}
function ActivityDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        <Text style={settingsStyles.rowHint}>{value}</Text>
      </View>
    </View>
  );
}
function routeLabel(entry: ActivityEntry): string {
  return entry.routePosition === "fallback" ? "Fallback" : `Route ${entry.routePosition + 1}`;
}
function outcomeLabel(entry: ActivityEntry): string {
  return entry.limitDecision === "denied" ? "Blocked by Route limits" : OUTCOMES[entry.outcome];
}
function providerLabel(channel: string | undefined): string {
  if (channel === "slack") return "Slack";
  if (channel === "telegram") return "Telegram";
  return "Channel";
}
const styles = StyleSheet.create((theme) => ({
  filters: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  filter: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
  results: { gap: theme.spacing[3] },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
}));
interface AccessRecovery {
  title: string;
  description: string;
  identity: boolean;
  access: boolean;
}
function channelAccessRecovery(reason: string | null | undefined): AccessRecovery | null {
  switch (reason) {
    case "sender identity is not linked to a Hub Member on this Connection":
      return {
        title: "Sender identity needs verification",
        description:
          "If this was your message, link your own Slack or Telegram identity to this Connection. Otherwise, ask the sender to link theirs in Account settings. Then send a new message; ignored messages are not replayed.",
        identity: true,
        access: false,
      };
    case "linked Hub Member does not have access to this conversation":
      return {
        title: "Sender needs conversation access",
        description:
          "The sender's Channel identity is verified. An owner or administrator must grant their Member or Team access to this Channel account and conversation, then the sender can try again.",
        identity: false,
        access: true,
      };
    case "sender may not trigger this route":
      return {
        title: "Check the sender's identity and access",
        description:
          "This older event does not identify the missing requirement. The sender needs a verified identity on this Connection and permission for this conversation. If this was your message, link your identity; then check Member or Team access and send a new message.",
        identity: true,
        access: true,
      };
    default:
      return null;
  }
}
function ChannelAccessRecovery({
  recovery,
  connectionId,
}: {
  recovery: AccessRecovery;
  connectionId?: string;
}) {
  const router = useRouter();
  const linkIdentity = useCallback(
    () =>
      router.push({
        pathname: "/settings/hub/[hubSection]",
        params: {
          hubSection: "account",
          ...(connectionId ? { channelConnectionId: connectionId } : {}),
        },
      }),
    [connectionId, router],
  );
  const manageAccess = useCallback(
    () => router.push({ pathname: "/settings/hub/[hubSection]", params: { hubSection: "access" } }),
    [router],
  );
  return (
    <Alert variant="warning" title={recovery.title} description={recovery.description}>
      {recovery.identity && connectionId ? (
        <Button size="sm" variant="outline" onPress={linkIdentity}>
          Link my identity on current Connection
        </Button>
      ) : null}
      {recovery.identity && !connectionId ? (
        <Text style={settingsStyles.rowHint}>
          This account has no current Connection available for identity linking. Check its
          configuration before retrying.
        </Text>
      ) : null}
      {recovery.access ? (
        <Button size="sm" variant="outline" onPress={manageAccess}>
          Manage access
        </Button>
      ) : null}
    </Alert>
  );
}
