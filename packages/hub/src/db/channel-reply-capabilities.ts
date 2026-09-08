// COMPAT(clisbot-channels): durable backing for the Channel reply capabilities
// an Agent's `channel_reply` MCP URL carries (`channel_reply_capabilities`).
// The daemon holds that URL for the Agent's whole life, so the Hub must still
// answer the same token after a restart; this module is the only reader and
// writer of the table. Deleting it plus its migration returns the schema to its
// upstream state.
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import * as schema from "./schema.js";
import type { DatabaseRuntime, DrizzleHandle } from "./runtime/index.js";
import type {
  ChannelReplyCapabilityBackend,
  ChannelReplyCapabilityRow,
} from "../channels/channel-reply-capabilities.js";

/** The `channel_reply_capabilities` table, addressed by the token's verifier. */
export class ChannelReplyCapabilityStore implements ChannelReplyCapabilityBackend {
  private readonly database: DrizzleHandle;

  constructor(runtime: DatabaseRuntime) {
    this.database = runtime.drizzle();
  }

  /** Every capability still inside its TTL — the boot rehydration read. */
  async listActive(now: Date): Promise<ChannelReplyCapabilityRow[]> {
    const rows = await this.database
      .select()
      .from(schema.channelReplyCapabilities)
      .where(gt(schema.channelReplyCapabilities.expiresAt, now));
    return rows.map(toCapabilityRow);
  }

  async save(row: ChannelReplyCapabilityRow): Promise<void> {
    await this.database
      .insert(schema.channelReplyCapabilities)
      .values({
        tokenHash: row.tokenHash,
        organizationId: row.organizationId,
        channelRevisionId: row.channelRevisionId,
        routePosition: row.routePosition,
        routeFingerprint: row.routeFingerprint,
        channel: row.channel,
        accountId: row.accountId,
        externalConversationId: row.externalConversationId,
        externalThreadId: row.externalThreadId,
        projectRoot: row.projectRoot,
        requesterSenderId: row.requesterSenderId,
        outputBudget: row.outputBudget,
        agentId: row.agentId,
        expiresAt: row.expiresAt,
      })
      .onConflictDoUpdate({
        target: schema.channelReplyCapabilities.tokenHash,
        set: { agentId: row.agentId, expiresAt: row.expiresAt },
      });
  }

  /** Bind the capability to the Agent the create RPC returned. */
  async bind(tokenHash: string, agentId: string): Promise<void> {
    await this.database
      .update(schema.channelReplyCapabilities)
      .set({ agentId })
      .where(eq(schema.channelReplyCapabilities.tokenHash, tokenHash));
  }

  async deleteTokens(tokenHashes: readonly string[]): Promise<void> {
    if (tokenHashes.length === 0) return;
    await this.database
      .delete(schema.channelReplyCapabilities)
      .where(inArray(schema.channelReplyCapabilities.tokenHash, [...tokenHashes]));
  }

  /** Drop every capability an account owns; the policy-replacement revoke. */
  async deleteAccount(organizationId: string, channel: string, accountId: string): Promise<void> {
    await this.database
      .delete(schema.channelReplyCapabilities)
      .where(
        and(
          eq(schema.channelReplyCapabilities.organizationId, organizationId),
          eq(schema.channelReplyCapabilities.channel, channel),
          eq(schema.channelReplyCapabilities.accountId, accountId),
        ),
      );
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.database
      .delete(schema.channelReplyCapabilities)
      .where(lte(schema.channelReplyCapabilities.expiresAt, now));
  }
}

function toCapabilityRow(
  row: typeof schema.channelReplyCapabilities.$inferSelect,
): ChannelReplyCapabilityRow {
  return {
    tokenHash: row.tokenHash,
    organizationId: row.organizationId,
    channelRevisionId: row.channelRevisionId,
    routePosition: row.routePosition,
    routeFingerprint: row.routeFingerprint,
    channel: row.channel,
    accountId: row.accountId,
    externalConversationId: row.externalConversationId,
    externalThreadId: row.externalThreadId,
    projectRoot: row.projectRoot,
    requesterSenderId: row.requesterSenderId,
    outputBudget: row.outputBudget,
    agentId: row.agentId,
    expiresAt: row.expiresAt,
  };
}
