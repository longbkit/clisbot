/**
 * The operator read model for the durable ingress queue.
 *
 * Mirrors upstream's `src/channels/message/ingress-queue-health.ts`: read-only,
 * counts and ages, never payloads. A queued payload is the user's message —
 * a health or listing surface returns the envelope's routing facts and the
 * failure text and nothing else, so an operator can triage a backlog without
 * being handed conversation content.
 */
import type { ChannelStore } from "../../db/channels.js";
import type { ChannelIngressQueueRecord } from "../../db/types.js";
import type { ChannelIngressQueueStatus } from "../../db/schema.js";

/** One account's queue depth. `oldestPendingAgeMs` is the backlog's age. */
export interface ChannelIngressAccountHealth {
  channel: string;
  accountId: string;
  pending: number;
  claimed: number;
  /** Rows with a scheduled retry — still backlog, not yet dead-lettered. */
  retrying: number;
  deadLettered: number;
  completed: number;
  oldestPendingAgeMs: number | null;
  lanesBlocked: number;
}

export type ChannelIngressTotals = Omit<ChannelIngressAccountHealth, "channel" | "accountId">;

export interface ChannelIngressHealth {
  accounts: readonly ChannelIngressAccountHealth[];
  totals: ChannelIngressTotals;
}

/** A queue row as an operator sees it: routing facts and failure, no payload. */
export interface ChannelIngressEntryView {
  id: string;
  channel: string;
  accountId: string;
  status: ChannelIngressQueueStatus;
  attempts: number;
  laneKey: string;
  externalEventId: string;
  externalMessageId: string;
  externalConversationId: string;
  externalThreadId: string | null;
  availableAt: string;
  createdAt: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  failedReason: string | null;
  failedAt: string | null;
  completedAt: string | null;
}

type IngressHealthStore = Pick<ChannelStore, "summarizeChannelIngress">;

function emptyTotals(): ChannelIngressTotals {
  return {
    pending: 0,
    claimed: 0,
    retrying: 0,
    deadLettered: 0,
    completed: 0,
    oldestPendingAgeMs: null,
    lanesBlocked: 0,
  };
}

function accumulate(totals: ChannelIngressTotals, account: ChannelIngressAccountHealth): void {
  totals.pending += account.pending;
  totals.claimed += account.claimed;
  totals.retrying += account.retrying;
  totals.deadLettered += account.deadLettered;
  totals.completed += account.completed;
  totals.lanesBlocked += account.lanesBlocked;
  if (account.oldestPendingAgeMs === null) return;
  totals.oldestPendingAgeMs = Math.max(totals.oldestPendingAgeMs ?? 0, account.oldestPendingAgeMs);
}

/** Per-account queue depth for one organization, plus the organization total. */
export async function channelIngressHealth(
  store: IngressHealthStore,
  organizationId: string,
  now: Date = new Date(),
): Promise<ChannelIngressHealth> {
  const summaries = await store.summarizeChannelIngress({ organizationId, now });
  const totals = emptyTotals();
  const accounts: ChannelIngressAccountHealth[] = [];
  for (const summary of summaries) {
    const oldest = summary.oldestPendingAt;
    const account: ChannelIngressAccountHealth = {
      channel: summary.channel,
      accountId: summary.accountId,
      pending: summary.pending,
      claimed: summary.claimed,
      retrying: summary.retrying,
      deadLettered: summary.deadLettered,
      completed: summary.completed,
      oldestPendingAgeMs: oldest === null ? null : Math.max(0, now.getTime() - oldest.getTime()),
      lanesBlocked: summary.lanesBlocked,
    };
    accumulate(totals, account);
    accounts.push(account);
  }
  return { accounts, totals };
}

/** The status-merge key. NUL separator, so no channel/account pair collides. */
export function channelIngressAccountKey(channel: string, accountId: string): string {
  return `${channel}\u0000${accountId}`;
}

/** Index one organization's health by account, for a per-account status merge. */
export function channelIngressHealthByAccount(
  health: ChannelIngressHealth,
): ReadonlyMap<string, ChannelIngressAccountHealth> {
  return new Map(
    health.accounts.map((account) => [
      channelIngressAccountKey(account.channel, account.accountId),
      account,
    ]),
  );
}

export function channelIngressEntryView(
  record: ChannelIngressQueueRecord,
): ChannelIngressEntryView {
  return {
    id: record.id,
    channel: record.channel,
    accountId: record.accountId,
    status: record.status,
    attempts: record.attempts,
    laneKey: record.laneKey,
    externalEventId: record.externalEventId,
    externalMessageId: record.externalMessageId,
    externalConversationId: record.externalConversationId,
    externalThreadId: record.externalThreadId,
    availableAt: record.availableAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    lastAttemptAt: record.lastAttemptAt?.toISOString() ?? null,
    lastError: record.lastError,
    failedReason: record.failedReason,
    failedAt: record.failedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
  };
}
