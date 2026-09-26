// Wire-facing shapes of a Chat and its transcript
// (docs/features/bots-and-chats/README.md, D5–D9). The daemon's `chat.json`
// record adds `deliveredSeq` per participant and applies the rule defaults;
// what crosses the wire is what the app renders. Not `../chat/`: that folder is
// the removed chat-rooms feature kept as `COMPAT(chatRooms)`.
import { z } from "zod";
import { SessionActorSchema } from "../session-authorship.js";

/** What a busy bot does with a new message: steer the running turn or wait for it. */
export const ChatWhenBusySchema = z.enum(["steer", "queue"]);
export type ChatWhenBusy = z.infer<typeof ChatWhenBusySchema>;

/** A positive whole number, or `off` to turn a default off (the Route limit shape). */
export const ChatLimitValueSchema = z.union([z.number().int().positive(), z.literal("off")]);
export type ChatLimitValue = z.infer<typeof ChatLimitValueSchema>;

/**
 * Every limit leaf a Chat accepts, named like the Route's. Phase 1 enforces
 * `maxInputCharacters` only; the others are accepted and ignored
 * (docs/features/bots-and-chats/implementation.md, "Chat limits in phase 1").
 */
export const CHAT_LIMIT_NAMES = [
  "maxInputCharacters",
  "messagesPerMinutePerSender",
  "messagesPerMinute",
  "messagesSentPerMinute",
  "maxConcurrentRuns",
  "maxRuntimeSeconds",
] as const;
export type ChatLimitName = (typeof CHAT_LIMIT_NAMES)[number];

export const ChatLimitsSchema = z.object(
  Object.fromEntries(
    CHAT_LIMIT_NAMES.map((name) => [name, ChatLimitValueSchema.optional()]),
  ) as Record<ChatLimitName, z.ZodOptional<typeof ChatLimitValueSchema>>,
);
export type ChatLimits = z.infer<typeof ChatLimitsSchema>;

/** Who answers and how much a bot sees; every leaf optional on the wire, defaulted by the daemon. */
export const ChatRulesSchema = z.object({
  interaction: z
    .object({
      requireMention: z.boolean().optional(),
      whenBusy: ChatWhenBusySchema.optional(),
    })
    .optional(),
  hops: z.object({ max: z.number().int().nonnegative().optional() }).optional(),
  context: z.object({ maxMessages: z.number().int().positive().optional() }).optional(),
  limits: ChatLimitsSchema.optional(),
});
export type ChatRules = z.infer<typeof ChatRulesSchema>;

export const ChatMessageSenderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), actor: SessionActorSchema.optional() }),
  z.object({ kind: z.literal("bot"), botId: z.string() }),
  z.object({ kind: z.literal("system") }),
]);
export type ChatMessageSender = z.infer<typeof ChatMessageSenderSchema>;

/** Where a bot line came from: the session and, with session storage on, the timeline row. */
export const ChatMessageReplySchema = z.object({
  agentId: z.string(),
  turnId: z.string().optional(),
  epoch: z.string().optional(),
  seq: z.number().int().optional(),
});
export type ChatMessageReply = z.infer<typeof ChatMessageReplySchema>;

/** One transcript line. `seq` is the transcript's own monotonic position. */
export const ChatMessagePayloadSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  at: z.string(),
  sender: ChatMessageSenderSchema,
  text: z.string(),
  reply: ChatMessageReplySchema.optional(),
  inReplyTo: z.string().optional(),
  /** Accepted target snapshot, persisted before dispatch for restart recovery. */
  deliveryBotIds: z.array(z.string()).optional(),
  /** 0 for a user line; a bot line answering a hop-n line is hop n+1. */
  hop: z.number().int().nonnegative(),
});
export type ChatMessagePayload = z.infer<typeof ChatMessagePayloadSchema>;

/** A participant as the app renders it: the bot's identity beside its live session. */
export const ChatParticipantPayloadSchema = z.object({
  botId: z.string(),
  slug: z.string(),
  displayName: z.string(),
  addedAt: z.string(),
  agentId: z.string().nullable(),
});
export type ChatParticipantPayload = z.infer<typeof ChatParticipantPayloadSchema>;

export const ChatPayloadSchema = z.object({
  /** Stable kind; old daemons omit it. Adding a second bot promotes a direct Chat to group. */
  // COMPAT(chatKind): older records infer by participant count; new groups retain kind.
  kind: z.enum(["direct", "group"]).optional(),
  id: z.string(),
  title: z.string().nullable(),
  participants: z.array(ChatParticipantPayloadSchema),
  rules: ChatRulesSchema,
  createdBy: SessionActorSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
});
export type ChatPayload = z.infer<typeof ChatPayloadSchema>;

export const ChatTranscriptDirectionSchema = z.enum(["tail", "before", "after"]);
export type ChatTranscriptDirection = z.infer<typeof ChatTranscriptDirectionSchema>;
