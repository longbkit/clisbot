/**
 * The presentation model for the ingress operations panel.
 *
 * The Hub already redacts: `channel-ingress/events` returns routing facts and
 * failure text, never the queued payload. This module keeps that property on the
 * app side by naming the fields a row may render, so a future contract addition
 * cannot leak a message body into the list by accident.
 */
import { i18n } from "@/i18n/i18next";
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
    counts.pending > 0 ? i18n.t("hub.channels.ingress.pending", { count: counts.pending }) : null,
    counts.claimed > 0 ? i18n.t("hub.channels.ingress.inFlight", { count: counts.claimed }) : null,
    counts.retrying > 0
      ? i18n.t("hub.channels.ingress.retrying", { count: counts.retrying })
      : null,
    counts.deadLettered > 0
      ? i18n.t("hub.channels.ingress.deadLettered", { count: counts.deadLettered })
      : null,
    counts.lanesBlocked > 0
      ? i18n.t("hub.channels.ingress.lanesBlocked", { count: counts.lanesBlocked })
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? i18n.t("hub.channels.ingress.queueEmpty") : parts.join(" · ");
}

/** Coarse on purpose: this is a backlog age, not a stopwatch. */
export function formatChannelQueueAge(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 60_000) return i18n.t("hub.channels.ingress.age.underMinute");
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return i18n.t("hub.channels.ingress.age.minutes", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return i18n.t("hub.channels.ingress.age.hours", { hours, minutes: minutes % 60 });
  }
  return i18n.t("hub.channels.ingress.age.days", {
    days: Math.floor(hours / 24),
    hours: hours % 24,
  });
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
  return {
    id: event.id,
    title: `${channelCatalogLabel(catalog, event.channel)} · ${event.accountId}`,
    conversation:
      event.externalThreadId === null
        ? event.externalConversationId
        : i18n.t("hub.channels.ingress.conversationThread", {
            conversation: event.externalConversationId,
            thread: event.externalThreadId,
          }),
    attempts: i18n.t("hub.channels.ingress.attempts", { count: event.attempts }),
    failedAt: event.failedAt ?? event.lastAttemptAt,
    reason: event.failedReason ?? event.lastError ?? i18n.t("hub.channels.ingress.noReason"),
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
  return {
    title: i18n.t("hub.channels.ingress.resubmitTitle", { count }),
    message: i18n.t("hub.channels.ingress.resubmitMessage"),
    confirmLabel: i18n.t("hub.channels.ingress.resubmit"),
  };
}

export function channelIngressPruneConfirmation(): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  return {
    title: i18n.t("hub.channels.ingress.pruneTitle"),
    message: i18n.t("hub.channels.ingress.pruneMessage"),
    confirmLabel: i18n.t("hub.channels.ingress.prune"),
  };
}

const CHANNEL_INGRESS_STATUS_LABELS: Readonly<Record<string, () => string>> = {
  pending: () => i18n.t("hub.channels.ingress.status.pending"),
  claimed: () => i18n.t("hub.channels.ingress.status.claimed"),
  completed: () => i18n.t("hub.channels.ingress.status.completed"),
  failed: () => i18n.t("hub.channels.ingress.status.failed"),
  dead_letter: () => i18n.t("hub.channels.ingress.status.deadLetter"),
};

export function channelIngressStatusLabel(status: string): string {
  return CHANNEL_INGRESS_STATUS_LABELS[status]?.() ?? status;
}
