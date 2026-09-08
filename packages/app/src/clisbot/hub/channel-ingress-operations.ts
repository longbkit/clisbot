/**
 * The presentation model for the ingress operations panel.
 *
 * The Hub already redacts: `channel-ingress/events` returns routing facts and
 * failure text, never the queued payload. This module keeps that property on the
 * app side by naming the fields a row may render, so a future contract addition
 * cannot leak a message body into the list by accident.
 */
import { channelCatalogLabel, type ChannelCatalogEntry } from "./channel-catalog";
import type { HubChannelIngressCounts, HubChannelIngressEvent } from "./contracts";

export type ChannelIngressSeverity = "ok" | "warning" | "error";

/** A backlog this old is worth an operator's attention even with no failures. */
export const CHANNEL_INGRESS_STALE_MS = 5 * 60_000;

/** Rows waiting on the queue: claimed work included, dead letters excluded. */
export function channelIngressDepth(counts: HubChannelIngressCounts): number {
  return counts.pending + counts.claimed + counts.retrying;
}

export function channelIngressSeverity(counts: HubChannelIngressCounts): ChannelIngressSeverity {
  if (counts.deadLettered > 0) return "error";
  if (counts.lanesBlocked > 0) return "warning";
  if ((counts.oldestPendingAgeMs ?? 0) >= CHANNEL_INGRESS_STALE_MS) return "warning";
  return "ok";
}

/** "3 pending · 1 retrying · 2 dead-lettered", dropping every empty bucket. */
export function channelIngressSummary(counts: HubChannelIngressCounts): string {
  const parts = [
    counts.pending > 0 ? `${String(counts.pending)} pending` : null,
    counts.claimed > 0 ? `${String(counts.claimed)} in flight` : null,
    counts.retrying > 0 ? `${String(counts.retrying)} retrying` : null,
    counts.deadLettered > 0 ? `${String(counts.deadLettered)} dead-lettered` : null,
    counts.lanesBlocked > 0 ? `${String(counts.lanesBlocked)} lanes blocked` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "Queue empty" : parts.join(" · ");
}

/** Coarse on purpose: this is a backlog age, not a stopwatch. */
export function formatChannelQueueAge(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 60_000) return "under a minute";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ${String(minutes % 60)}m`;
  return `${String(Math.floor(hours / 24))}d ${String(hours % 24)}h`;
}

export interface ChannelIngressAccountRow {
  key: string;
  channel: string;
  channelLabel: string;
  accountId: string;
  counts: HubChannelIngressCounts;
  depth: number;
  severity: ChannelIngressSeverity;
  summary: string;
  oldestPending: string | null;
}

export function channelIngressAccountRows(
  accounts: readonly (HubChannelIngressCounts & { channel: string; accountId: string })[],
  catalog: readonly ChannelCatalogEntry[],
): ChannelIngressAccountRow[] {
  return accounts
    .map((account) => ({
      key: `${account.channel}:${account.accountId}`,
      channel: account.channel,
      channelLabel: channelCatalogLabel(catalog, account.channel),
      accountId: account.accountId,
      counts: account,
      depth: channelIngressDepth(account),
      severity: channelIngressSeverity(account),
      summary: channelIngressSummary(account),
      oldestPending: formatChannelQueueAge(account.oldestPendingAgeMs),
    }))
    .sort((left, right) => right.depth - left.depth || left.key.localeCompare(right.key));
}

/**
 * One dead-letter row, reduced to what an operator triages with. Every field is
 * an id, a count, a timestamp or the Hub's own failure text; nothing here can
 * carry conversation content.
 */
export interface ChannelDeadLetterRow {
  id: string;
  title: string;
  conversation: string;
  attempts: string;
  failedAt: string | null;
  reason: string;
}

export function channelDeadLetterRow(
  event: HubChannelIngressEvent,
  catalog: readonly ChannelCatalogEntry[],
): ChannelDeadLetterRow {
  const thread = event.externalThreadId === null ? "" : ` · thread ${event.externalThreadId}`;
  return {
    id: event.id,
    title: `${channelCatalogLabel(catalog, event.channel)} · ${event.accountId}`,
    conversation: `${event.externalConversationId}${thread}`,
    attempts: `${String(event.attempts)} ${event.attempts === 1 ? "attempt" : "attempts"}`,
    failedAt: event.failedAt ?? event.lastAttemptAt,
    reason: event.failedReason ?? event.lastError ?? "No failure reason was recorded.",
  };
}

/** Selection is a plain set; the panel owns it and hands it back on every edit. */
export function toggleChannelIngressSelection(
  selected: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * `resubmit` only reopens dead-lettered rows, so a selection is filtered to
 * those before it is sent: sending a completed row's id is a request the Hub
 * silently does nothing with, which reads as a broken button.
 */
export function resubmittableIngressIds(
  events: readonly HubChannelIngressEvent[],
  selected: ReadonlySet<string>,
): string[] {
  return events
    .filter((event) => event.status === "dead_letter" && selected.has(event.id))
    .map((event) => event.id);
}

export function channelIngressResubmitConfirmation(count: number): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  const noun = count === 1 ? "event" : "events";
  return {
    title: `Resubmit ${String(count)} ${noun}?`,
    message: `They go back on the queue as pending and run again in their conversation's lane. Anything that failed for a reason that has not changed will fail again.`,
    confirmLabel: "Resubmit",
  };
}

export function channelIngressPruneConfirmation(): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  return {
    title: "Prune the queue now?",
    message:
      "Completed and dead-lettered rows past the Hub's retention window are deleted. Pending and in-flight work is untouched. This cannot be undone.",
    confirmLabel: "Prune",
  };
}

export const CHANNEL_INGRESS_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: "Pending",
  claimed: "In flight",
  completed: "Completed",
  failed: "Failed",
  dead_letter: "Dead-lettered",
};

export function channelIngressStatusLabel(status: string): string {
  return CHANNEL_INGRESS_STATUS_LABELS[status] ?? status;
}
