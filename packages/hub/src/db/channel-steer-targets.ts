// The turn each channel Steer named, per daemon message id
// (`channels/daemon/steer-target.ts`). First writer wins, so two Hub processes
// retrying one message agree on its turn, and a retry after a restart or a lost
// ingress acknowledgement names the turn the daemon's receipt already holds.
import { and, eq, isNull, lt, notExists } from "drizzle-orm";
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
      release: (agentId: string, messageId: string, turnId: string | null) =>
        this.release(organizationId, agentId, messageId, turnId),
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

  /** Record `turnId` unless a turn is already recorded; return the recorded one. */
  async claim(
    organizationId: string,
    agentId: string,
    messageId: string,
    turnId: string | null,
  ): Promise<string | null> {
    await this.database
      .insert(targets)
      .values({ organizationId, agentId, messageId, turnId })
      .onConflictDoNothing();
    const recorded = await this.find(organizationId, agentId, messageId);
    if (recorded === undefined) throw new Error("The Steer target was not recorded.");
    return recorded;
  }

  /** Forget the record only while it still names `turnId`, so a newer claim survives. */
  async release(
    organizationId: string,
    agentId: string,
    messageId: string,
    turnId: string | null,
  ): Promise<void> {
    await this.database
      .delete(targets)
      .where(
        and(
          key(organizationId, agentId, messageId),
          turnId === null ? isNull(targets.turnId) : eq(targets.turnId, turnId),
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
