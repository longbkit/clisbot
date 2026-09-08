/**
 * One row per configured Channel account, joined from the three reads the Hub
 * actually offers: the authored accounts in `channel-configuration`, the runtime
 * rows in `channel-accounts/status`, and `connections` for the provider identity.
 *
 * The status row carries no identity of its own — the bot's name lives on the
 * Connection the account references — so a row without a resolvable
 * `connectionId` reports no identity rather than guessing one.
 */
import {
  channelCatalogLabel,
  isConnectableChannel,
  type ChannelCatalogEntry,
} from "./channel-catalog";
import type { ChannelTransportState } from "./channel-capability";
import {
  channelIngressSeverity,
  channelIngressSummary,
  formatChannelQueueAge,
  type ChannelIngressSeverity,
} from "./channel-ingress-operations";
import type { HubChannelIngressCounts } from "./contracts";

export interface ChannelRuntimeRow {
  channel: string;
  account: string;
  transport: ChannelTransportState;
  detail?: string | undefined;
  ingress?: HubChannelIngressCounts | undefined;
}

export interface ChannelConnectionRow {
  id: string;
  provider: string;
  name: string;
  externalName: string | null;
}

export interface ChannelAccountHealth {
  key: string;
  channel: string;
  channelLabel: string;
  accountId: string;
  enabled: boolean;
  transport: ChannelTransportState | null;
  transportLabel: string;
  detail: string | null;
  /** The Connection's provider identity, when the account references one. */
  identity: string | null;
  connectionId: string | null;
  ingress: HubChannelIngressCounts | null;
  ingressSummary: string | null;
  oldestPending: string | null;
  severity: ChannelIngressSeverity;
}

const TRANSPORT_LABELS: Readonly<Record<ChannelTransportState, string>> = {
  starting: "Starting",
  started: "Running",
  deferred: "Deferred",
  stopped: "Stopped",
  failed: "Failed",
  "needs-login": "Needs linking",
  disabled: "Disabled",
};

const TRANSPORT_SEVERITY: Readonly<Record<ChannelTransportState, ChannelIngressSeverity>> = {
  starting: "ok",
  started: "ok",
  deferred: "warning",
  stopped: "warning",
  failed: "error",
  "needs-login": "warning",
  disabled: "warning",
};

export function channelAccountKey(channel: string, accountId: string): string {
  return `${channel}:${accountId}`;
}

function text(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function channelAccountHealthRows(input: {
  accounts: readonly Record<string, unknown>[] | undefined;
  runtime: readonly ChannelRuntimeRow[] | undefined;
  connections: readonly ChannelConnectionRow[] | undefined;
  /** The Hub's catalog, for labels. Empty while it is loading or unavailable. */
  catalog: readonly ChannelCatalogEntry[];
}): ChannelAccountHealth[] {
  const runtime = new Map(
    (input.runtime ?? []).map((row) => [channelAccountKey(row.channel, row.account), row]),
  );
  const connections = new Map((input.connections ?? []).map((row) => [row.id, row]));
  return (input.accounts ?? []).flatMap((account) => {
    const channel = text(account, "channel");
    const accountId = text(account, "accountId");
    if (channel === null || accountId === null) return [];
    const connectionId = text(account, "connectionId");
    const connection = connectionId === null ? undefined : connections.get(connectionId);
    const status = runtime.get(channelAccountKey(channel, accountId));
    const ingress = status?.ingress ?? null;
    return [
      {
        key: channelAccountKey(channel, accountId),
        channel,
        channelLabel: channelCatalogLabel(input.catalog, channel),
        accountId,
        enabled: account["enabled"] !== false,
        transport: status?.transport ?? null,
        transportLabel: status === undefined ? "Not running" : TRANSPORT_LABELS[status.transport],
        detail: status?.detail ?? null,
        identity: connection?.externalName ?? null,
        connectionId,
        ingress,
        ingressSummary: ingress === null ? null : channelIngressSummary(ingress),
        oldestPending: ingress === null ? null : formatChannelQueueAge(ingress.oldestPendingAgeMs),
        severity: accountSeverity(status?.transport ?? null, ingress),
      },
    ];
  });
}

function accountSeverity(
  transport: ChannelTransportState | null,
  ingress: HubChannelIngressCounts | null,
): ChannelIngressSeverity {
  if (transport === null) return "warning";
  const transportSeverity = TRANSPORT_SEVERITY[transport];
  if (transportSeverity !== "ok" || ingress === null) return transportSeverity;
  return channelIngressSeverity(ingress);
}

export interface ChannelCatalogRow {
  channel: string;
  label: string;
  /** The catalog entry, or undefined for a channel only this Hub knows about. */
  entry: ChannelCatalogEntry | undefined;
  status: "in-repo" | "planned" | "unknown";
  connectable: boolean;
  accounts: ChannelAccountHealth[];
}

/**
 * Every catalog channel in catalog order, then any channel with accounts that the
 * catalog does not carry. The second list is what keeps a Hub whose catalog is
 * unavailable — or which runs a channel it does not publish — from looking like
 * it has no channels at all.
 */
export function channelCatalogRows(
  accounts: readonly ChannelAccountHealth[],
  catalog: readonly ChannelCatalogEntry[],
): ChannelCatalogRow[] {
  const byChannel = new Map<string, ChannelAccountHealth[]>();
  for (const account of accounts) {
    const existing = byChannel.get(account.channel);
    if (existing === undefined) byChannel.set(account.channel, [account]);
    else existing.push(account);
  }
  const rows = catalog.map((entry) => ({
    channel: entry.id,
    label: entry.label,
    entry,
    status: entry.status,
    connectable: isConnectableChannel(entry),
    accounts: byChannel.get(entry.id) ?? [],
  }));
  const known = new Set(catalog.map((entry) => entry.id));
  const extra = [...byChannel.keys()]
    .filter((channel) => !known.has(channel))
    .sort()
    .map((channel) => ({
      channel,
      label: channel,
      entry: undefined,
      status: "unknown" as const,
      connectable: false,
      accounts: byChannel.get(channel) ?? [],
    }));
  return [...rows, ...extra];
}

export const CHANNEL_STATUS_LABELS: Readonly<Record<ChannelCatalogRow["status"], string>> = {
  "in-repo": "Available",
  planned: "Coming soon",
  unknown: "Reported by this Hub",
};

/** Severity as a `<StatusBadge>` variant. */
export function channelSeverityVariant(
  severity: ChannelIngressSeverity,
): "success" | "warning" | "error" {
  return severity === "ok" ? "success" : severity;
}
