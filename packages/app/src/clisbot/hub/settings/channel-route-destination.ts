import { type SelectFieldOption } from "@/components/ui/select-field";
import { type ConfigurationKind, type RecordValue } from "./channel-settings-types";
import {
  arrayField,
  channelAccountKey,
  channelAccountLabel,
  stringField,
} from "./channel-settings-records";

/** What the Route form's Connection picker points at. */
export type RouteDestination =
  | { kind: "account"; key: string }
  | { kind: "connection"; id: string };

const ACCOUNT_DESTINATION = "account:";
const CONNECTION_DESTINATION = "connection:";

function routeDestinationValue(destination: RouteDestination): string {
  return destination.kind === "account"
    ? `${ACCOUNT_DESTINATION}${destination.key}`
    : `${CONNECTION_DESTINATION}${destination.id}`;
}

/** What the picked Connection means for the save: a new account, or a Route on one. */
export function routeDestinationState(
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

export function parseRouteDestination(value: string | null): RouteDestination | null {
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
export function routeDestinationOptions(
  accounts: readonly RecordValue[],
  connections: readonly { id: string; provider: string; name: string }[],
  adminScoped: boolean,
  channelName: (channel: string) => string,
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
        label: channelAccountLabel(account, channelName),
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
        label: `${channelName(connection.provider)} · ${connection.name}`,
        description: "No Routes yet",
      };
    });
  return [...existing, ...unused];
}

/** A first Route's default name: the Connection's name as an id, unique on its channel. */
export function suggestedChannelAccountId(
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

export function channelFormSelection(input: {
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
