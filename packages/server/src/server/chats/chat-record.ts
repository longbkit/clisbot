// `chat.json`: the durable facts of a Chat (docs/features/bots-and-chats/README.md, D5, D9).
// Strict on read like the persisted config: an unknown key is a bug or a newer daemon's
// record, never silently dropped. Rule defaults are applied on read, not stored, so a
// record written before a default changed follows the new default.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ChatLimitValueSchema,
  ChatWhenBusySchema,
  CHAT_LIMIT_NAMES,
  type ChatLimitName,
  type ChatLimitValue,
  type ChatPayload,
  type ChatRules,
  type ChatWhenBusy,
} from "@getpaseo/protocol/chats/types";
import { SessionActorSchema } from "@getpaseo/protocol/session-authorship";
import { CHAT_ROUNDS_MAX } from "@getpaseo/protocol/chats/rpc-schemas";
import { DEFAULT_CHAT_ROUNDS_MAX } from "@getpaseo/protocol/chats/room";

const StoredChatLimitsSchema = z
  .object(
    Object.fromEntries(
      CHAT_LIMIT_NAMES.map((name) => [name, ChatLimitValueSchema.optional()]),
    ) as Record<ChatLimitName, z.ZodOptional<typeof ChatLimitValueSchema>>,
  )
  .strict();

/** The rules as stored: only what the creator set. `resolveChatRules` fills the rest. */
export const StoredChatRulesSchema = z
  .object({
    interaction: z
      .object({
        requireMention: z.boolean().optional(),
        whenBusy: ChatWhenBusySchema.optional(),
      })
      .strict()
      .optional(),
    // COMPAT(chatHops): read and ignored for groups since 2026-09-28; remove after 2027-03-31.
    hops: z.object({ max: z.number().int().nonnegative().optional() }).strict().optional(),
    rounds: z.object({ max: z.number().int().positive().optional() }).strict().optional(),
    room: z.object({ instructions: z.string().nullable().optional() }).strict().optional(),
    context: z.object({ maxMessages: z.number().int().positive().optional() }).strict().optional(),
    limits: StoredChatLimitsSchema.optional(),
  })
  .strict();
export type StoredChatRules = z.infer<typeof StoredChatRulesSchema>;

export const ChatCompletedTurnSchema = z
  .object({
    agentId: z.string(),
    turnId: z.string(),
    messageIds: z.array(z.string()),
    lastRow: z.object({ epoch: z.string(), seq: z.number().int().nonnegative() }).nullable(),
  })
  .strict();
export type ChatCompletedTurn = z.infer<typeof ChatCompletedTurnSchema>;

export const StoredChatParticipantSchema = z
  .object({
    botId: z.string().min(1),
    addedAt: z.string(),
    /** Cache of the label lookup; the label on the agent is the truth (D2). */
    agentId: z.string().nullable(),
    /**
     * When `/new` last left a session behind (D7). The label scan that repairs a lost cache
     * adopts only agents created after it, so a reset is not undone by the old session's labels.
     */
    resetAt: z.string().nullable(),
    /** Transcript seq up to which this bot has been handed lines. */
    deliveredSeq: z.number().int().nonnegative(),
    /** Durable proof of the most recent completed turn, before transcript projection. */
    completedTurn: ChatCompletedTurnSchema.nullable().optional(),
    /** `roomFingerprint` of the members and room instructions this bot's session was last told. */
    roomSeen: z.string().optional(),
  })
  .strict();
export type StoredChatParticipant = z.infer<typeof StoredChatParticipantSchema>;

export const StoredChatSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["direct", "group"]).optional(),
    title: z.string().nullable(),
    participants: z.array(StoredChatParticipantSchema),
    rules: StoredChatRulesSchema,
    createdBy: SessionActorSchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastMessageAt: z.string().nullable(),
    archivedAt: z.string().nullable(),
  })
  .strict();
export type StoredChat = z.infer<typeof StoredChatSchema>;

/** D9 defaults for a new Chat. `maxInputCharacters` matches the open-audience Route default. */
export interface ResolvedChatRules {
  interaction: { requireMention: boolean; whenBusy: ChatWhenBusy };
  hops: { max: number };
  /** A guard rail on a group discussion; bots are told to stop earlier (plans/group-discussion.md). */
  rounds: { max: number };
  /** `null` = the built-in default instructions. */
  room: { instructions: string | null };
  context: { maxMessages: number };
  /**
   * Every leaf resolved; unset = no limit. Phase 1 enforces `maxInputCharacters` only; the
   * rate and run leaves are accepted and ignored until a Route can target a Bot
   * (docs/features/bots-and-chats/implementation.md, "Chat limits in phase 1").
   */
  limits: Partial<Record<ChatLimitName, ChatLimitValue>>;
}

export const CHAT_RULE_DEFAULTS: ResolvedChatRules = {
  interaction: { requireMention: false, whenBusy: "steer" },
  hops: { max: 3 },
  rounds: { max: DEFAULT_CHAT_ROUNDS_MAX },
  room: { instructions: null },
  context: { maxMessages: 20 },
  limits: { maxInputCharacters: 8_000 },
};

export function resolveChatRules(rules: ChatRules | undefined): ResolvedChatRules {
  const defaults = CHAT_RULE_DEFAULTS;
  return {
    interaction: {
      requireMention: rules?.interaction?.requireMention ?? defaults.interaction.requireMention,
      whenBusy: rules?.interaction?.whenBusy ?? defaults.interaction.whenBusy,
    },
    hops: { max: rules?.hops?.max ?? defaults.hops.max },
    // The wire accepts any positive count; the daemon caps what it runs.
    rounds: { max: Math.min(rules?.rounds?.max ?? defaults.rounds.max, CHAT_ROUNDS_MAX) },
    room: { instructions: roomInstructionsOf(rules) },
    context: { maxMessages: rules?.context?.maxMessages ?? defaults.context.maxMessages },
    limits: { ...defaults.limits, ...rules?.limits },
  };
}

/** Blank instructions are no instructions: the built-in default applies. */
function roomInstructionsOf(rules: ChatRules | undefined): string | null {
  return rules?.room?.instructions?.trim() || null;
}

/** A limit leaf as a number, or `null` when unset or `off`. */
export function limitValue(rules: ResolvedChatRules, name: ChatLimitName): number | null {
  const value = rules.limits[name];
  return typeof value === "number" ? value : null;
}

export function newChatId(): string {
  return `cht_${randomBytes(8).toString("hex")}`;
}

/** The bot facts a Chat needs beside a participant: identity and where its sessions live. */
export interface ChatBot {
  id: string;
  slug: string;
  displayName: string;
  /** What the other bots in a group read to decide when to tag this one. */
  description?: string | null;
  workspaceId: string;
  cwd: string;
  launch: {
    provider: string;
    model?: string | undefined;
    modeId?: string | undefined;
    thinkingOptionId?: string | undefined;
    featureValues?: Record<string, unknown> | undefined;
  };
}

/** Records written before `kind` existed are groups when they hold several bots. */
export function chatKindOf(chat: Pick<StoredChat, "kind" | "participants">): "direct" | "group" {
  return chat.kind ?? (chat.participants.length > 1 ? "group" : "direct");
}

/** The record as the app sees it: `deliveredSeq` dropped, the bot's name and slug added. */
export function chatPayload(
  chat: StoredChat,
  botOf: (botId: string) => Pick<ChatBot, "slug" | "displayName"> | null,
): ChatPayload {
  return {
    id: chat.id,
    kind: chatKindOf(chat),
    title: chat.title,
    participants: chat.participants.map((participant) => {
      const bot = botOf(participant.botId);
      return {
        botId: participant.botId,
        slug: bot?.slug ?? participant.botId,
        displayName: bot?.displayName ?? participant.botId,
        addedAt: participant.addedAt,
        agentId: participant.agentId,
      };
    }),
    rules: resolveChatRules(chat.rules),
    ...(chat.createdBy ? { createdBy: chat.createdBy } : {}),
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    lastMessageAt: chat.lastMessageAt,
    archivedAt: chat.archivedAt,
  };
}
