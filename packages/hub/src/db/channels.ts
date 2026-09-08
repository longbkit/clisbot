// COMPAT(clisbot-channels): fork-owned channel control plane persistence (plan P3/P4/P5,
// implementation doc §3.1/§4.2/§4.3.4). Houses the query functions for the three
// additive channel tables — telegram_connections, thread_bindings, delivery_ledger — so
// upstream db files keep their byte-identical surface. An unmodified upstream Hub
// never imports this module.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import * as schema from "./schema.js";
import { ChannelAccessStore } from "./channel-access.js";
import type { SupportedChannelName } from "../channels/catalog.js";
import type { DatabaseRuntime, DrizzleHandle } from "./runtime/index.js";
import type {
  AbandonThreadBindingInput,
  ConfirmDeliveryInput,
  ConsumeInboundInput,
  DeliveryLedgerRecord,
  FailDeliveryInput,
  PendingThreadBindingInput,
  RecordDeliveryInput,
  RecordDeliveryResult,
  RecordInboundInput,
  RecordInboundResult,
  ResolveThreadBindingInput,
  ThreadBindingRecord,
  ChannelIngressQueueRecord,
  EnqueueChannelIngressInput,
  EnqueueChannelIngressResult,
  ClaimChannelIngressInput,
  SettleChannelIngressInput,
  FailChannelIngressInput,
  RecoverStaleChannelIngressInput,
  RefreshChannelIngressInput,
  ResubmitChannelIngressInput,
  PruneChannelIngressInput,
  ChannelIngressSummaryRecord,
  SummarizeChannelIngressInput,
} from "./types.js";

type HubDatabase = DrizzleHandle;
type HubTransaction = HubDatabase;

/** Bounded, message-content-free evidence for one Channel Route decision. */
export interface RecordChannelInboundActivityInput {
  organizationId: string;
  channel: SupportedChannelName;
  accountId: string;
  routePosition: number | "fallback";
  routeFingerprint: string;
  externalConversationId: string;
  externalThreadId: string | null;
  senderIdentity: string;
  outcome: "bound" | "steered" | "workflow" | "ignored" | "denied" | "error";
  outcomeDetail?: string | undefined;
  limitDecision: "not_evaluated" | "allowed" | "denied";
  limitReason?: string | undefined;
}

/** Thrown when a binding transition targets a thread key with no stored binding. */
export class ChannelThreadBindingNotFoundError extends Error {
  constructor() {
    super("thread binding not found");
    this.name = "ChannelThreadBindingNotFoundError";
  }
}

/** Thrown when a stored binding conflicts with the requested transition. */
export class ChannelThreadBindingConflictError extends Error {
  constructor() {
    super("thread binding conflicts with the stored record");
    this.name = "ChannelThreadBindingConflictError";
  }
}

/** Thrown when confirming a delivery that was never recorded (record-before-post). */
export class ChannelDeliveryRecordNotFoundError extends Error {
  constructor() {
    super("delivery ledger record not found");
    this.name = "ChannelDeliveryRecordNotFoundError";
  }
}

export class ChannelIngressQueueRecordNotFoundError extends Error {
  constructor() {
    super("channel ingress queue record not found");
    this.name = "ChannelIngressQueueRecordNotFoundError";
  }
}

export class ChannelIngressQueueClaimConflictError extends Error {
  constructor() {
    super("channel ingress queue claim is no longer owned by this worker");
    this.name = "ChannelIngressQueueClaimConflictError";
  }
}

export class ChannelStore {
  private readonly database: HubDatabase;
  /** The access plane's tables (pairing, `/agent` + `/model` selection). Its
   * own module so neither file grows past the size the standards allow. */
  readonly access: ChannelAccessStore;

  constructor(private readonly runtime: DatabaseRuntime) {
    this.database = runtime.drizzle();
    this.access = new ChannelAccessStore(this.database);
  }

  /**
   * Persist the security-relevant decision without storing message text,
   * credentials, display names, or provider payloads.
   */
  async recordChannelInboundActivity(input: RecordChannelInboundActivityInput): Promise<void> {
    await this.database.insert(schema.auditEvents).values({
      organizationId: input.organizationId,
      actorKind: "system",
      actorIdentity: "channel",
      action: "channel.inbound.processed",
      subjectType: "channel_account",
      subjectId: `${input.channel}/${input.accountId}`,
      evidence: {
        channel: input.channel,
        accountId: input.accountId,
        routePosition: input.routePosition,
        routeFingerprint: input.routeFingerprint,
        conversationId: input.externalConversationId,
        threadId: input.externalThreadId,
        providerSenderId: input.senderIdentity,
        outcome: input.outcome,
        ...(input.outcomeDetail === undefined ? {} : { outcomeDetail: input.outcomeDetail }),
        limitDecision: input.limitDecision,
        ...(input.limitReason === undefined ? {} : { limitReason: input.limitReason }),
      },
    });
  }

  /**
   * Record the pre-create pending marker before the create RPC is issued. A replay
   * carrying the same execution id returns the stored row; a different execution id
   * for the same thread key is a conflict.
   */
  async recordPendingThreadBinding(input: PendingThreadBindingInput): Promise<ThreadBindingRecord> {
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      const [inserted] = await transaction
        .insert(schema.threadBindings)
        .values({
          organizationId: input.organizationId,
          channel: input.channel,
          accountId: input.accountId,
          externalConversationId: input.externalConversationId,
          externalThreadId: input.externalThreadId,
          status: "pending",
          pendingExecutionId: input.pendingExecutionId,
          agentId: null,
          daemonId: null,
          initiator: input.initiator,
          route: input.route,
          resolvedAt: null,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted !== undefined) return toThreadBinding(inserted);
      const existing = await findThreadBindingRow(
        transaction,
        input.organizationId,
        input.accountId,
        input.externalConversationId,
        input.externalThreadId,
      );
      if (existing === undefined) throw new ChannelThreadBindingNotFoundError();
      assertReplayablePending(existing, input.pendingExecutionId);
      return toThreadBinding(existing);
    });
  }

  /**
   * Turn the pending marker into a bound binding once the create RPC returns.
   * Replays for the same agent id are no-ops so a redelivered create response
   * cannot rebind the thread to a second session.
   */
  async resolvePendingThreadBinding(
    input: ResolveThreadBindingInput,
  ): Promise<ThreadBindingRecord> {
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      const row = await lockThreadBindingRow(
        transaction,
        input.organizationId,
        input.accountId,
        input.externalConversationId,
        input.externalThreadId,
      );
      if (row === undefined) throw new ChannelThreadBindingNotFoundError();
      if (row.status === "bound") {
        if (row.agentId !== input.agentId) throw new ChannelThreadBindingConflictError();
        return toThreadBinding(row);
      }
      if (row.status !== "pending" || row.pendingExecutionId === null) {
        throw new ChannelThreadBindingConflictError();
      }
      return toThreadBinding(
        await markThread(transaction, row.id, {
          status: "bound",
          agentId: input.agentId,
          daemonId: input.daemonId ?? null,
          pendingExecutionId: null,
          resolvedAt: input.resolvedAt,
        }),
      );
    });
  }

  /** Abandon a pending marker whose create RPC died before the agent id was known. */
  async abandonPendingThreadBinding(
    input: AbandonThreadBindingInput,
  ): Promise<ThreadBindingRecord> {
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      const row = await lockThreadBindingRow(
        transaction,
        input.organizationId,
        input.accountId,
        input.externalConversationId,
        input.externalThreadId,
      );
      if (row === undefined) throw new ChannelThreadBindingNotFoundError();
      if (row.status !== "pending") throw new ChannelThreadBindingConflictError();
      return toThreadBinding(
        await markThread(transaction, row.id, {
          status: "abandoned",
          resolvedAt: input.resolvedAt,
        }),
      );
    });
  }

  /**
   * Release a conversation's binding so the next inbound mints a fresh agent
   * session — the durable half of the in-channel `/new`. The row is DELETED
   * rather than marked: `abandoned` is an operator act that permanently holds
   * the key, which is the opposite of what `/new` asks for. Returns the row
   * that was released, or undefined when the conversation had no binding.
   */
  async releaseThreadBinding(input: {
    organizationId: string;
    accountId: string;
    externalConversationId: string;
    externalThreadId: string | null;
    expectedAgentId?: string | undefined;
  }): Promise<ThreadBindingRecord | undefined> {
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      const row = await lockThreadBindingRow(
        transaction,
        input.organizationId,
        input.accountId,
        input.externalConversationId,
        input.externalThreadId,
      );
      if (row === undefined) return undefined;
      if (input.expectedAgentId !== undefined && row.agentId !== input.expectedAgentId) {
        throw new ChannelThreadBindingConflictError();
      }
      await transaction.delete(schema.threadBindings).where(eq(schema.threadBindings.id, row.id));
      return toThreadBinding(row);
    });
  }

  /** Atomically replace a conversation binding without exposing one Agent in two conversations. */
  async rebindThreadBinding(
    input: Omit<PendingThreadBindingInput, "pendingExecutionId"> & {
      expectedAgentId: string | null;
      agentId: string;
      daemonId?: string | null;
    },
  ): Promise<ThreadBindingRecord> {
    return this.runtime.transaction(async (runtimeTransaction) => {
      await runtimeTransaction.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `channel-resume:${input.agentId}`,
      ]);
      const transaction = runtimeTransaction.drizzle();
      const row = await lockThreadBindingRow(
        transaction,
        input.organizationId,
        input.accountId,
        input.externalConversationId,
        input.externalThreadId,
      );
      if (
        (row?.agentId ?? null) !== input.expectedAgentId ||
        (row !== undefined && row.status !== "bound")
      ) {
        throw new ChannelThreadBindingConflictError();
      }
      const references = await transaction
        .select({ id: schema.threadBindings.id })
        .from(schema.threadBindings)
        .where(
          and(
            eq(schema.threadBindings.agentId, input.agentId),
            eq(schema.threadBindings.status, "bound"),
          ),
        );
      if (references.some((reference) => reference.id !== row?.id)) {
        throw new ChannelThreadBindingConflictError();
      }
      const fields = {
        status: "bound" as const,
        agentId: input.agentId,
        daemonId: input.daemonId ?? null,
        pendingExecutionId: null,
        resolvedAt: new Date(),
        initiator: input.initiator,
        route: input.route,
      };
      if (row !== undefined) {
        const [updated] = await transaction
          .update(schema.threadBindings)
          .set(fields)
          .where(eq(schema.threadBindings.id, row.id))
          .returning();
        if (updated === undefined) throw new ChannelThreadBindingNotFoundError();
        return toThreadBinding(updated);
      }
      const [inserted] = await transaction
        .insert(schema.threadBindings)
        .values({
          organizationId: input.organizationId,
          channel: input.channel,
          accountId: input.accountId,
          externalConversationId: input.externalConversationId,
          externalThreadId: input.externalThreadId,
          ...fields,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted === undefined) throw new ChannelThreadBindingConflictError();
      return toThreadBinding(inserted);
    });
  }

  async findThreadBinding(
    organizationId: string,
    accountId: string,
    externalConversationId: string,
    externalThreadId: string | null,
  ): Promise<ThreadBindingRecord | undefined> {
    const row = await findThreadBindingRow(
      this.database,
      organizationId,
      accountId,
      externalConversationId,
      externalThreadId,
    );
    return row === undefined ? undefined : toThreadBinding(row);
  }

  async findWorkflowBindingActivity(
    organizationId: string,
    bindingKey: string,
    workflowName: string,
  ): Promise<Date | undefined> {
    const [row] = await this.database
      .select({ receivedAt: schema.providerEventReceipts.receivedAt })
      .from(schema.providerEventReceipts)
      .where(
        and(
          eq(schema.providerEventReceipts.organizationId, organizationId),
          eq(schema.providerEventReceipts.provider, "channel"),
          isNotNull(schema.providerEventReceipts.acceptedRoutes),
          sql`${schema.providerEventReceipts.payload} ->> 'workflow' = ${workflowName}`,
          sql`${schema.providerEventReceipts.payload} #>> '{channel,binding_key}' = ${bindingKey}`,
        ),
      )
      .orderBy(desc(schema.providerEventReceipts.receivedAt))
      .limit(1);
    return row?.receivedAt;
  }

  /** Pending markers for an organization, oldest first — the orphan-recovery scan. */
  async listPendingThreadBindings(
    organizationId: string,
    scope?: { channel: SupportedChannelName; accountId: string },
  ): Promise<ThreadBindingRecord[]> {
    const rows = await this.database
      .select()
      .from(schema.threadBindings)
      .where(
        and(
          eq(schema.threadBindings.organizationId, organizationId),
          eq(schema.threadBindings.status, "pending"),
          ...(scope === undefined
            ? []
            : [
                eq(schema.threadBindings.channel, scope.channel),
                eq(schema.threadBindings.accountId, scope.accountId),
              ]),
        ),
      )
      .orderBy(asc(schema.threadBindings.createdAt), asc(schema.threadBindings.id));
    return rows.map(toThreadBinding);
  }

  async listBoundThreadBindings(
    organizationId: string,
    channel: SupportedChannelName,
    accountId: string,
  ): Promise<ThreadBindingRecord[]> {
    const rows = await this.database
      .select()
      .from(schema.threadBindings)
      .where(
        and(
          eq(schema.threadBindings.organizationId, organizationId),
          eq(schema.threadBindings.channel, channel),
          eq(schema.threadBindings.accountId, accountId),
          eq(schema.threadBindings.status, "bound"),
        ),
      )
      .orderBy(asc(schema.threadBindings.createdAt));
    return rows.map(toThreadBinding);
  }

  /**
   * Record-before-post: write the `out` ledger row before the channel post.
   * Replayed successful or uncertain in-flight events return `created: false`,
   * so a replay cannot double-post. A known failed handoff is atomically
   * re-armed and returned as `created: true`; exactly one retry owns the post.
   */
  async recordDelivery(input: RecordDeliveryInput): Promise<RecordDeliveryResult> {
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      const [recorded] = await transaction
        .insert(schema.deliveryLedger)
        .values({
          organizationId: input.organizationId,
          channel: input.channel,
          accountId: input.accountId,
          direction: "out",
          externalConversationId: input.externalConversationId,
          externalThreadId: input.externalThreadId,
          eventTurnId: input.eventTurnId,
          sequence: input.sequence,
          status: "recorded",
        })
        .onConflictDoNothing()
        .returning();
      if (recorded !== undefined) {
        return { record: toDeliveryLedger(recorded), created: true };
      }
      const existing = await lockDeliveryRow(
        transaction,
        input.organizationId,
        input.accountId,
        "out",
        input.externalConversationId,
        input.externalThreadId,
        input.eventTurnId,
        input.sequence,
      );
      if (existing === undefined) throw new ChannelDeliveryRecordNotFoundError();
      if (existing.status !== "failed") {
        return { record: toDeliveryLedger(existing), created: false };
      }
      const [rearmed] = await transaction
        .update(schema.deliveryLedger)
        .set({
          status: "recorded",
          failureReason: null,
          attempts: sql`${schema.deliveryLedger.attempts} + 1`,
        })
        .where(eq(schema.deliveryLedger.id, existing.id))
        .returning();
      if (rearmed === undefined) throw new ChannelDeliveryRecordNotFoundError();
      return { record: toDeliveryLedger(rearmed), created: true };
    });
  }

  /** Confirm a recorded delivery with the channel message id; idempotent on replay. */
  async confirmDelivery(input: ConfirmDeliveryInput): Promise<DeliveryLedgerRecord> {
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      const row = await lockDeliveryRow(
        transaction,
        input.organizationId,
        input.accountId,
        "out",
        input.externalConversationId,
        input.externalThreadId,
        input.eventTurnId,
        input.sequence,
      );
      if (row === undefined) throw new ChannelDeliveryRecordNotFoundError();
      if (row.status === "posted") return toDeliveryLedger(row);
      const [updated] = await transaction
        .update(schema.deliveryLedger)
        .set({
          status: "posted",
          postedAt: input.postedAt,
          externalMessageId: input.externalMessageId,
          failureReason: null,
        })
        .where(eq(schema.deliveryLedger.id, row.id))
        .returning();
      if (updated === undefined) throw new ChannelDeliveryRecordNotFoundError();
      return toDeliveryLedger(updated);
    });
  }

  /** Mark a recorded delivery that failed to post. A later record attempt
   * atomically re-arms this row and increments `attempts`. */
  async failDelivery(input: FailDeliveryInput): Promise<DeliveryLedgerRecord> {
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      const row = await lockDeliveryRow(
        transaction,
        input.organizationId,
        input.accountId,
        "out",
        input.externalConversationId,
        input.externalThreadId,
        input.eventTurnId,
        input.sequence,
      );
      if (row === undefined) throw new ChannelDeliveryRecordNotFoundError();
      if (row.status === "posted") return toDeliveryLedger(row);
      const [updated] = await transaction
        .update(schema.deliveryLedger)
        .set({
          status: "failed",
          failureReason: input.failureReason,
        })
        .where(eq(schema.deliveryLedger.id, row.id))
        .returning();
      if (updated === undefined) throw new ChannelDeliveryRecordNotFoundError();
      return toDeliveryLedger(updated);
    });
  }

  /**
   * Record-before-handoff: write the `in` ledger row before the `onInboundReply`
   * handoff (blueprint §2.4). Replayed events (same external message id) return
   * the stored row with `created: false`, so the caller must NOT dispatch.
   */
  async recordInbound(input: RecordInboundInput): Promise<RecordInboundResult> {
    const [recorded] = await this.database
      .insert(schema.deliveryLedger)
      .values({
        organizationId: input.organizationId,
        channel: input.channel,
        accountId: input.accountId,
        direction: "in",
        externalConversationId: input.externalConversationId,
        externalThreadId: null,
        eventTurnId: "",
        sequence: 0,
        status: "recorded",
        externalMessageId: input.externalMessageId,
      })
      .onConflictDoNothing()
      .returning();
    if (recorded !== undefined) {
      return { record: toDeliveryLedger(recorded), created: true };
    }
    const existing = await findInboundRow(
      this.database,
      input.organizationId,
      input.accountId,
      input.externalConversationId,
      input.externalMessageId,
    );
    if (existing === undefined) throw new ChannelDeliveryRecordNotFoundError();
    return { record: existing, created: false };
  }

  /**
   * Mark a recorded inbound row consumed, referencing the plane turn it
   * dispatched to. Idempotent: an already-consumed row returns as-is.
   */
  async consumeInbound(input: ConsumeInboundInput): Promise<DeliveryLedgerRecord> {
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      const row = await lockInboundRow(
        transaction,
        input.organizationId,
        input.accountId,
        input.externalConversationId,
        input.externalMessageId,
      );
      if (row === undefined) throw new ChannelDeliveryRecordNotFoundError();
      if (row.status === "consumed") return toDeliveryLedger(row);
      const [updated] = await transaction
        .update(schema.deliveryLedger)
        .set({
          status: "consumed",
          consumedAt: input.consumedAt,
          turnId: input.turnId,
        })
        .where(eq(schema.deliveryLedger.id, row.id))
        .returning();
      if (updated === undefined) throw new ChannelDeliveryRecordNotFoundError();
      return toDeliveryLedger(updated);
    });
  }

  async findDeliveryLedgerRecord(
    organizationId: string,
    accountId: string,
    direction: "in" | "out",
    externalConversationId: string,
    externalThreadId: string | null,
    eventTurnId: string,
    sequence: number,
  ): Promise<DeliveryLedgerRecord | undefined> {
    const row = await findDeliveryRow(
      this.database,
      organizationId,
      accountId,
      direction,
      externalConversationId,
      externalThreadId,
      eventTurnId,
      sequence,
    );
    return row === undefined ? undefined : toDeliveryLedger(row);
  }

  /**
   * Every `out` row one `send` recorded, in sequence order.
   *
   * A `send` can produce several platform messages (the reply, then one per
   * attachment) under one `eventTurnId`. A retry has to know which of them
   * actually landed: replaying on the anchor row alone reported a partly
   * delivered send as `replayed: true` and the attachments were never posted.
   */
  async listTurnDeliveries(
    organizationId: string,
    accountId: string,
    externalConversationId: string,
    externalThreadId: string | null,
    eventTurnId: string,
  ): Promise<DeliveryLedgerRecord[]> {
    const rows = await this.database
      .select()
      .from(schema.deliveryLedger)
      .where(
        and(
          eq(schema.deliveryLedger.organizationId, organizationId),
          eq(schema.deliveryLedger.accountId, accountId),
          eq(schema.deliveryLedger.direction, "out"),
          eq(schema.deliveryLedger.externalConversationId, externalConversationId),
          deliveryThreadMatches(externalThreadId),
          eq(schema.deliveryLedger.eventTurnId, eventTurnId),
        ),
      )
      .orderBy(asc(schema.deliveryLedger.sequence));
    return rows.map(toDeliveryLedger);
  }

  /** Posted `out` ledger rows for a thread, in delivery order — the restart
   * replay cursor. */
  async listPostedDeliveries(
    organizationId: string,
    accountId: string,
    externalConversationId: string,
    externalThreadId: string | null,
  ): Promise<DeliveryLedgerRecord[]> {
    const rows = await this.database
      .select()
      .from(schema.deliveryLedger)
      .where(
        and(
          eq(schema.deliveryLedger.organizationId, organizationId),
          eq(schema.deliveryLedger.accountId, accountId),
          eq(schema.deliveryLedger.direction, "out"),
          eq(schema.deliveryLedger.externalConversationId, externalConversationId),
          deliveryThreadMatches(externalThreadId),
          eq(schema.deliveryLedger.status, "posted"),
        ),
      )
      .orderBy(asc(schema.deliveryLedger.eventTurnId), asc(schema.deliveryLedger.sequence));
    return rows.map(toDeliveryLedger);
  }

  /** Admit a normalized inbound envelope durably and idempotently. */
  async enqueueChannelIngress(
    input: EnqueueChannelIngressInput,
  ): Promise<EnqueueChannelIngressResult> {
    const [inserted] = await this.database
      .insert(schema.channelIngressQueue)
      .values({
        organizationId: input.organizationId,
        channel: input.channel,
        accountId: input.accountId,
        externalEventId: input.externalEventId,
        externalMessageId: input.externalMessageId,
        externalConversationId: input.externalConversationId,
        externalThreadId: input.externalThreadId ?? null,
        laneKey: input.laneKey,
        payload: input.payload,
        status: "pending",
        availableAt: input.availableAt ?? new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted !== undefined) return { record: toChannelIngress(inserted), created: true };
    const existing = await findChannelIngressByEvent(
      this.database,
      input.organizationId,
      input.channel,
      input.accountId,
      input.externalEventId,
    );
    if (existing === undefined) throw new ChannelIngressQueueRecordNotFoundError();
    return { record: toChannelIngress(existing), created: false };
  }

  /**
   * Claim the oldest eligible event, serializing work by conversation lane.
   *
   * A lane is FIFO by arrival (`created_at`), not by readiness: while any older
   * row of the same lane is still unfinished — pending, claimed, or waiting out
   * a retry backoff — no younger row of that lane may be claimed. Upstream gets
   * this by reading the whole pending set and computing `blockedLaneKeys`
   * (`src/channels/message/ingress-drain.ts`); the same rule has to live in the
   * candidate query here, because `for update skip locked` hands each worker a
   * different subset of the backlog and an ordering alone would let worker B
   * overtake the row worker A is holding.
   */
  async claimChannelIngress(
    input: ClaimChannelIngressInput,
  ): Promise<ChannelIngressQueueRecord | undefined> {
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      const candidates = await transaction
        .select()
        .from(schema.channelIngressQueue)
        .where(
          and(
            eq(schema.channelIngressQueue.organizationId, input.organizationId),
            inArray(schema.channelIngressQueue.status, ["pending", "failed"]),
            lte(schema.channelIngressQueue.availableAt, now),
            ...(input.channel === undefined
              ? []
              : [eq(schema.channelIngressQueue.channel, input.channel)]),
            ...(input.accountId === undefined
              ? []
              : [eq(schema.channelIngressQueue.accountId, input.accountId)]),
            noOlderUnfinishedLaneRow(),
          ),
        )
        .orderBy(asc(schema.channelIngressQueue.createdAt), asc(schema.channelIngressQueue.id))
        .limit(32)
        .for("update", { skipLocked: true });
      for (const row of candidates) {
        // Lock the lane key itself, including the empty-lane case. Locking
        // only existing claimed rows is racy when two workers observe the
        // same pending lane concurrently.
        await runtimeTransaction.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          `${row.organizationId}:${row.channel}:${row.accountId}:${row.laneKey}`,
        ]);
        const activeLane = await transaction
          .select({ id: schema.channelIngressQueue.id })
          .from(schema.channelIngressQueue)
          .where(
            and(
              eq(schema.channelIngressQueue.organizationId, row.organizationId),
              eq(schema.channelIngressQueue.channel, row.channel),
              eq(schema.channelIngressQueue.accountId, row.accountId),
              eq(schema.channelIngressQueue.laneKey, row.laneKey),
              eq(schema.channelIngressQueue.status, "claimed"),
              sql`${schema.channelIngressQueue.leaseExpiresAt} > ${now}`,
            ),
          )
          .limit(1);
        if (activeLane.length > 0) continue;
        const token = randomUUID();
        const [claimed] = await transaction
          .update(schema.channelIngressQueue)
          .set({
            status: "claimed",
            attempts: sql`${schema.channelIngressQueue.attempts} + 1`,
            claimedBy: input.workerId,
            claimToken: token,
            leaseExpiresAt,
            lastAttemptAt: now,
            lastError: null,
          })
          .where(eq(schema.channelIngressQueue.id, row.id))
          .returning();
        if (claimed !== undefined) return toChannelIngress(claimed);
      }
      return undefined;
    });
  }

  /** Complete a claim only when the worker still owns its fencing token. */
  async completeChannelIngress(
    input: SettleChannelIngressInput,
  ): Promise<ChannelIngressQueueRecord> {
    const [updated] = await this.database
      .update(schema.channelIngressQueue)
      .set({
        status: "completed",
        completedAt: input.completedAt ?? new Date(),
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(schema.channelIngressQueue.id, input.id),
          eq(schema.channelIngressQueue.status, "claimed"),
          eq(schema.channelIngressQueue.claimedBy, input.workerId),
          eq(schema.channelIngressQueue.claimToken, input.claimToken),
        ),
      )
      .returning();
    if (updated === undefined) throw new ChannelIngressQueueClaimConflictError();
    return toChannelIngress(updated);
  }

  /** Extend a live claim while a provider/agent handoff is still running. */
  async refreshChannelIngress(input: RefreshChannelIngressInput): Promise<boolean> {
    const now = input.now ?? new Date();
    const result = await this.database
      .update(schema.channelIngressQueue)
      .set({ leaseExpiresAt: new Date(now.getTime() + input.leaseMs) })
      .where(
        and(
          eq(schema.channelIngressQueue.id, input.id),
          eq(schema.channelIngressQueue.status, "claimed"),
          eq(schema.channelIngressQueue.claimedBy, input.workerId),
          eq(schema.channelIngressQueue.claimToken, input.claimToken),
        ),
      );
    return result.rowCount > 0;
  }

  /**
   * Settle a claim that did not deliver, as the caller's disposition decided.
   * Retry reopens the row at `retryAt` (the backoff the ingress retry policy
   * computed) and keeps the attempt it spent; dead-letter is terminal and keeps
   * the payload for `resubmitChannelIngress`; release hands the row back
   * unattempted, because the plane refused it as back-pressure rather than
   * failing it (upstream `ingress-queue.ts` `release({ recordAttempt: false })`
   * — the claim consumed an attempt here, so releasing gives it back).
   *
   * A release still spends `releases`, which nothing gives back. Past
   * `budget.maxReleases`, or past `budget.pendingTtlMs` of age, the release
   * becomes a dead-letter: back-pressure that never clears is a stuck row, and
   * an operator has to be able to see it.
   */
  async failChannelIngress(input: FailChannelIngressInput): Promise<ChannelIngressQueueRecord> {
    const now = input.now ?? new Date();
    const release = input.disposition === "release";
    const exhausted =
      release && input.budget !== undefined && (await this.releaseSpent(input, now));
    const deadLetter = input.disposition === "dead_letter" || exhausted;
    const [updated] = await this.database
      .update(schema.channelIngressQueue)
      .set({
        status: settledIngressStatus(deadLetter ? "dead_letter" : input.disposition),
        availableAt: deadLetter ? now : (input.retryAt ?? now),
        claimedBy: null,
        claimToken: null,
        leaseExpiresAt: null,
        lastError: input.error,
        failedReason: exhausted ? "release-budget-exhausted" : (input.reason ?? null),
        failedAt: deadLetter ? now : null,
        ...(release
          ? {
              releases: sql`${schema.channelIngressQueue.releases} + 1`,
              attempts: sql`greatest(${schema.channelIngressQueue.attempts} - 1, 0)`,
            }
          : { lastAttemptAt: now }),
      })
      .where(
        and(
          eq(schema.channelIngressQueue.id, input.id),
          eq(schema.channelIngressQueue.status, "claimed"),
          eq(schema.channelIngressQueue.claimedBy, input.workerId),
          eq(schema.channelIngressQueue.claimToken, input.claimToken),
        ),
      )
      .returning();
    if (updated === undefined) throw new ChannelIngressQueueClaimConflictError();
    return toChannelIngress(updated);
  }

  /** True when this release is the one that ends the row: the budget is spent,
   * or the row has waited longer than the pending TTL. */
  private async releaseSpent(input: FailChannelIngressInput, now: Date): Promise<boolean> {
    const budget = input.budget;
    if (budget === undefined) return false;
    const [row] = await this.database
      .select({
        releases: schema.channelIngressQueue.releases,
        createdAt: schema.channelIngressQueue.createdAt,
      })
      .from(schema.channelIngressQueue)
      .where(eq(schema.channelIngressQueue.id, input.id))
      .limit(1);
    if (row === undefined) return false;
    return (
      row.releases + 1 >= budget.maxReleases ||
      now.getTime() - row.createdAt.getTime() > budget.pendingTtlMs
    );
  }

  /** Requeue claims whose lease expired after a process crash. */
  async recoverStaleChannelIngress(input: RecoverStaleChannelIngressInput): Promise<number> {
    const now = input.now ?? new Date();
    const stale = await this.database
      .select({ id: schema.channelIngressQueue.id })
      .from(schema.channelIngressQueue)
      .where(
        and(
          eq(schema.channelIngressQueue.organizationId, input.organizationId),
          eq(schema.channelIngressQueue.status, "claimed"),
          sql`${schema.channelIngressQueue.leaseExpiresAt} <= ${now}`,
          ...(input.channel === undefined
            ? []
            : [eq(schema.channelIngressQueue.channel, input.channel)]),
          ...(input.accountId === undefined
            ? []
            : [eq(schema.channelIngressQueue.accountId, input.accountId)]),
        ),
      )
      .limit(input.limit ?? 1000);
    if (stale.length === 0) return 0;
    const result = await this.database
      .update(schema.channelIngressQueue)
      .set({
        status: "failed",
        availableAt: now,
        claimedBy: null,
        claimToken: null,
        leaseExpiresAt: null,
        lastError: "claim lease expired",
      })
      .where(
        and(
          inArray(
            schema.channelIngressQueue.id,
            stale.map(({ id }) => id),
          ),
          eq(schema.channelIngressQueue.organizationId, input.organizationId),
          eq(schema.channelIngressQueue.status, "claimed"),
          sql`${schema.channelIngressQueue.leaseExpiresAt} <= ${now}`,
        ),
      );
    return result.rowCount;
  }

  async listChannelIngress(options: {
    organizationId: string;
    channel?: string;
    accountId?: string;
    statuses?: readonly schema.ChannelIngressQueueStatus[];
    limit?: number;
    offset?: number;
  }): Promise<ChannelIngressQueueRecord[]> {
    const rows = await this.database
      .select()
      .from(schema.channelIngressQueue)
      .where(
        and(
          eq(schema.channelIngressQueue.organizationId, options.organizationId),
          ...(options.channel === undefined
            ? []
            : [eq(schema.channelIngressQueue.channel, options.channel)]),
          ...(options.accountId === undefined
            ? []
            : [eq(schema.channelIngressQueue.accountId, options.accountId)]),
          ...(options.statuses === undefined || options.statuses.length === 0
            ? []
            : [inArray(schema.channelIngressQueue.status, options.statuses)]),
        ),
      )
      .orderBy(asc(schema.channelIngressQueue.createdAt), asc(schema.channelIngressQueue.id))
      .limit(options.limit ?? 100)
      .offset(options.offset ?? 0);
    return rows.map(toChannelIngress);
  }

  /**
   * Operator recovery for dead-lettered events: reopen them as pending with a
   * fresh retry budget. Rows that are not dead-lettered are left alone and are
   * absent from the result.
   *
   * `created_at` stays put: it is arrival order, and the lane's FIFO
   * (`noOlderUnfinishedLaneRow`) reads it, so restamping it moved a resubmitted
   * event behind every message that arrived after it went to the dead letter.
   * `resubmitted_at` carries the restarted age budget the retention sweep reads.
   */
  async resubmitChannelIngress(
    input: ResubmitChannelIngressInput,
  ): Promise<ChannelIngressQueueRecord[]> {
    if (input.ids.length === 0) return [];
    const now = input.now ?? new Date();
    const rows = await this.database
      .update(schema.channelIngressQueue)
      .set({
        status: "pending",
        attempts: 0,
        releases: 0,
        availableAt: now,
        resubmittedAt: now,
        claimedBy: null,
        claimToken: null,
        leaseExpiresAt: null,
        lastAttemptAt: null,
        lastError: null,
        failedReason: null,
        failedAt: null,
        completedAt: null,
      })
      .where(
        and(
          eq(schema.channelIngressQueue.organizationId, input.organizationId),
          inArray(schema.channelIngressQueue.id, [...input.ids]),
          eq(schema.channelIngressQueue.status, "dead_letter"),
        ),
      )
      .returning();
    return rows.map(toChannelIngress);
  }

  /**
   * Retention sweep over terminal rows. Completed rows are the replay guard, so
   * pruning one lets its provider event be admitted again — keep the cutoff
   * well past the provider's own replay window (upstream default: 30 days).
   */
  async pruneChannelIngress(input: PruneChannelIngressInput): Promise<number> {
    let deleted = 0;
    if (input.completedOlderThan !== undefined) {
      const result = await this.database
        .delete(schema.channelIngressQueue)
        .where(
          and(
            eq(schema.channelIngressQueue.organizationId, input.organizationId),
            eq(schema.channelIngressQueue.status, "completed"),
            lt(schema.channelIngressQueue.completedAt, input.completedOlderThan),
          ),
        );
      deleted += result.rowCount;
    }
    if (input.deadLetteredOlderThan !== undefined) {
      const result = await this.database
        .delete(schema.channelIngressQueue)
        .where(
          and(
            eq(schema.channelIngressQueue.organizationId, input.organizationId),
            eq(schema.channelIngressQueue.status, "dead_letter"),
            lt(schema.channelIngressQueue.failedAt, input.deadLetteredOlderThan),
          ),
        );
      deleted += result.rowCount;
    }
    if (input.pendingOlderThan !== undefined) {
      const result = await this.database.delete(schema.channelIngressQueue).where(
        and(
          eq(schema.channelIngressQueue.organizationId, input.organizationId),
          inArray(schema.channelIngressQueue.status, ["pending", "failed"]),
          // A resubmitted row's age runs from the resubmit, not from the
          // arrival the lane still orders it by.
          lt(
            sql`coalesce(${schema.channelIngressQueue.resubmittedAt}, ${schema.channelIngressQueue.createdAt})`,
            input.pendingOlderThan,
          ),
        ),
      );
      deleted += result.rowCount;
    }
    return deleted;
  }

  /**
   * Organizations that own at least one queued event. The retention sweep is
   * org-scoped (so is every other queue write), and this is what it iterates —
   * reading it from the queue instead of the channel configuration keeps a
   * decommissioned account's backlog collectable.
   */
  async listChannelIngressOrganizations(): Promise<string[]> {
    const rows = await this.database
      .selectDistinct({ organizationId: schema.channelIngressQueue.organizationId })
      .from(schema.channelIngressQueue)
      .orderBy(asc(schema.channelIngressQueue.organizationId));
    return rows.map(({ organizationId }) => organizationId);
  }

  /**
   * One organization's queue depth per account. Upstream reads the same facts
   * out of SQLite in `ingress-queue-health.ts`; the shapes match
   * (per-account counts, the oldest waiting row, blocked lanes) so an operator
   * surface reads the same way on both platforms.
   */
  async summarizeChannelIngress(
    input: SummarizeChannelIngressInput,
  ): Promise<ChannelIngressSummaryRecord[]> {
    const now = input.now ?? new Date();
    const queue = schema.channelIngressQueue;
    const counts = await this.database
      .select({
        channel: queue.channel,
        accountId: queue.accountId,
        pending: sql<number>`count(*) filter (where ${queue.status} = 'pending')::int`,
        claimed: sql<number>`count(*) filter (where ${queue.status} = 'claimed')::int`,
        retrying: sql<number>`count(*) filter (where ${queue.status} = 'failed')::int`,
        deadLettered: sql<number>`count(*) filter (where ${queue.status} = 'dead_letter')::int`,
        completed: sql<number>`count(*) filter (where ${queue.status} = 'completed')::int`,
        oldestPendingAt: sql<Date | null>`min(${queue.createdAt}) filter (where ${queue.status} in ('pending', 'failed'))`,
      })
      .from(queue)
      .where(eq(queue.organizationId, input.organizationId))
      .groupBy(queue.channel, queue.accountId)
      .orderBy(asc(queue.channel), asc(queue.accountId));
    const blocked = await this.countBlockedChannelIngressLanes(input.organizationId, now);
    const summaries: ChannelIngressSummaryRecord[] = [];
    for (const row of counts) {
      summaries.push({
        channel: row.channel,
        accountId: row.accountId,
        pending: row.pending,
        claimed: row.claimed,
        retrying: row.retrying,
        deadLettered: row.deadLettered,
        completed: row.completed,
        oldestPendingAt: row.oldestPendingAt === null ? null : new Date(row.oldestPendingAt),
        lanesBlocked: blocked.get(`${row.channel}\u0000${row.accountId}`) ?? 0,
      });
    }
    return summaries;
  }

  /** Lanes held by an expired claim, a retry backoff window, or a deferral. */
  private async countBlockedChannelIngressLanes(
    organizationId: string,
    now: Date,
  ): Promise<Map<string, number>> {
    const queue = schema.channelIngressQueue;
    const lanes = this.database
      .select({ channel: queue.channel, accountId: queue.accountId, laneKey: queue.laneKey })
      .from(queue)
      .where(
        and(
          eq(queue.organizationId, organizationId),
          inArray(queue.status, ["pending", "claimed", "failed"]),
        ),
      )
      .groupBy(queue.channel, queue.accountId, queue.laneKey)
      .having(
        sql`count(*) filter (where ${queue.status} = 'claimed' and ${queue.leaseExpiresAt} <= ${now}) > 0
          or count(*) filter (where ${queue.status} in ('pending', 'failed') and ${queue.availableAt} > ${now}) > 0`,
      )
      .as("lanes");
    const rows = await this.database
      .select({
        channel: lanes.channel,
        accountId: lanes.accountId,
        lanesBlocked: sql<number>`count(*)::int`,
      })
      .from(lanes)
      .groupBy(lanes.channel, lanes.accountId);
    return new Map(rows.map((row) => [`${row.channel}\u0000${row.accountId}`, row.lanesBlocked]));
  }
}

async function findThreadBindingRow(
  database: HubDatabase,
  organizationId: string,
  accountId: string,
  externalConversationId: string,
  externalThreadId: string | null,
) {
  const [row] = await database
    .select()
    .from(schema.threadBindings)
    .where(
      and(
        eq(schema.threadBindings.organizationId, organizationId),
        eq(schema.threadBindings.accountId, accountId),
        eq(schema.threadBindings.externalConversationId, externalConversationId),
        bindingThreadMatches(externalThreadId),
      ),
    )
    .limit(1);
  return row;
}

async function lockThreadBindingRow(
  transaction: HubTransaction,
  organizationId: string,
  accountId: string,
  externalConversationId: string,
  externalThreadId: string | null,
) {
  const [row] = await transaction
    .select()
    .from(schema.threadBindings)
    .where(
      and(
        eq(schema.threadBindings.organizationId, organizationId),
        eq(schema.threadBindings.accountId, accountId),
        eq(schema.threadBindings.externalConversationId, externalConversationId),
        bindingThreadMatches(externalThreadId),
      ),
    )
    .for("update")
    .limit(1);
  return row;
}

type ThreadBindingTransition =
  | {
      status: "bound";
      agentId: string;
      daemonId: string | null;
      pendingExecutionId: null;
      resolvedAt: Date;
    }
  | {
      status: "abandoned";
      resolvedAt: Date;
    };

async function markThread(
  transaction: HubTransaction,
  id: string,
  fields: ThreadBindingTransition,
) {
  const [updated] = await transaction
    .update(schema.threadBindings)
    .set(fields)
    .where(eq(schema.threadBindings.id, id))
    .returning();
  if (updated === undefined) throw new ChannelThreadBindingNotFoundError();
  return updated;
}

function assertReplayablePending(
  row: typeof schema.threadBindings.$inferSelect,
  executionId: string,
) {
  if (row.status === "pending" && row.pendingExecutionId === executionId) return;
  throw new ChannelThreadBindingConflictError();
}

function bindingThreadMatches(externalThreadId: string | null) {
  return externalThreadId === null
    ? isNull(schema.threadBindings.externalThreadId)
    : eq(schema.threadBindings.externalThreadId, externalThreadId);
}

function deliveryThreadMatches(externalThreadId: string | null) {
  return externalThreadId === null
    ? isNull(schema.deliveryLedger.externalThreadId)
    : eq(schema.deliveryLedger.externalThreadId, externalThreadId);
}

async function findDeliveryRow(
  database: HubDatabase,
  organizationId: string,
  accountId: string,
  direction: "in" | "out",
  externalConversationId: string,
  externalThreadId: string | null,
  eventTurnId: string,
  sequence: number,
) {
  const [row] = await database
    .select()
    .from(schema.deliveryLedger)
    .where(
      and(
        eq(schema.deliveryLedger.organizationId, organizationId),
        eq(schema.deliveryLedger.accountId, accountId),
        eq(schema.deliveryLedger.direction, direction),
        eq(schema.deliveryLedger.externalConversationId, externalConversationId),
        deliveryThreadMatches(externalThreadId),
        eq(schema.deliveryLedger.eventTurnId, eventTurnId),
        eq(schema.deliveryLedger.sequence, sequence),
      ),
    )
    .limit(1);
  return row;
}

async function lockDeliveryRow(
  transaction: HubTransaction,
  organizationId: string,
  accountId: string,
  direction: "in" | "out",
  externalConversationId: string,
  externalThreadId: string | null,
  eventTurnId: string,
  sequence: number,
) {
  const [row] = await transaction
    .select()
    .from(schema.deliveryLedger)
    .where(
      and(
        eq(schema.deliveryLedger.organizationId, organizationId),
        eq(schema.deliveryLedger.accountId, accountId),
        eq(schema.deliveryLedger.direction, direction),
        eq(schema.deliveryLedger.externalConversationId, externalConversationId),
        deliveryThreadMatches(externalThreadId),
        eq(schema.deliveryLedger.eventTurnId, eventTurnId),
        eq(schema.deliveryLedger.sequence, sequence),
      ),
    )
    .for("update")
    .limit(1);
  return row;
}

async function findInboundRow(
  database: HubDatabase,
  organizationId: string,
  accountId: string,
  externalConversationId: string,
  externalMessageId: string,
) {
  const [row] = await database
    .select()
    .from(schema.deliveryLedger)
    .where(
      and(
        eq(schema.deliveryLedger.organizationId, organizationId),
        eq(schema.deliveryLedger.accountId, accountId),
        eq(schema.deliveryLedger.direction, "in"),
        eq(schema.deliveryLedger.externalConversationId, externalConversationId),
        eq(schema.deliveryLedger.externalMessageId, externalMessageId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Candidate predicate for `claimChannelIngress`: the row is the head of its
 * lane. "Older" is arrival order (`created_at`, `id` as the stable tie-break),
 * and "unfinished" is every non-terminal status — a claimed row, a row waiting
 * out a retry backoff, and a row that is merely pending all hold the lane.
 * Written as `not exists` rather than as an ordering so it still holds when
 * `skip locked` hides the older row from this worker.
 */
/** Where a settled claim's row lands, per disposition. */
function settledIngressStatus(
  disposition: FailChannelIngressInput["disposition"],
): schema.ChannelIngressQueueStatus {
  if (disposition === "dead_letter") return "dead_letter";
  if (disposition === "release") return "pending";
  return "failed";
}

function noOlderUnfinishedLaneRow() {
  const queue = schema.channelIngressQueue;
  return sql`not exists (
    select 1
    from ${queue} as older
    where older.organization_id = ${queue.organizationId}
      and older.channel = ${queue.channel}
      and older.account_id = ${queue.accountId}
      and older.lane_key = ${queue.laneKey}
      and older.status in ('pending', 'claimed', 'failed')
      and (older.created_at, older.id) < (${queue.createdAt}, ${queue.id})
  )`;
}

async function findChannelIngressByEvent(
  database: HubDatabase,
  organizationId: string,
  channel: string,
  accountId: string,
  externalEventId: string,
) {
  const [row] = await database
    .select()
    .from(schema.channelIngressQueue)
    .where(
      and(
        eq(schema.channelIngressQueue.organizationId, organizationId),
        eq(schema.channelIngressQueue.channel, channel),
        eq(schema.channelIngressQueue.accountId, accountId),
        eq(schema.channelIngressQueue.externalEventId, externalEventId),
      ),
    )
    .limit(1);
  return row;
}

async function lockInboundRow(
  transaction: HubTransaction,
  organizationId: string,
  accountId: string,
  externalConversationId: string,
  externalMessageId: string,
) {
  const [row] = await transaction
    .select()
    .from(schema.deliveryLedger)
    .where(
      and(
        eq(schema.deliveryLedger.organizationId, organizationId),
        eq(schema.deliveryLedger.accountId, accountId),
        eq(schema.deliveryLedger.direction, "in"),
        eq(schema.deliveryLedger.externalConversationId, externalConversationId),
        eq(schema.deliveryLedger.externalMessageId, externalMessageId),
      ),
    )
    .for("update")
    .limit(1);
  return row;
}

function toThreadBinding(row: typeof schema.threadBindings.$inferSelect): ThreadBindingRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channel: row.channel,
    accountId: row.accountId,
    externalConversationId: row.externalConversationId,
    externalThreadId: row.externalThreadId,
    status: row.status,
    pendingExecutionId: row.pendingExecutionId,
    agentId: row.agentId,
    daemonId: row.daemonId,
    initiator: row.initiator,
    route: row.route,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

function toDeliveryLedger(row: typeof schema.deliveryLedger.$inferSelect): DeliveryLedgerRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channel: row.channel,
    accountId: row.accountId,
    direction: row.direction,
    externalConversationId: row.externalConversationId,
    externalThreadId: row.externalThreadId,
    eventTurnId: row.eventTurnId,
    sequence: row.sequence,
    status: row.status,
    recordedAt: row.recordedAt,
    postedAt: row.postedAt,
    externalMessageId: row.externalMessageId,
    consumedAt: row.consumedAt,
    turnId: row.turnId,
    attempts: row.attempts,
    failureReason: row.failureReason,
  };
}

function toChannelIngress(
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
  };
}
