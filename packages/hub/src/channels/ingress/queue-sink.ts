/**
 * The store boundary for one channel account's durable ingress.
 *
 * Upstream's ingress queue is a SQLite table the channel opens directly
 * (`src/channels/message/ingress-queue.ts`). Fusion's Hub owns persistence, so
 * this adapter is what replaces that file: it maps the transport-facing
 * `InboundQueueSink` contract onto `ChannelStore`, and nothing above it knows
 * which database is underneath. Every call is pinned to one organization —
 * the account's — so a channel can never claim another tenant's backlog.
 */
import type { InboundQueueSink } from "@getpaseo/channels-shared";
import type { ChannelStore } from "../../db/channels.js";
import type {
  ChannelIngressQueueRecord,
  ChannelIngressReleaseBudget,
  FailChannelIngressInput,
} from "../../db/types.js";

/**
 * The ceiling on plane back-pressure for one event.
 *
 * A release hands the row back unattempted — that is the point, the plane
 * refused it for now rather than failing it — so the retry budget never moves
 * and nothing else ends the row. A route whose concurrency ceiling is
 * permanently full, or a lane whose head can never be admitted, would otherwise
 * defer the same message forever while its lane stayed blocked behind it. Past
 * either bound the row dead-letters, which is a thing an operator can see and
 * resubmit; a silently immortal pending row is not.
 */
export const CHANNEL_INGRESS_RELEASE_BUDGET: ChannelIngressReleaseBudget = Object.freeze({
  maxReleases: 50,
  pendingTtlMs: 24 * 60 * 60 * 1_000,
});

type SinkDisposition = Parameters<InboundQueueSink["fail"]>[0]["disposition"];

/** The sink contract spells its dispositions with a dash; the store's column
 * spells them with an underscore. Nothing else differs. */
function settleDisposition(disposition: SinkDisposition): FailChannelIngressInput["disposition"] {
  if (disposition === "dead-letter") return "dead_letter";
  return disposition;
}

export interface ChannelIngressQueueSinkOptions {
  store: ChannelStore;
  organizationId: string;
  channel: string;
  accountId: string;
  /** Fired after a durable admission so the drain can wake without a timer. */
  onAdmitted?: () => void;
  /** Overrides the release ceiling (tests and, later, an operator knob). */
  releaseBudget?: ChannelIngressReleaseBudget;
  /** Fired when a release ended the row instead of returning it. The drain
   * counts it as a deferral — it asked for one — so the log is here. */
  onReleaseBudgetExhausted?: (record: ChannelIngressQueueRecord) => void;
}

export function createChannelIngressQueueSink(
  options: ChannelIngressQueueSinkOptions,
): InboundQueueSink {
  const { store, organizationId, channel, accountId } = options;
  const workerId = `${channel}:${accountId}`;
  return {
    enqueue: async (params) => {
      const admitted = await store.enqueueChannelIngress({
        organizationId,
        channel,
        accountId,
        externalEventId: params.externalEventId,
        externalMessageId: params.externalMessageId,
        externalConversationId: params.externalConversationId,
        ...(params.externalThreadId === undefined
          ? {}
          : { externalThreadId: params.externalThreadId }),
        laneKey: params.laneKey,
        payload: params.payload,
      });
      options.onAdmitted?.();
      return { created: admitted.created, id: admitted.record.id };
    },
    claim: async (params) => {
      const row = await store.claimChannelIngress({
        organizationId,
        workerId: params.workerId || workerId,
        leaseMs: params.leaseMs,
        channel: params.channel,
        accountId: params.accountId,
      });
      if (row === undefined || row.claimToken === null) return undefined;
      return {
        id: row.id,
        claimToken: row.claimToken,
        payload: row.payload,
        laneKey: row.laneKey,
        attempts: row.attempts,
        receivedAt: row.createdAt,
      };
    },
    complete: async (params) => {
      await store.completeChannelIngress(params);
    },
    refresh: (params) => store.refreshChannelIngress(params),
    fail: async (params) => {
      const disposition = settleDisposition(params.disposition);
      const record = await store.failChannelIngress({
        id: params.id,
        workerId: params.workerId,
        claimToken: params.claimToken,
        error: params.error,
        disposition,
        ...(disposition === "release"
          ? { budget: options.releaseBudget ?? CHANNEL_INGRESS_RELEASE_BUDGET }
          : {}),
        ...(params.reason === undefined ? {} : { reason: params.reason }),
        ...(params.retryAt === undefined ? {} : { retryAt: params.retryAt }),
      });
      if (disposition === "release" && record.status === "dead_letter") {
        options.onReleaseBudgetExhausted?.(record);
      }
    },
    recover: async (scope) => {
      if (scope.organizationId !== organizationId) {
        throw new Error("inbound queue organization scope mismatch");
      }
      return store.recoverStaleChannelIngress(scope);
    },
  };
}
