// COMPAT(clisbot-channels): fork-owned channel control plane persistence (plan P3/P4/P5,
// implementation doc §3.1/§4.2/§4.3.4). Houses the query functions for the three
// additive channel tables — channel_accounts, thread_bindings, delivery_ledger — so
// upstream db files keep their byte-identical surface. An unmodified upstream Hub
// never imports this module.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import * as schema from "./schema.js";
import type { DatabaseRuntime, DrizzleHandle } from "./runtime/index.js";
import type {
  AbandonThreadBindingInput,
  ChannelAccountRecord,
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
  UpsertChannelAccountInput,
} from "./types.js";

type HubDatabase = DrizzleHandle;
type HubTransaction = HubDatabase;

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

export class ChannelStore {
  private readonly database: HubDatabase;

  constructor(private readonly runtime: DatabaseRuntime) {
    this.database = runtime.drizzle();
  }

  /**
   * Insert or update the account's runtime record (idempotent across restarts).
   * An absent optional field preserves the stored value; an explicit `null` clears it.
   */
  async upsertChannelAccount(input: UpsertChannelAccountInput): Promise<ChannelAccountRecord> {
    const [account] = await this.database
      .insert(schema.channelAccounts)
      .values({
        organizationId: input.organizationId,
        channel: input.channel,
        accountId: input.accountId,
        status: input.status,
        pinVersion: input.pinVersion ?? null,
        distIntegrity: input.distIntegrity ?? null,
        gitHead: input.gitHead ?? null,
        installDir: input.installDir ?? null,
        installedAt: input.installedAt ?? null,
        secretRef: input.secretRef ?? null,
        providerApplicationId: input.providerApplicationId ?? null,
        externalIdentity: input.externalIdentity ?? null,
        transport: input.transport,
      })
      .onConflictDoUpdate({
        target: [
          schema.channelAccounts.organizationId,
          schema.channelAccounts.channel,
          schema.channelAccounts.accountId,
        ],
        set: accountUpdateFields(input),
      })
      .returning();
    if (account === undefined) throw new Error("channel account unavailable");
    return toChannelAccount(account);
  }

  async findChannelAccount(
    organizationId: string,
    channel: "slack" | "telegram",
    accountId: string,
  ): Promise<ChannelAccountRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(schema.channelAccounts)
      .where(
        and(
          eq(schema.channelAccounts.organizationId, organizationId),
          eq(schema.channelAccounts.channel, channel),
          eq(schema.channelAccounts.accountId, accountId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toChannelAccount(row);
  }

  async listChannelAccounts(organizationId: string): Promise<ChannelAccountRecord[]> {
    const rows = await this.database
      .select()
      .from(schema.channelAccounts)
      .where(eq(schema.channelAccounts.organizationId, organizationId))
      .orderBy(asc(schema.channelAccounts.channel), asc(schema.channelAccounts.accountId));
    return rows.map(toChannelAccount);
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

  /** Pending markers for an organization, oldest first — the orphan-recovery scan. */
  async listPendingThreadBindings(organizationId: string): Promise<ThreadBindingRecord[]> {
    const rows = await this.database
      .select()
      .from(schema.threadBindings)
      .where(
        and(
          eq(schema.threadBindings.organizationId, organizationId),
          eq(schema.threadBindings.status, "pending"),
        ),
      )
      .orderBy(asc(schema.threadBindings.createdAt), asc(schema.threadBindings.id));
    return rows.map(toThreadBinding);
  }

  /**
   * Record-before-post: write the `out` ledger row before the channel post.
   * Replayed stream events (same thread + event/turn id + sequence) return the
   * stored row with `created: false`, so a replay or restart cannot double-post.
   */
  async recordDelivery(input: RecordDeliveryInput): Promise<RecordDeliveryResult> {
    const [recorded] = await this.database
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
    const existing = await this.findDeliveryLedgerRecord(
      input.organizationId,
      input.accountId,
      "out",
      input.externalConversationId,
      input.externalThreadId,
      input.eventTurnId,
      input.sequence,
    );
    if (existing === undefined) throw new ChannelDeliveryRecordNotFoundError();
    return { record: existing, created: false };
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

  /** Mark a recorded delivery that failed to post (increments `attempts`); a
   * later retry re-posts under the same row. */
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
          attempts: sql`${schema.deliveryLedger.attempts} + 1`,
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

/** Upsert fields for an existing account: absent input preserves, explicit null clears. */
function accountUpdateFields(input: UpsertChannelAccountInput) {
  return {
    status: input.status,
    pinVersion: input.pinVersion,
    distIntegrity: input.distIntegrity,
    gitHead: input.gitHead,
    installDir: input.installDir,
    installedAt: input.installedAt,
    secretRef: input.secretRef,
    providerApplicationId: input.providerApplicationId,
    externalIdentity: input.externalIdentity,
    transport: input.transport,
    updatedAt: sql`clock_timestamp()`,
  };
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

function toChannelAccount(row: typeof schema.channelAccounts.$inferSelect): ChannelAccountRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channel: row.channel,
    accountId: row.accountId,
    status: row.status,
    pinVersion: row.pinVersion,
    distIntegrity: row.distIntegrity,
    gitHead: row.gitHead,
    installDir: row.installDir,
    installedAt: row.installedAt,
    secretRef: row.secretRef,
    providerApplicationId: row.providerApplicationId,
    externalIdentity: row.externalIdentity,
    transport: row.transport,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
