import { useCallback } from "react";
import { channelCatalogLabel } from "../channel-catalog";
import { useChannelCatalog } from "./channel-catalog-queries";
import { type RecordValue } from "./channel-settings-types";

export function stringField(record: RecordValue | undefined, key: string): string | null {
  if (record === undefined) return null;
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export function channelAccountKey(account: RecordValue): string {
  return `${stringField(account, "channel") ?? "channel"}:${stringField(account, "accountId") ?? "account"}`;
}

/** The catalog's name for a channel ("Zalo Official Bot", not "Zalo"). */
export function useChannelName(): (channel: string) => string {
  const catalog = useChannelCatalog();
  return useCallback(
    (channel: string) => channelCatalogLabel(catalog.entries, channel),
    [catalog.entries],
  );
}

export function channelAccountLabel(
  account: RecordValue | undefined,
  channelName: (channel: string) => string,
): string {
  if (account === undefined) return "Connection unavailable";
  return `${channelName(stringField(account, "channel") ?? "channel")} · ${stringField(account, "accountId") ?? "account"}`;
}

/** What a Connection Admin sees where the Connection would be named. */
export const MANAGED_BY_ORGANIZATION = "Managed by Organization Admins";

export function arrayField(record: RecordValue, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

export function withAccountPatch(account: RecordValue, patch: RecordValue): RecordValue {
  const next: RecordValue = { ...account, ...patch };
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
  return next;
}

export function objectField(record: RecordValue, key: string): RecordValue | null {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

export function routeTargetSummary(route: RecordValue): string {
  const workflow = stringField(route, "workflow");
  if (workflow !== null) return `Automation · ${workflow}`;
  const agent = stringField(route, "agent");
  return agent === null ? "Unavailable target" : `Agent · ${agent}`;
}

export function channelLabel(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
