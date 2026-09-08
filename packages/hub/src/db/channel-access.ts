// COMPAT(clisbot-channels): the two access-plane tables (goal slice 23) —
// `channel_pairings` (upstream's DM pairing store, organization-scoped) and
// `channel_conversation_selections` (the `/agent` and `/model` choice). Kept
// out of `channels.ts` so neither file grows past the size the standards allow;
// `ChannelStore.access` is the one way in.
import { ChannelCommandStore } from "./channel-commands.js";
import { and, asc, eq, isNull } from "drizzle-orm";
import * as schema from "./schema.js";
import type { SupportedChannelName } from "../channels/catalog.js";
import type { DrizzleHandle } from "./runtime/index.js";
import type { ChannelPairingStatus } from "./schema.js";

/** One sender's pairing request against one account. */
export interface ChannelPairingRecord {
  id: string;
  channel: SupportedChannelName;
  accountId: string;
  senderIdentity: string;
  senderName: string | null;
  code: string;
  status: ChannelPairingStatus;
  externalConversationId: string;
  decidedAt: Date | null;
  createdAt: Date;
}

/** The conversation's `/agent` + `/model` choice; absent = the route's own. */
export interface ChannelConversationSelectionRecord {
  selectedAgent: string | null;
  selectedModel: string | null;
  selectedProvider: string | null;
  selectedThinkingOption: string | null;
  selectedMode: string | null;
  selectedProfile: string | null;
  selectedBy: string;
  updatedAt: Date;
}

/** The conversation key a selection is stored against. */
export interface ChannelConversationKey {
  organizationId: string;
  channel: SupportedChannelName;
  accountId: string;
  externalConversationId: string;
  externalThreadId: string | null;
}

/** The account key pairing rows are scoped by. */
export interface ChannelAccountKey {
  organizationId: string;
  channel: SupportedChannelName;
  accountId: string;
}

export class ChannelAccessStore extends ChannelCommandStore {
  constructor(private readonly database: DrizzleHandle) { super(database); }

  /**
   * The senders an operator approved, in the form upstream's
   * `mergeDmAllowFromSources` expects for `storeAllowFrom`: the native id, not
   * the `<channel>:<id>` identity, because that is what a platform reports as
   * the sender and what an authored `allowFrom` entry names.
   */
  async listApprovedPairedSenders(key: ChannelAccountKey): Promise<string[]> {
    const rows = await this.database
      .select({ senderIdentity: schema.channelPairings.senderIdentity })
      .from(schema.channelPairings)
      .where(and(...accountWhere(key), eq(schema.channelPairings.status, "approved")))
      .orderBy(asc(schema.channelPairings.senderIdentity));
    return rows.map((row) => row.senderIdentity);
  }

  /**
   * Record one unknown sender's request, or return the request already on file.
   *
   * Replay safety is the whole point: the durable ingress queue can hand the
   * same DM back after a crash, and a sender who keeps typing must keep seeing
   * ONE code, not a fresh one per message. `created` is false on every repeat,
   * so the caller can stay silent instead of re-posting the challenge.
   */
  async requestPairing(input: {
    organizationId: string;
    channel: SupportedChannelName;
    accountId: string;
    senderIdentity: string;
    senderName?: string | undefined;
    externalConversationId: string;
    code: string;
  }): Promise<{ record: ChannelPairingRecord; created: boolean }> {
    const existing = await this.findPairing(input);
    if (existing !== undefined) return { record: existing, created: false };
    const [inserted] = await this.database
      .insert(schema.channelPairings)
      .values({
        organizationId: input.organizationId,
        channel: input.channel,
        accountId: input.accountId,
        senderIdentity: input.senderIdentity,
        senderName: input.senderName ?? null,
        code: input.code,
        status: "pending",
        externalConversationId: input.externalConversationId,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted !== undefined) return { record: toPairing(inserted), created: true };
    // A concurrent delivery of the same DM won the insert; its code is the one
    // the sender was shown.
    const raced = await this.findPairing(input);
    if (raced === undefined) throw new Error("channel pairing request could not be recorded");
    return { record: raced, created: false };
  }

  async findPairing(input: {
    organizationId: string;
    channel: SupportedChannelName;
    accountId: string;
    senderIdentity: string;
  }): Promise<ChannelPairingRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(schema.channelPairings)
      .where(
        and(
          ...accountWhere(input),
          eq(schema.channelPairings.senderIdentity, input.senderIdentity),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toPairing(row);
  }

  async listPairings(
    key: ChannelAccountKey,
    status?: ChannelPairingStatus,
  ): Promise<ChannelPairingRecord[]> {
    const rows = await this.database
      .select()
      .from(schema.channelPairings)
      .where(
        and(
          ...accountWhere(key),
          status === undefined ? undefined : eq(schema.channelPairings.status, status),
        ),
      )
      .orderBy(asc(schema.channelPairings.createdAt), asc(schema.channelPairings.id));
    return rows.map(toPairing);
  }

  /**
   * Approve or deny one request. Returns `undefined` when no such request
   * exists, so the management API can answer 404 rather than inventing a row —
   * an operator approving a sender who never asked is a mistake, not a grant.
   */
  async decidePairing(input: {
    organizationId: string;
    channel: SupportedChannelName;
    accountId: string;
    senderIdentity: string;
    decision: "approved" | "denied";
    decidedByUserId?: string | undefined;
    now?: Date | undefined;
  }): Promise<ChannelPairingRecord | undefined> {
    const [row] = await this.database
      .update(schema.channelPairings)
      .set({
        status: input.decision,
        decidedByUserId: input.decidedByUserId ?? null,
        decidedAt: input.now ?? new Date(),
      })
      .where(
        and(
          ...accountWhere(input),
          eq(schema.channelPairings.senderIdentity, input.senderIdentity),
        ),
      )
      .returning();
    return row === undefined ? undefined : toPairing(row);
  }

  async findConversationSelection(
    key: ChannelConversationKey,
  ): Promise<ChannelConversationSelectionRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(schema.channelConversationSelections)
      .where(and(...conversationWhere(key)))
      .limit(1);
    return row === undefined ? undefined : toSelection(row);
  }

  /**
   * Set (or clear, with two nulls) the conversation's agent/model choice.
   *
   * One statement per outcome and no read first: `/agent` and `/model` land in
   * the same row and used to race — both read the row, both wrote their merge,
   * and the second write dropped the first one's field. A field the caller
   * leaves `undefined` is simply absent from the update, so the stored value
   * survives, and the returned record is the row the database now holds.
   */
  async setConversationSelection(
    key: ChannelConversationKey,
    selection: Partial<Omit<ChannelConversationSelectionRecord, "selectedBy" | "updatedAt">> & {
      selectedBy: string;
    },
  ): Promise<ChannelConversationSelectionRecord> {
    const updatedAt = new Date();
    const { selectedBy, ...fields } = selection;
    const changed = {
      ...fields,
      selectedBy,
      updatedAt,
    };
    const [inserted] = await this.database
      .insert(schema.channelConversationSelections)
      .values({
        organizationId: key.organizationId,
        channel: key.channel,
        accountId: key.accountId,
        externalConversationId: key.externalConversationId,
        externalThreadId: key.externalThreadId,
        selectedAgent: selection.selectedAgent ?? null,
        selectedModel: selection.selectedModel ?? null,
        selectedProvider: selection.selectedProvider ?? null,
        selectedThinkingOption: selection.selectedThinkingOption ?? null,
        selectedMode: selection.selectedMode ?? null,
        selectedProfile: selection.selectedProfile ?? null,
        selectedBy: selection.selectedBy,
        updatedAt,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted !== undefined) return toSelection(inserted);
    const [updated] = await this.database
      .update(schema.channelConversationSelections)
      .set(changed)
      .where(and(...conversationWhere(key)))
      .returning();
    if (updated === undefined) {
      throw new Error("channel conversation selection row disappeared while it was being set");
    }
    return toSelection(updated);
  }
}

function toSelection(
  row: typeof schema.channelConversationSelections.$inferSelect,
): ChannelConversationSelectionRecord {
  return {
    selectedAgent: row.selectedAgent,
    selectedModel: row.selectedModel,
    selectedProvider: row.selectedProvider,
    selectedThinkingOption: row.selectedThinkingOption,
    selectedMode: row.selectedMode,
    selectedProfile: row.selectedProfile,
    selectedBy: row.selectedBy,
    updatedAt: row.updatedAt,
  };
}

function accountWhere(key: ChannelAccountKey) {
  return [
    eq(schema.channelPairings.organizationId, key.organizationId),
    eq(schema.channelPairings.channel, key.channel),
    eq(schema.channelPairings.accountId, key.accountId),
  ];
}

function conversationWhere(key: ChannelConversationKey) {
  const table = schema.channelConversationSelections;
  return [
    eq(table.organizationId, key.organizationId),
    // The channel is part of the key: one organization can run `support` on
    // Slack and on Telegram, and a conversation id is only unique inside its
    // own channel.
    eq(table.channel, key.channel),
    eq(table.accountId, key.accountId),
    eq(table.externalConversationId, key.externalConversationId),
    key.externalThreadId === null
      ? isNull(table.externalThreadId)
      : eq(table.externalThreadId, key.externalThreadId),
  ];
}

function toPairing(row: typeof schema.channelPairings.$inferSelect): ChannelPairingRecord {
  return {
    id: row.id,
    channel: row.channel,
    accountId: row.accountId,
    senderIdentity: row.senderIdentity,
    senderName: row.senderName,
    code: row.code,
    status: row.status,
    externalConversationId: row.externalConversationId,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}
