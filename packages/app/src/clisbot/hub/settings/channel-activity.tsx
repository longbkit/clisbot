import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { i18n } from "@/i18n/i18next";
import { useHubAccount } from "../account-provider";
import { useChannelCatalog } from "./channel-catalog-queries";
import { HubChannelActivitySchema, HubConnectionsSchema } from "../contracts";
import { channelCatalogLabel, type ChannelCatalogEntry } from "../channel-catalog";
import { hubResourceQueryKey } from "../query-keys";
import { useHubSettingsDetailScroll } from "./detail-scroll";
import { BackLink } from "./back-link";

type ActivityPage = z.infer<typeof HubChannelActivitySchema>;
type ActivityEntry = ActivityPage["activity"][number];
type Connection = z.infer<typeof HubConnectionsSchema>["connections"][number];
const EMPTY_ACCOUNTS: AccountRecord[] = [];
const EMPTY_CONNECTIONS: Connection[] = [];
type AccountRecord = Record<string, unknown>;
const OUTCOMES: Record<ActivityEntry["outcome"], (t: TFunction) => string> = {
  bound: (t) => t("hub.channels.activity.outcome.bound"),
  steered: (t) => t("hub.channels.activity.outcome.steered"),
  workflow: (t) => t("hub.channels.activity.outcome.workflow"),
  ignored: (t) => t("hub.channels.activity.outcome.ignored"),
  // The access plane refused the sender before any turn (`access:` in slice 23).
  denied: (t) => t("hub.channels.activity.outcome.denied"),
  error: (t) => t("hub.channels.activity.outcome.error"),
};
const ALL = "all";
function outcomeOptions(t: TFunction): SelectFieldOption<string>[] {
  return [
    { id: ALL, value: ALL, label: t("hub.channels.activity.allOutcomes") },
    ...Object.entries(OUTCOMES).map(([value, label]) => ({ id: value, value, label: label(t) })),
  ];
}

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
  accountScoped = false,
  state: requestedState,
  onChange,
}: {
  accounts?: AccountRecord[];
  connections?: Connection[];
  /** A Connection Admin reads each account's own activity; there is no "all". */
  accountScoped?: boolean;
  state: ChannelActivityState;
  onChange: ChangeActivity;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const catalog = useChannelCatalog();
  const state = useMemo(() => {
    const firstAccountKey = accounts
      .map((account) => `${String(account.channel)}:${String(account.accountId)}`)
      .find((key) => key.length > 0);
    return accountScoped && requestedState.accountKey === ALL && firstAccountKey !== undefined
      ? { ...requestedState, accountKey: firstAccountKey }
      : requestedState;
  }, [accountScoped, accounts, requestedState]);
  const accountOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      ...(accountScoped
        ? []
        : [{ id: ALL, value: ALL, label: t("hub.channels.activity.allAccounts") }]),
      ...accounts.flatMap((account) => {
        if (typeof account.channel !== "string" || typeof account.accountId !== "string") return [];
        const value = `${account.channel}:${account.accountId}`;
        return [
          {
            id: value,
            value,
            label: `${activityChannelLabel(catalog.entries, account.channel)} · ${account.accountId}`,
          },
        ];
      }),
    ],
    // The catalog arrives after the accounts do; without it here the options
    // would keep the fallback label for the rest of the session.
    [accountScoped, accounts, catalog.entries, t],
  );
  const selectedAccount = accounts.find(
    (account) => `${String(account.channel)}:${String(account.accountId)}` === state.accountKey,
  );
  const routeOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: ALL, value: ALL, label: t("hub.channels.activity.allRoutes") },
      ...(Array.isArray(selectedAccount?.routes) ? selectedAccount.routes : []).map((_, index) => ({
        id: String(index),
        value: String(index),
        label: t("hub.channels.activity.route", { position: index + 1 }),
      })),
    ],
    [selectedAccount?.routes, t],
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
        label: t("hub.channels.activity.route", { position: Number(state.route) + 1 }),
      },
    [routeOptions, state.route, t],
  );
  const outcomes = useMemo(() => outcomeOptions(t), [t]);
  const size = compact ? "md" : "sm";
  return (
    <SettingsSection title={t("hub.channels.activity.title")}>
      <Text style={settingsStyles.rowHint}>{t("hub.channels.activity.hint")}</Text>
      <View style={styles.filters}>
        <View style={styles.filter}>
          <SelectField
            label={t("hub.channels.activity.connection")}
            value={state.accountKey}
            selectedDisplay={accountDisplay}
            options={accountOptions}
            onChange={changeAccount}
            searchable
            size={size}
            placeholder={t("hub.channels.activity.allAccounts")}
            emptyText={t("hub.channels.activity.noConnections")}
          />
        </View>
        {state.accountKey !== ALL ? (
          <View style={styles.filter}>
            <SelectField
              label={t("hub.channels.activity.routeLabel")}
              value={state.route}
              selectedDisplay={routeDisplay}
              options={routeOptions}
              onChange={changeRoute}
              size={size}
              placeholder={t("hub.channels.activity.allRoutes")}
              emptyText={t("hub.channels.activity.noRoutes")}
            />
          </View>
        ) : null}
        <View style={styles.filter}>
          <SelectField
            label={t("hub.channels.activity.outcomeLabel")}
            value={state.outcome}
            selectedDisplay={outcomes.find(({ value }) => value === state.outcome) ?? null}
            options={outcomes}
            onChange={changeOutcome}
            size={size}
            placeholder={t("hub.channels.activity.allOutcomes")}
            emptyText={t("hub.channels.activity.noOutcomes")}
          />
        </View>
      </View>
      <ChannelActivityResults
        key={JSON.stringify([state.accountKey, state.route, state.outcome])}
        accounts={accounts}
        connections={connections}
        accountScoped={accountScoped}
        state={state}
        onChange={onChange}
        clearFilters={clearFilters}
      />
    </SettingsSection>
  );
}

/**
 * The organization-wide `channel-activity` list, or — for a Connection
 * Admin — the account's own `channel-activity/accounts/<channel>/<accountId>`,
 * the only one they may read.
 */
function activityResource(
  state: ChannelActivityState,
  page: number,
  accountScoped: boolean,
): string {
  const params = new URLSearchParams({ limit: "25" });
  let path = "channel-activity";
  if (state.accountKey !== ALL) {
    const separator = state.accountKey.indexOf(":");
    const channel = state.accountKey.slice(0, separator);
    const accountId = state.accountKey.slice(separator + 1);
    if (accountScoped) {
      path = `channel-activity/accounts/${encodeURIComponent(channel)}/${encodeURIComponent(accountId)}`;
    } else {
      params.set("channel", channel);
      params.set("accountId", accountId);
    }
    if (state.route !== ALL) params.set("routePosition", state.route);
  }
  if (state.outcome !== ALL) params.set("outcome", state.outcome);
  const cursor = state.cursors[page];
  if (cursor) params.set("cursor", cursor);
  return `${path}?${params.toString()}`;
}

function ChannelActivityResults({
  accounts,
  connections,
  accountScoped,
  state,
  onChange,
  clearFilters,
}: {
  accounts: AccountRecord[];
  connections: Connection[];
  accountScoped: boolean;
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
  const resource = activityResource(state, state.page, accountScoped);
  const activity = useFetchQuery({
    queryKey: hubResourceQueryKey(scope, resource),
    queryFn: () => hub.api().get(resource, HubChannelActivitySchema),
    enabled: hub.enabled && scope.organizationId !== null,
    dataShape: "list",
    retry: false,
    staleTimeMs: 15_000,
  });
  const previous = client.getQueryData<ActivityPage>(
    hubResourceQueryKey(scope, activityResource(state, state.previousPage, accountScoped)),
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
  const { t } = useTranslation();
  return (
    <View style={styles.results}>
      <View style={styles.toolbar}>
        <Text style={settingsStyles.rowHint}>
          {t("hub.channels.activity.page", { page: displayedPage + 1 })}
        </Text>
        <Button
          size="sm"
          variant="outline"
          disabled={fetching}
          loading={fetching}
          onPress={refresh}
        >
          {t("hub.channels.activity.refresh")}
        </Button>
      </View>
      {fetching ? (
        <Text style={settingsStyles.rowHint}>{t("hub.channels.activity.loading")}</Text>
      ) : null}
      {error ? (
        <Alert
          variant="warning"
          title={t("hub.channels.activity.unavailableTitle")}
          description={
            page
              ? t("hub.channels.activity.pageFailed")
              : t("hub.channels.activity.unavailableBody")
          }
        />
      ) : null}
      {page?.activity.length === 0 && !fetching ? (
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>{t("hub.channels.activity.empty")}</Text>
          <Button size="sm" variant="ghost" onPress={clearFilters}>
            {t("hub.channels.activity.clearFilters")}
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
          {t("hub.channels.activity.newer")}
        </Button>
        <Text style={settingsStyles.rowHint}>
          {page ? t("hub.channels.activity.events", { count: page.activity.length }) : ""}
        </Text>
        <Button
          size="sm"
          variant="ghost"
          disabled={!page?.nextCursor || fetching || showingPrevious || !!error}
          onPress={older}
        >
          {t("hub.channels.activity.older")}
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
  const { t } = useTranslation();
  const open = useCallback(() => select(entry), [entry, select]);
  const catalog = useChannelCatalog();
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
        >{`${activityChannelLabel(catalog.entries, entry.channel)} · ${entry.accountId ?? t("hub.channels.activity.account")}`}</Text>
        <Text style={settingsStyles.rowHint}>{new Date(entry.createdAt).toLocaleString()}</Text>
      </View>
      <Button size="sm" variant="ghost" onPress={open}>
        {t("hub.channels.activity.details")}
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
  const { t } = useTranslation();
  const catalog = useChannelCatalog();
  const recovery = entry.outcome === "ignored" ? channelAccessRecovery(entry.outcomeDetail) : null;
  return (
    <View style={styles.results}>
      <BackLink to={t("hub.channels.activity.backTo")} onPress={back} />
      <Text style={settingsStyles.rowHint}>{t("hub.channels.activity.positionsHint")}</Text>
      <View style={settingsStyles.card}>
        <ActivityDetail
          label={`${routeLabel(entry)} · ${outcomeLabel(entry)}`}
          value={`${activityChannelLabel(catalog.entries, entry.channel)} · ${entry.accountId ?? t("hub.channels.activity.account")}`}
        />
        <ActivityDetail
          label={t("hub.channels.activity.time")}
          value={new Date(entry.createdAt).toLocaleString()}
        />
        <ActivityDetail
          label={t("hub.channels.activity.conversation")}
          value={entry.conversationId}
        />
        {entry.threadId ? (
          <ActivityDetail label={t("hub.channels.activity.thread")} value={entry.threadId} />
        ) : null}
        <ActivityDetail label={t("hub.channels.activity.sender")} value={entry.providerSenderId} />
        {entry.limitReason ? (
          <ActivityDetail
            label={t("hub.channels.activity.routeLimit")}
            value={entry.limitReason.replaceAll("_", " ")}
          />
        ) : null}
        {entry.outcomeDetail && recovery === null ? (
          <ActivityDetail label={t("hub.channels.activity.result")} value={entry.outcomeDetail} />
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
  return i18n.t("hub.channels.activity.route", { position: entry.routePosition + 1 });
}
function outcomeLabel(entry: ActivityEntry): string {
  return entry.limitDecision === "denied"
    ? i18n.t("hub.channels.activity.blockedByLimits")
    : OUTCOMES[entry.outcome](i18n.t);
}
/**
 * The Hub owns the supported channel set, so its catalog names the Channel
 * (`channelCatalogLabel`). Only an activity row with no channel recorded at all
 * falls back to the generic word.
 */
function activityChannelLabel(
  catalog: readonly ChannelCatalogEntry[],
  channel: string | undefined,
): string {
  if (channel === undefined || channel.length === 0) return i18n.t("hub.channels.activity.channel");
  return channelCatalogLabel(catalog, channel);
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
        title: i18n.t("hub.channels.activity.recovery.identityTitle"),
        description: i18n.t("hub.channels.activity.recovery.identityBody"),
        identity: true,
        access: false,
      };
    case "linked Hub Member does not have access to this conversation":
      return {
        title: i18n.t("hub.channels.activity.recovery.accessTitle"),
        description: i18n.t("hub.channels.activity.recovery.accessBody"),
        identity: false,
        access: true,
      };
    case "sender may not trigger this route":
      return {
        title: i18n.t("hub.channels.activity.recovery.legacyTitle"),
        description: i18n.t("hub.channels.activity.recovery.legacyBody"),
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
  const { t } = useTranslation();
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
    () =>
      router.push({
        pathname: "/settings/hub/[hubSection]",
        params: { hubSection: "team", view: "access" },
      }),
    [router],
  );
  return (
    <Alert variant="warning" title={recovery.title} description={recovery.description}>
      {recovery.identity && connectionId ? (
        <Button size="sm" variant="outline" onPress={linkIdentity}>
          {t("hub.channels.activity.recovery.linkIdentity")}
        </Button>
      ) : null}
      {recovery.identity && !connectionId ? (
        <Text style={settingsStyles.rowHint}>
          {t("hub.channels.activity.recovery.noConnection")}
        </Text>
      ) : null}
      {recovery.access ? (
        <Button size="sm" variant="outline" onPress={manageAccess}>
          {t("hub.channels.activity.recovery.manageAccess")}
        </Button>
      ) : null}
    </Alert>
  );
}
