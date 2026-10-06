import { ConnectionSelfLink } from "./channel-route-rule-link";
import { useCallback, useMemo, useState } from "react";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { Activity, Gauge, Plus, RotateCcw, Send } from "lucide-react-native";
import { ChannelActionsMenu, type ChannelMenuAction } from "./channel-actions-menu";
import { RuntimeDetailRow } from "./channel-list-rows";
import { ChannelIcon } from "@/clisbot/channels/channel-icon";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { ChannelAccountLimitsPanel } from "./channel-limits-fields";
import { channelConnectionDetail } from "../channel-identity-directory";
import { ChannelQrLinkPanel } from "./channel-qr-link-panel";
import { channelCatalogLabel } from "../channel-catalog";
import { useChannelCatalog } from "./channel-catalog-queries";
import { CHANNEL_QR_OPERATIONS_AVAILABLE, useChannelQrVerbs } from "./channel-qr-verbs";
import { channelRowStyles } from "./channel-settings-styles";
import {
  type EditingRoute,
  type HubChannelConfiguration,
  type HubConnection,
  type HubRuntimeAccount,
  type RecordValue,
} from "./channel-settings-types";
import {
  MANAGED_BY_ORGANIZATION,
  arrayField,
  channelAccountKey,
  channelLabel,
  stringField,
} from "./channel-settings-records";
import { ConnectionTestMessage } from "./channel-connection-test-message";
import { ChannelAccountRouteList, NoRoutesRow } from "./channel-route-rows";

export interface ChannelAccountListProps {
  accounts: RecordValue[];
  /** The organization's channel policy: its `defaults:` are what Rules inherit first. */
  policy: RecordValue | undefined;
  /** Connections whose Routes were all removed, or that never had one: still theirs to route. */
  unroutedConnections: HubConnection[];
  addRouteToConnection(connectionId: string): void;
  disconnectConnection(connection: HubConnection): Promise<void>;
  /** Shared agents and environments, to name what a Route runs. */
  resource: RecordValue;
  connections: HubConnection[];
  runtimes: HubRuntimeAccount[];
  runtimeAvailable: boolean | undefined;
  warnings: HubChannelConfiguration["warnings"];
  revisionVersion: number | undefined;
  adminScoped: boolean;
  pending: boolean;
  openActivity(accountKey: string | null): void;
  updateAccount(account: RecordValue, patch: RecordValue): Promise<void>;
  removeAccount(account: RecordValue): Promise<void>;
  retryAccount(account: RecordValue): Promise<void>;
  editRoute(route: EditingRoute): void;
  addRouteTo(accountKey: string): void;
  sendTestMessage(account: RecordValue, conversationId: string): Promise<void>;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}

type ChannelAccountRowProps = Omit<
  ChannelAccountListProps,
  "accounts" | "unroutedConnections" | "addRouteToConnection" | "disconnectConnection"
>;

export function ChannelAccountRow({
  account,
  ...props
}: ChannelAccountRowProps & { account: RecordValue }) {
  const { connections, runtimes, runtimeAvailable, adminScoped, pending } = props;
  const channel = stringField(account, "channel") ?? "channel";
  const accountId = stringField(account, "accountId") ?? "account";
  const key = channelAccountKey(account);
  const connection = connections.find(({ id }) => id === stringField(account, "connectionId"));
  const enabled = account["enabled"] !== false;
  const runtime = runtimes.find(
    (candidate) => candidate.channel === channel && candidate.account === accountId,
  );
  const [testing, setTesting] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const menu = useConnectionMenu({
    account,
    key,
    connection,
    enabled,
    runtime,
    setTesting,
    setLimitsOpen,
    props,
  });
  const closeTest = useCallback(() => setTesting(false), []);
  const sendTest = useCallback(
    (conversationId: string) => {
      setTesting(false);
      void props.sendTestMessage(account, conversationId);
    },
    [account, props],
  );
  return (
    <View style={settingsStyles.card}>
      <ConnectionHeader
        channel={channel}
        accountId={accountId}
        // The workspace or bot name the platform reports; the account id is the title already.
        detail={adminScoped ? MANAGED_BY_ORGANIZATION : connectionDetail(connection, accountId)}
        status={channelRuntimePresentation(enabled, runtimeAvailable, runtime)}
        enabled={enabled}
        pending={pending}
        menu={menu}
      />
      {/* A Connection waiting for its login says so in the login row below. */}
      {runtime?.detail && runtime.transport !== "needs-login" ? (
        <RuntimeDetailRow detail={runtime.detail} />
      ) : null}
      <ConnectionRuntimeFacts
        channel={channel}
        accountId={accountId}
        runtime={runtime}
        revisionVersion={props.revisionVersion}
      />
      <ConnectionSelfLink account={account} connection={connection} />
      {limitsOpen ? (
        <ConnectionLimits
          account={account}
          pending={pending}
          updateAccount={props.updateAccount}
          close={setLimitsOpen}
        />
      ) : null}
      {testing ? (
        <ConnectionTestMessage
          account={account}
          pending={pending}
          send={sendTest}
          close={closeTest}
        />
      ) : null}
      <ChannelAccountRouteList
        visible
        account={account}
        accountKey={key}
        routes={arrayField(account, "routes") as RecordValue[]}
        resource={props.resource}
        policy={props.policy}
        warnings={props.warnings}
        canManage
        pending={pending}
        editRoute={props.editRoute}
        moveRoute={props.moveRoute}
        removeRoute={props.removeRoute}
        addRoute={menu.addRoute}
      />
    </View>
  );
}

/** The bot's own limits and each conversation's, opened from the Connection's menu. */
function ConnectionLimits({
  account,
  pending,
  updateAccount,
  close,
}: {
  account: RecordValue;
  pending: boolean;
  updateAccount(account: RecordValue, patch: RecordValue): Promise<void>;
  close(open: boolean): void;
}) {
  const save = useCallback(
    async (limits: RecordValue | undefined) => {
      await updateAccount(account, { limits });
      close(false);
    },
    [account, close, updateAccount],
  );
  const cancel = useCallback(() => close(false), [close]);
  return (
    <View style={settingsStyles.rowBorder}>
      <ChannelAccountLimitsPanel limits={account["limits"]} pending={pending} save={save} />
      <View style={styles.limitsCancel}>
        <Button size="sm" variant="ghost" disabled={pending} onPress={cancel}>
          Cancel
        </Button>
      </View>
    </View>
  );
}

interface ConnectionMenu {
  addRoute(): void;
  /** Absent for a Connection with no Routes: there is nothing to switch. */
  toggleEnabled?: (value: boolean) => void;
  actions: ChannelMenuAction[];
  remove?: () => void;
}

/**
 * What the card does: switch it, and its … menu. Add Route heads the menu once
 * the Connection has a Route; before that it is the card's empty row's button.
 */
function useConnectionMenu({
  account,
  key,
  connection,
  enabled,
  runtime,
  setTesting,
  setLimitsOpen,
  props,
}: {
  account: RecordValue;
  key: string;
  connection: HubConnection | undefined;
  enabled: boolean;
  runtime: HubRuntimeAccount | undefined;
  setTesting(value: boolean): void;
  setLimitsOpen(value: boolean): void;
  props: ChannelAccountRowProps;
}): ConnectionMenu {
  const { addRouteTo, openActivity, retryAccount, updateAccount, removeAccount } = props;
  const canRetry = canRetryRuntime({
    connection,
    enabled,
    runtimeAvailable: props.runtimeAvailable,
    runtime,
  });
  const routed = arrayField(account, "routes").length > 0;
  return useMemo(
    () => ({
      addRoute: () => addRouteTo(key),
      toggleEnabled: (value: boolean) => void updateAccount(account, { enabled: value }),
      actions: [
        ...(routed ? [{ label: "Add Route", icon: Plus, onSelect: () => addRouteTo(key) }] : []),
        { label: "Send test message", icon: Send, onSelect: () => setTesting(true) },
        ...(canRetry
          ? [
              {
                label: "Retry runtime",
                icon: RotateCcw,
                onSelect: () => void retryAccount(account),
              },
            ]
          : []),
        { label: "View activity", icon: Activity, onSelect: () => openActivity(key) },
        // The bot's own limits, and each conversation's: Bot messages per
        // minute lives only here, since a post belongs to no sender.
        { label: "Limits", icon: Gauge, onSelect: () => setLimitsOpen(true) },
      ],
      ...(props.adminScoped ? {} : { remove: () => void removeAccount(account) }),
    }),
    [
      account,
      addRouteTo,
      canRetry,
      key,
      routed,
      openActivity,
      props.adminScoped,
      removeAccount,
      retryAccount,
      setLimitsOpen,
      setTesting,
      updateAccount,
    ],
  );
}

/** One line: what the Connection is, whether it runs, and what can be done with it. */
function ConnectionHeader({
  channel,
  accountId,
  detail,
  status,
  enabled,
  pending,
  menu,
}: {
  channel: string;
  accountId: string;
  detail: string | null;
  status: { label: string; variant: StatusBadgeVariant };
  enabled: boolean;
  pending: boolean;
  menu: ConnectionMenu;
}) {
  const compact = useIsCompactFormFactor();
  const catalog = useChannelCatalog();
  return (
    <View
      style={[settingsStyles.row, channelRowStyles.row, compact && channelRowStyles.stackedRow]}
    >
      <View style={[settingsStyles.rowContent, styles.connectionTitle]}>
        <ChannelIcon channel={channel} size={14} />
        <Text style={settingsStyles.rowTitle}>
          {`${channelCatalogLabel(catalog.entries, channel)} · ${accountId}`}
        </Text>
        <StatusBadge label={status.label} variant={status.variant} />
        {detail === null ? null : (
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        {menu.toggleEnabled === undefined ? null : (
          <Switch
            value={enabled}
            onValueChange={menu.toggleEnabled}
            disabled={pending}
            accessibilityLabel={`${enabled ? "Disable" : "Enable"} ${accountId}`}
          />
        )}
        {menu.actions.length === 0 && menu.remove === undefined ? null : (
          <ChannelActionsMenu
            label={`Actions for ${accountId}`}
            disabled={pending}
            actions={menu.actions}
            {...(menu.remove === undefined ? {} : { remove: menu.remove })}
          />
        )}
      </View>
    </View>
  );
}

/**
 * A Connection with no Routes: its credential is kept (removing a Connection's
 * Routes offers to keep it), so it stays on the page with the one thing to do
 * next, and Remove disconnects it unless something else still uses it.
 */
export function UnroutedConnectionCard({
  connection,
  pending,
  addRoute,
  disconnect,
}: {
  connection: HubConnection;
  pending: boolean;
  addRoute(connectionId: string): void;
  disconnect(connection: HubConnection): Promise<void>;
}) {
  const menu = useMemo<ConnectionMenu>(
    () => ({
      addRoute: () => addRoute(connection.id),
      actions: [],
      ...(connection.consumers.length > 0 ? {} : { remove: () => void disconnect(connection) }),
    }),
    [addRoute, connection, disconnect],
  );
  return (
    <View style={settingsStyles.card}>
      <ConnectionHeader
        channel={connection.provider}
        accountId={connection.name}
        detail={connection.externalName}
        status={NO_ROUTES_STATUS}
        enabled={false}
        pending={pending}
        menu={menu}
      />
      <View style={settingsStyles.rowBorder}>
        <NoRoutesRow pending={pending} addRoute={menu.addRoute} />
      </View>
    </View>
  );
}

const NO_ROUTES_STATUS = { label: "No Routes", variant: "warning" } as const;

/** The platform's name for the bot or workspace, unless it only repeats the account id. */
function connectionDetail(connection: HubConnection | undefined, accountId: string): string | null {
  if (connection === undefined) return "Connection unavailable";
  const detail = channelConnectionDetail(connection);
  if (detail === accountId) return null;
  return detail.endsWith(` · ${accountId}`) ? detail.slice(0, -` · ${accountId}`.length) : detail;
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

/**
 * What the header line cannot say in words, and only when there is something to
 * say: which configuration the Host loaded when it did not verify or load, and
 * the login row when a QR-login account has no live session. A healthy Connection shows
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
  const needsLogin = runtime?.transport === "needs-login";
  return (
    <>
      {loaded ? null : (
        <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.statusPanel]}>
          <Text
            style={settingsStyles.rowHint}
          >{`Configuration revision ${revisionVersion ?? "—"} · Integrity ${runtime?.integrity ?? "not-checked"} · Load ${runtime?.loadTrace ?? "not-loaded"}`}</Text>
        </View>
      )}
      {needsLogin ? <ChannelAccountQrLinking channel={channel} accountId={accountId} /> : null}
    </>
  );
}

function ChannelAccountQrLinking({ channel, accountId }: { channel: string; accountId: string }) {
  const verbs = useChannelQrVerbs({ channel, accountId });
  return (
    <ChannelQrLinkPanel
      channel={channel}
      available={CHANNEL_QR_OPERATIONS_AVAILABLE}
      verbs={verbs}
    />
  );
}

/** The Connection's state as a badge, coloured by whether it needs a look. */
function channelRuntimePresentation(
  enabled: boolean,
  runtimeAvailable: boolean | undefined,
  runtime: HubRuntimeAccount | undefined,
): { label: string; variant: StatusBadgeVariant } {
  if (!enabled) return { label: "Off", variant: "muted" };
  const label = channelRuntimeLabel(runtimeAvailable, runtime);
  if (runtime?.transport === "started") return { label, variant: "success" };
  if (runtimeAvailable === false || runtime?.transport === "failed")
    return { label, variant: "error" };
  if (runtime?.transport === "needs-login" || runtime === undefined)
    return { label, variant: "warning" };
  return { label, variant: "muted" };
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
      return "Needs login";
    default:
      return channelLabel(runtime.transport);
  }
}

const styles = StyleSheet.create((theme) => ({
  connectionTitle: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: theme.spacing[2],
    rowGap: theme.spacing[1],
  },
  limitsCancel: {
    alignItems: "flex-start",
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  statusPanel: { flexDirection: "column", alignItems: "flex-start", gap: theme.spacing[2] },
}));
