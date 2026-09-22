import type * as schema from "./schema.js";
import type { ChannelIngressQueueRecord } from "./types.js";

/** One `channel_ingress_queue` row as the store hands it out. */
export function toChannelIngress(
  row: typeof schema.channelIngressQueue.$inferSelect,
): ChannelIngressQueueRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channel: row.channel,
    accountId: row.accountId,
    externalEventId: row.externalEventId,
    externalMessageId: row.externalMessageId,
    externalConversationId: row.externalConversationId,
    externalThreadId: row.externalThreadId,
    laneKey: row.laneKey,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    releases: row.releases,
    availableAt: row.availableAt,
    claimedBy: row.claimedBy,
    claimToken: row.claimToken,
    leaseExpiresAt: row.leaseExpiresAt,
    lastAttemptAt: row.lastAttemptAt,
    lastError: row.lastError,
    failedReason: row.failedReason,
    failedAt: row.failedAt,
    createdAt: row.createdAt,
    resubmittedAt: row.resubmittedAt,
    completedAt: row.completedAt,
    bindingKey: row.bindingKey,
    inboxState: row.inboxState,
    sentIn: row.sentIn,
  };
}
