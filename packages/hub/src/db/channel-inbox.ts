// A binding's inbox, kept on the ingress rows themselves
// (docs/features/channels/conversation-flow.md). Every inbound message is
// already a durable `channel_ingress_queue` row with its payload until
// retention prunes it (`channels/ingress/retention.ts`), so the inbox is two
// columns on that row, not a second copy of the message: which binding the
// plane filed it under, and whether it waits as context, waits to be sent
// (`held`), or has entered the session (`delivered`).
//
// "Before" is always another row of the same table: a message's context is the
// rows filed before it arrived, so replaying the same message reads the same
// rows and sends the same prompt.
import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import * as schema from "./schema.js";
import type { DrizzleHandle } from "./runtime/index.js";
import type { ChannelIngressQueueRecord } from "./types.js";
import { toChannelIngress } from "./channel-ingress-record.js";

/** One binding of one account. */
export interface ChannelInboxScope {
  organizationId: string;
  channel: string;
  accountId: string;
  /** `JSON.stringify([conversationId, threadId])` of the binding key. */
  bindingKey: string;
}

export interface ListChannelInboxInput {
  state: schema.ChannelInboxState;
  /** Only rows that arrived before this ingress row. */
  before?: string | undefined;
  /** Keep only the newest this many (still returned oldest first). */
  newest?: number | undefined;
  /** Leave out rows a prompt already carried (`sent_in`). */
  unsent?: boolean | undefined;
}

const queue = schema.channelIngressQueue;

function accountWhere(scope: Omit<ChannelInboxScope, "bindingKey">): SQL[] {
  return [
    eq(queue.organizationId, scope.organizationId),
    eq(queue.channel, scope.channel),
    eq(queue.accountId, scope.accountId),
  ];
}

function scopeWhere(scope: ChannelInboxScope): SQL[] {
  return [...accountWhere(scope), eq(queue.bindingKey, scope.bindingKey)];
}

/** Arrived before ingress row `id` (a row that does not exist matches nothing). */
function arrivedBefore(id: string): SQL {
  return lt(
    queue.createdAt,
    sql`(select ${queue.createdAt} from ${queue} where ${queue.id} = ${id})`,
  );
}

/** Which session a row's thread snapshot reached, and in which prompt. */
export interface ThreadContextMarker {
  agentId: string;
  deliveryId: string;
}

export class ChannelInboxStore {
  constructor(private readonly database: DrizzleHandle) {}

  /** File rows of the scope's account under its binding, in one state. */
  async file(
    scope: ChannelInboxScope,
    ids: readonly string[],
    state: schema.ChannelInboxState,
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.database
      .update(queue)
      .set({ bindingKey: scope.bindingKey, inboxState: state })
      .where(and(...accountWhere(scope), inArray(queue.id, [...ids])));
  }

  /** The binding's rows in one state, oldest first. */
  async list(
    scope: ChannelInboxScope,
    input: ListChannelInboxInput,
  ): Promise<ChannelIngressQueueRecord[]> {
    if (input.newest === 0) return [];
    const rows = await this.database
      .select()
      .from(queue)
      .where(
        and(
          ...scopeWhere(scope),
          eq(queue.inboxState, input.state),
          ...(input.before === undefined ? [] : [arrivedBefore(input.before)]),
          ...(input.unsent === true ? [isNull(queue.sentIn)] : []),
        ),
      )
      .orderBy(desc(queue.createdAt), desc(queue.id))
      .limit(input.newest ?? 1_000);
    return rows.toReversed().map(toChannelIngress);
  }

  /** The ids of every row of the binding in one state that arrived before `before`. */
  async listIds(
    scope: ChannelInboxScope,
    input: { state: schema.ChannelInboxState; before: string },
  ): Promise<string[]> {
    const rows = await this.database
      .select({ id: queue.id })
      .from(queue)
      .where(
        and(...scopeWhere(scope), eq(queue.inboxState, input.state), arrivedBefore(input.before)),
      );
    return rows.map(({ id }) => id);
  }

  /**
   * A prompt carrying these rows is about to reach the daemon as `deliveryId`.
   * From here its outcome may be unknown: the rows are never sent again as
   * context, and a replay of that prompt reads them back (`listSentIn`).
   */
  async markSent(scope: ChannelInboxScope, ids: readonly string[], deliveryId: string) {
    if (ids.length === 0) return;
    await this.database
      .update(queue)
      .set({ sentIn: deliveryId, bindingKey: scope.bindingKey })
      .where(and(...accountWhere(scope), inArray(queue.id, [...ids]), isNull(queue.sentIn)));
  }

  /**
   * The thread snapshot on row `id` is about to go to `agentId` in prompt
   * `deliveryId` (`bindings/inbox.ts`). Written with the prompt's sent mark,
   * before the send, on the row's own payload, so a replay of that prompt sees
   * it and renders the thread again. It proves nothing about delivery: only
   * `confirmThreadContextSent`, once the daemon took the prompt, does.
   */
  async markThreadContextSent(
    scope: ChannelInboxScope,
    id: string,
    marker: ThreadContextMarker,
  ): Promise<void> {
    await this.database
      .update(queue)
      .set({
        payload: sql`jsonb_set(${queue.payload}, '{threadContextSentTo}', ${JSON.stringify(marker)}::jsonb)`,
      })
      .where(and(...accountWhere(scope), eq(queue.id, id)));
  }

  /** The daemon took prompt `deliveryId`, whose thread snapshot row `id` holds. */
  async confirmThreadContextSent(
    scope: ChannelInboxScope,
    id: string,
    deliveryId: string,
  ): Promise<void> {
    await this.database
      .update(queue)
      .set({
        payload: sql`jsonb_set(${queue.payload}, '{threadContextSentTo,confirmed}', 'true'::jsonb)`,
      })
      .where(
        and(
          ...accountWhere(scope),
          eq(queue.id, id),
          sql`${queue.payload}->'threadContextSentTo'->>'deliveryId' = ${deliveryId}`,
        ),
      );
  }

  /** The thread marker on row `id`, if a prompt already took its snapshot. */
  async threadContextMarkerOf(
    scope: ChannelInboxScope,
    id: string,
  ): Promise<ThreadContextMarker | undefined> {
    const rows = await this.database
      .select({ marker: sql<unknown>`${queue.payload}->'threadContextSentTo'` })
      .from(queue)
      .where(and(...accountWhere(scope), eq(queue.id, id)));
    const marker = rows[0]?.marker as Partial<ThreadContextMarker> | null | undefined;
    return typeof marker?.agentId === "string" && typeof marker.deliveryId === "string"
      ? { agentId: marker.agentId, deliveryId: marker.deliveryId }
      : undefined;
  }

  /**
   * True when a row of the binding in native thread `threadId` that arrived
   * before `before` took its thread snapshot to `agentId` in a prompt the daemon
   * confirmed taking. A sent mark (`sent_in`) is written before the send, so it
   * is not enough. The thread matters when one session serves a whole channel
   * (`bindingKey: channel`): each thread's snapshot goes once.
   */
  async threadContextSentTo(
    scope: ChannelInboxScope,
    agentId: string,
    threadId: string,
    before: string,
  ): Promise<boolean> {
    const rows = await this.database
      .select({ id: queue.id })
      .from(queue)
      .where(
        and(
          ...scopeWhere(scope),
          sql`${queue.payload}->'threadContextSentTo'->>'confirmed' = 'true'`,
          eq(queue.externalThreadId, threadId),
          sql`${queue.payload}->'threadContextSentTo'->>'agentId' = ${agentId}`,
          arrivedBefore(before),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** The rows the first prompt sent as `deliveryId` carried, oldest first. */
  async listSentIn(scope: ChannelInboxScope, deliveryId: string) {
    const rows = await this.database
      .select()
      .from(queue)
      .where(and(...scopeWhere(scope), eq(queue.sentIn, deliveryId)))
      .orderBy(asc(queue.createdAt), asc(queue.id));
    return rows.map(toChannelIngress);
  }

  /** The inbox states of these rows of the account (absent = no such row). */
  async statesOf(scope: ChannelInboxScope, ids: readonly string[]) {
    if (ids.length === 0) return [];
    return this.database
      .select({ id: queue.id, inboxState: queue.inboxState })
      .from(queue)
      .where(and(...accountWhere(scope), inArray(queue.id, [...ids])));
  }

  /** The bindings of an account that hold messages, oldest held first. */
  async listHeldBindings(input: {
    organizationId: string;
    channel: string;
    accountId: string;
  }): Promise<string[]> {
    const rows = await this.database
      .select({ bindingKey: queue.bindingKey })
      .from(queue)
      .where(
        and(
          eq(queue.organizationId, input.organizationId),
          eq(queue.channel, input.channel),
          eq(queue.accountId, input.accountId),
          eq(queue.inboxState, "held"),
        ),
      )
      .groupBy(queue.bindingKey)
      .orderBy(asc(sql`min(${queue.createdAt})`));
    return rows.flatMap(({ bindingKey }) => (bindingKey === null ? [] : [bindingKey]));
  }
}
