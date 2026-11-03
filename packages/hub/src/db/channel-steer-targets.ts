// The turn each channel Steer named, per daemon message id
// (`channels/daemon/steer-target.ts`). First writer wins, so two Hub processes
// retrying one message agree on its turn, and a retry after a restart or a lost
// ingress acknowledgement names the turn the daemon's receipt already holds.
//
// Each attempt counts itself in `dispatches` before it sends, and in
// `undelivered` once it is known not to have reached the agent. The record is
// forgotten only while the two are equal: an attempt whose outcome is unknown,
// still in flight or lost, keeps the turn for every later attempt. Each step is
// one conditional statement, so concurrent attempts need no transaction.
import { and, eq, isNull, lt, notExists, sql } from "drizzle-orm";
import * as schema from "./schema.js";
import type { DrizzleHandle } from "./runtime/index.js";

const targets = schema.channelSteerTargets;

export class ChannelSteerTargetStore {
  constructor(private readonly database: DrizzleHandle) {}

  /** The per-organization view a channel connection uses (`SteerTargetStore`). */
  forOrganization(organizationId: string) {
    return {
      find: (agentId: string, messageId: string) => this.find(organizationId, agentId, messageId),
      claim: (agentId: string, messageId: string, turnId: string | null) =>
        this.claim(organizationId, agentId, messageId, turnId),
      begin: (agentId: string, messageId: string) => this.begin(organizationId, agentId, messageId),
      undelivered: (agentId: string, messageId: string, turnId: string | null) =>
        this.markUndelivered(organizationId, agentId, messageId, turnId),
    };
  }

  /** The recorded turn: a turn id, `null` for none, `undefined` when nothing is recorded. */
  async find(
    organizationId: string,
    agentId: string,
    messageId: string,
  ): Promise<string | null | undefined> {
    const [row] = await this.database
      .select({ turnId: targets.turnId })
      .from(targets)
      .where(key(organizationId, agentId, messageId));
    return row === undefined ? undefined : row.turnId;
  }

  /** Record `turnId` unless a turn is already recorded. */
  async claim(
    organizationId: string,
    agentId: string,
    messageId: string,
    turnId: string | null,
  ): Promise<void> {
    await this.database
      .insert(targets)
      .values({ organizationId, agentId, messageId, turnId })
      .onConflictDoNothing();
  }

  /** Count an attempt about to send; the turn it must name, `undefined` when no record. */
  async begin(
    organizationId: string,
    agentId: string,
    messageId: string,
  ): Promise<string | null | undefined> {
    const [row] = await this.database
      .update(targets)
      .set({ dispatches: sql`${targets.dispatches} + 1` })
      .where(key(organizationId, agentId, messageId))
      .returning({ turnId: targets.turnId });
    return row === undefined ? undefined : row.turnId;
  }

  /**
   * Count an attempt naming `turnId` that did not reach the agent; forget the
   * record when every attempt that began is so counted.
   */
  async markUndelivered(
    organizationId: string,
    agentId: string,
    messageId: string,
    turnId: string | null,
  ): Promise<void> {
    const [row] = await this.database
      .update(targets)
      .set({ undelivered: sql`${targets.undelivered} + 1` })
      .where(and(key(organizationId, agentId, messageId), sameTurn(turnId)))
      .returning({ dispatches: targets.dispatches, undelivered: targets.undelivered });
    if (row === undefined || row.undelivered < row.dispatches) return;
    await this.database
      .delete(targets)
      .where(
        and(
          key(organizationId, agentId, messageId),
          eq(targets.dispatches, row.dispatches),
          eq(targets.undelivered, row.dispatches),
        ),
      );
  }

  /**
   * Forget records older than `olderThan` that no ingress row still carries as
   * its prompt (`sent_in`): while a row can be retried or resubmitted, its
   * message keeps its turn.
   */
  async prune(organizationId: string, olderThan: Date): Promise<number> {
    const queue = schema.channelIngressQueue;
    const result = await this.database.delete(targets).where(
      and(
        eq(targets.organizationId, organizationId),
        lt(targets.createdAt, olderThan),
        notExists(
          this.database
            .select({ id: queue.id })
            .from(queue)
            .where(
              and(
                eq(queue.organizationId, targets.organizationId),
                eq(queue.sentIn, targets.messageId),
              ),
            ),
        ),
      ),
    );
    return result.rowCount;
  }
}

function key(organizationId: string, agentId: string, messageId: string) {
  return and(
    eq(targets.organizationId, organizationId),
    eq(targets.agentId, agentId),
    eq(targets.messageId, messageId),
  );
}

function sameTurn(turnId: string | null) {
  return turnId === null ? isNull(targets.turnId) : eq(targets.turnId, turnId);
}
