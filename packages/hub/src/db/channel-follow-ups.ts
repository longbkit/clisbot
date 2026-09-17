import { and, eq, isNull } from "drizzle-orm";
import { ChannelCommandStore } from "./channel-commands.js";
import * as schema from "./schema.js";
import type { ChannelConversationKey } from "./channel-access.js";

/** `/followup auto|mention-only` replaces the Route mode; `pause` waits for the next mention. */
export type ConversationFollowUpMode = "auto" | "mention-only" | "paused";

export interface ConversationFollowUpRecord {
  mode: ConversationFollowUpMode;
  setBy: string;
  updatedAt: Date;
}

/** The conversation's `/followup` override; absent = the Route's `interaction.followUp.mode`. */
export class ChannelFollowUpStore extends ChannelCommandStore {
  async findConversationFollowUp(
    key: ChannelConversationKey,
  ): Promise<ConversationFollowUpRecord | undefined> {
    const [row] = await this.database
      .select(followUpColumns)
      .from(schema.channelConversationFollowUps)
      .where(and(...followUpWhere(key)))
      .limit(1);
    return row;
  }

  async setConversationFollowUp(
    key: ChannelConversationKey,
    input: { mode: ConversationFollowUpMode; setBy: string },
  ): Promise<void> {
    const updatedAt = new Date();
    const [inserted] = await this.database
      .insert(schema.channelConversationFollowUps)
      .values({ ...key, ...input, updatedAt })
      .onConflictDoNothing()
      .returning({ id: schema.channelConversationFollowUps.id });
    if (inserted !== undefined) return;
    await this.database
      .update(schema.channelConversationFollowUps)
      .set({ ...input, updatedAt })
      .where(and(...followUpWhere(key)));
  }

  /** One conditional delete: a mention costs no read, and only a pause ends. */
  async clearPausedConversationFollowUp(key: ChannelConversationKey): Promise<void> {
    await this.database
      .delete(schema.channelConversationFollowUps)
      .where(and(...followUpWhere(key), eq(schema.channelConversationFollowUps.mode, "paused")));
  }

  async clearConversationFollowUp(key: ChannelConversationKey): Promise<void> {
    await this.database
      .delete(schema.channelConversationFollowUps)
      .where(and(...followUpWhere(key)));
  }
}

const followUpColumns = {
  mode: schema.channelConversationFollowUps.mode,
  setBy: schema.channelConversationFollowUps.setBy,
  updatedAt: schema.channelConversationFollowUps.updatedAt,
};

function followUpWhere(key: ChannelConversationKey) {
  const table = schema.channelConversationFollowUps;
  return [
    eq(table.organizationId, key.organizationId),
    eq(table.channel, key.channel),
    eq(table.accountId, key.accountId),
    eq(table.externalConversationId, key.externalConversationId),
    key.externalThreadId === null
      ? isNull(table.externalThreadId)
      : eq(table.externalThreadId, key.externalThreadId),
  ];
}
