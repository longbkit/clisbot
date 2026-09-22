// COMPAT(clisbot-channels): the relay's bounded retry of failed final answers
// (docs/features/channels/conversation-flow.md#outbound). A failed answer's
// `delivery_ledger` row keeps the message (`retry_payload`) and its next
// attempt time; the account's retrier claims due rows here. Claiming re-arms
// the row exactly like a replayed `recordDelivery` does (`failed` → `recorded`,
// `attempts` + 1) under a row lock, so a replay and a retry can never both
// post. Kept out of `channels.ts` so neither file grows past the size the
// standards allow; `ChannelStore.deliveryRetries` is the one way in.
import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";
import * as schema from "./schema.js";
import type { DeliveryRetryPayload } from "./schema.js";
import type { SupportedChannelName } from "../channels/catalog.js";
import type { DatabaseRuntime, DrizzleHandle } from "./runtime/index.js";

/** The account whose due retries one retrier claims. */
export interface DeliveryRetryScope {
  organizationId: string;
  channel: SupportedChannelName;
  accountId: string;
}

/** One ledger row's identity, as `confirmDelivery` / `failDelivery` take it. */
export interface DeliveryLedgerKey {
  organizationId: string;
  accountId: string;
  externalConversationId: string;
  externalThreadId: string | null;
  eventTurnId: string;
  sequence: number;
}

/** A due retry, now owned by the caller: the row is `recorded` again. */
export interface ClaimedDeliveryRetry {
  key: DeliveryLedgerKey;
  /** Attempts including the one the caller is about to make. */
  attempts: number;
  payload: DeliveryRetryPayload;
}

/** A final answer the relay gave up on, for the account's Activity. */
export interface ChannelOutboundFailureActivity {
  scope: DeliveryRetryScope;
  externalConversationId: string;
  externalThreadId: string | null;
  payload: DeliveryRetryPayload;
  outcomeDetail: string;
}

export class ChannelDeliveryRetryStore {
  private readonly database: DrizzleHandle;

  constructor(private readonly runtime: DatabaseRuntime) {
    this.database = runtime.drizzle();
  }

  /** Claim the account's oldest due retry, or nothing. */
  async claimDue(scope: DeliveryRetryScope, now: Date): Promise<ClaimedDeliveryRetry | undefined> {
    const ledger = schema.deliveryLedger;
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      const [due] = await transaction
        .select()
        .from(ledger)
        .where(
          and(
            eq(ledger.organizationId, scope.organizationId),
            eq(ledger.channel, scope.channel),
            eq(ledger.accountId, scope.accountId),
            eq(ledger.direction, "out"),
            eq(ledger.status, "failed"),
            isNotNull(ledger.retryPayload),
            lte(ledger.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(ledger.nextAttemptAt))
        .for("update", { skipLocked: true })
        .limit(1);
      if (due?.retryPayload == null) return undefined;
      const [claimed] = await transaction
        .update(ledger)
        .set({
          status: "recorded",
          failureReason: null,
          nextAttemptAt: null,
          attempts: sql`${ledger.attempts} + 1`,
        })
        .where(eq(ledger.id, due.id))
        .returning({ attempts: ledger.attempts });
      if (claimed === undefined) return undefined;
      return {
        key: {
          organizationId: due.organizationId,
          accountId: due.accountId,
          externalConversationId: due.externalConversationId,
          externalThreadId: due.externalThreadId,
          eventTurnId: due.eventTurnId,
          sequence: due.sequence,
        },
        attempts: claimed.attempts,
        payload: due.retryPayload,
      };
    });
  }

  /** Record the undelivered answer where the account's inbound decisions are:
   * same evidence shape, so Activity lists it without a second reader. No
   * message text, as with every Activity row. */
  async recordOutboundFailure(input: ChannelOutboundFailureActivity): Promise<void> {
    const { scope, payload } = input;
    await this.database.insert(schema.auditEvents).values({
      organizationId: scope.organizationId,
      actorKind: "system",
      actorIdentity: "channel",
      action: "channel.outbound.failed",
      subjectType: "channel_account",
      subjectId: `${scope.channel}/${scope.accountId}`,
      evidence: {
        channel: scope.channel,
        accountId: scope.accountId,
        routePosition: payload.routePosition,
        routeFingerprint: payload.routeFingerprint,
        conversationId: input.externalConversationId,
        threadId: input.externalThreadId,
        providerSenderId: payload.senderIdentity,
        outcome: "error",
        outcomeDetail: input.outcomeDetail,
        limitDecision: "not_evaluated",
      },
    });
  }
}
