import { and, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type { ChannelAccountKey } from "./channel-access.js";
import type { DrizzleHandle } from "./runtime/index.js";

export interface ChannelCommandReceiptKey extends ChannelAccountKey {
  /** Native source conversation, independent of route binding or thread-collapse settings. */
  externalConversationId: string;
}
export interface ChannelCommandReceipt {
  claimed: boolean;
  status: "pending" | "completed";
  handled?: boolean;
  detail?: string;
}

/** A pending receipt is never reclaimed: dispatch may already have reached the daemon. */
export class ChannelCommandReceiptStore {
  constructor(protected readonly database: DrizzleHandle) {}

  async beginCommand(
    key: ChannelCommandReceiptKey,
    eventId: string,
    command: string,
  ): Promise<ChannelCommandReceipt> {
    if (eventId.trim() === "") throw new Error("A command receipt requires an external message id");
    const [inserted] = await this.database
      .insert(schema.channelCommandReceipts)
      .values({ ...key, externalMessageId: eventId, command, status: "pending" })
      .onConflictDoNothing()
      .returning({ id: schema.channelCommandReceipts.id });
    if (inserted) return { claimed: true, status: "pending" };
    const [row] = await this.database
      .select()
      .from(schema.channelCommandReceipts)
      .where(and(...receiptWhere(key, eventId)))
      .limit(1);
    if (!row) throw new Error("The channel command receipt disappeared during admission");
    return {
      claimed: false,
      status: row.status,
      ...(row.handled === null ? {} : { handled: row.handled }),
      ...(row.detail === null ? {} : { detail: row.detail }),
    };
  }

  async completeCommand(
    key: ChannelCommandReceiptKey,
    eventId: string,
    outcome: {
      handled: boolean;
      detail: string;
    },
  ): Promise<void> {
    await this.database
      .update(schema.channelCommandReceipts)
      .set({
        status: "completed",
        handled: outcome.handled,
        detail: outcome.detail,
        completedAt: new Date(),
      })
      .where(
        and(...receiptWhere(key, eventId), eq(schema.channelCommandReceipts.status, "pending")),
      );
  }
}

function receiptWhere(key: ChannelCommandReceiptKey, eventId: string) {
  const table = schema.channelCommandReceipts;
  return [
    eq(table.organizationId, key.organizationId),
    eq(table.channel, key.channel),
    eq(table.accountId, key.accountId),
    eq(table.externalConversationId, key.externalConversationId),
    eq(table.externalMessageId, eventId),
  ];
}
