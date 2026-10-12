import { BotLaunchDefaultsSchema } from "../bots/types.js";
import { AgentAttachmentSchema, ImageAttachmentSchema } from "../agent-attachments.js";
import { z } from "zod";
import {
  ChatMessagePayloadSchema,
  ChatPayloadSchema,
  ChatRulesSchema,
  ChatTranscriptDirectionSchema,
} from "./types.js";

/**
 * `chat.*` RPCs (docs/features/bots-and-chats/README.md, "RPC surface"; plans/server-chat.md §4).
 * Gated once on `server_info.features.bots` together with `bot.*`; a daemon with the flag off
 * answers `rpc_error bots_disabled`. Beyond the ids a request names, every field is optional.
 */

/** A first message sent right after the record is written, so "create by typing" is one round trip. */
export const ChatFirstMessageSchema = z.object({
  text: z.string(),
  images: z.array(ImageAttachmentSchema).optional(),
  attachments: z.array(AgentAttachmentSchema).optional(),
  messageId: z.string().optional(),
});

/** What `chat.message.send` did: the user line's id and seq, and the bots it was handed to. */
export const ChatSendResultSchema = z.object({
  messageId: z.string(),
  seq: z.number().int(),
  targets: z.array(z.string()),
  /** True when `messageId` had already been written; nothing was sent again. */
  duplicate: z.boolean().optional(),
});
export type ChatSendResult = z.infer<typeof ChatSendResultSchema>;

export const ChatCreateRequestSchema = z.object({
  type: z.literal("chat.create.request"),
  requestId: z.string(),
  botIds: z.array(z.string()),
  // COMPAT(quickStarts): per-chat configuration and retry identity; gated on quickStarts.
  launch: BotLaunchDefaultsSchema.optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
  kind: z.enum(["direct", "group"]).optional(),
  title: z.string().nullable().optional(),
  rules: ChatRulesSchema.optional(),
  firstMessage: ChatFirstMessageSchema.optional(),
});

export const ChatCreateResponseSchema = z.object({
  type: z.literal("chat.create.response"),
  payload: z.object({
    requestId: z.string(),
    chat: ChatPayloadSchema.nullable(),
    /** Present when the request carried `firstMessage`; the line itself arrives as a push. */
    sent: ChatSendResultSchema.optional(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

export const ChatListRequestSchema = z.object({
  type: z.literal("chat.list.request"),
  requestId: z.string(),
  includeArchived: z.boolean().optional(),
});

export const ChatListResponseSchema = z.object({
  type: z.literal("chat.list.response"),
  payload: z.object({
    requestId: z.string(),
    chats: z.array(ChatPayloadSchema),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

export const ChatParticipantAddRequestSchema = z.object({
  type: z.literal("chat.participant.add.request"),
  requestId: z.string(),
  chatId: z.string(),
  botId: z.string(),
});

export const ChatParticipantAddResponseSchema = z.object({
  type: z.literal("chat.participant.add.response"),
  payload: z.object({
    requestId: z.string(),
    chat: ChatPayloadSchema.nullable(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

export const ChatParticipantRemoveRequestSchema = z.object({
  type: z.literal("chat.participant.remove.request"),
  requestId: z.string(),
  chatId: z.string(),
  botId: z.string(),
});

export const ChatParticipantRemoveResponseSchema = z.object({
  type: z.literal("chat.participant.remove.response"),
  payload: z.object({
    requestId: z.string(),
    chat: ChatPayloadSchema.nullable(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

export const ChatMessageSendRequestSchema = z.object({
  type: z.literal("chat.message.send.request"),
  requestId: z.string(),
  chatId: z.string(),
  text: z.string(),
  images: z.array(ImageAttachmentSchema).optional(),
  attachments: z.array(AgentAttachmentSchema).optional(),
  /** Client-chosen id; a resend with the same id is answered `duplicate: true`. */
  messageId: z.string().optional(),
});

export const ChatMessageSendResponseSchema = z.object({
  type: z.literal("chat.message.send.response"),
  payload: z.object({
    requestId: z.string(),
    messageId: z.string().nullable(),
    seq: z.number().int().nullable(),
    targets: z.array(z.string()),
    duplicate: z.boolean().optional(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

/** Pages like `fetch_agent_timeline_request`: direction + cursor + limit; `limit: 0` = whole window. */
export const ChatTranscriptFetchRequestSchema = z.object({
  type: z.literal("chat.transcript.fetch.request"),
  requestId: z.string(),
  chatId: z.string(),
  direction: ChatTranscriptDirectionSchema.optional(),
  cursor: z.object({ seq: z.number().int() }).optional(),
  limit: z.number().int().nonnegative().optional(),
});

export const ChatTranscriptFetchResponseSchema = z.object({
  type: z.literal("chat.transcript.fetch.response"),
  payload: z.object({
    requestId: z.string(),
    lines: z.array(ChatMessagePayloadSchema),
    hasOlder: z.boolean(),
    hasNewer: z.boolean(),
    startSeq: z.number().int(),
    endSeq: z.number().int(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

export const ChatArchiveRequestSchema = z.object({
  type: z.literal("chat.archive.request"),
  requestId: z.string(),
  chatId: z.string(),
});

export const ChatArchiveResponseSchema = z.object({
  type: z.literal("chat.archive.response"),
  payload: z.object({
    requestId: z.string(),
    chat: ChatPayloadSchema.nullable(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

/** `/new` for one bot in one chat (D7): the next message starts a fresh session. */
export const ChatSessionResetRequestSchema = z.object({
  type: z.literal("chat.session.reset.request"),
  requestId: z.string(),
  chatId: z.string(),
  botId: z.string(),
});

export const ChatSessionResetResponseSchema = z.object({
  type: z.literal("chat.session.reset.response"),
  payload: z.object({
    requestId: z.string(),
    chatId: z.string(),
    botId: z.string(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

export const ChatTranscriptAppendedSchema = z.object({
  type: z.literal("chat.transcript.appended"),
  payload: z.object({
    chatId: z.string(),
    subscriptionId: z.string().optional(),
    line: ChatMessagePayloadSchema,
  }),
});

/** Participant, rule or title change, or archive; the whole record, like `bot.updated`. */
export const ChatUpdatedSchema = z.object({
  type: z.literal("chat.updated"),
  payload: z.object({ chat: ChatPayloadSchema, subscriptionId: z.string().optional() }),
});

export type ChatCreateRequest = z.infer<typeof ChatCreateRequestSchema>;
export type ChatCreateResponse = z.infer<typeof ChatCreateResponseSchema>;
export type ChatListRequest = z.infer<typeof ChatListRequestSchema>;
export type ChatListResponse = z.infer<typeof ChatListResponseSchema>;
export type ChatParticipantAddRequest = z.infer<typeof ChatParticipantAddRequestSchema>;
export type ChatParticipantAddResponse = z.infer<typeof ChatParticipantAddResponseSchema>;
export type ChatParticipantRemoveRequest = z.infer<typeof ChatParticipantRemoveRequestSchema>;
export type ChatParticipantRemoveResponse = z.infer<typeof ChatParticipantRemoveResponseSchema>;
export type ChatMessageSendRequest = z.infer<typeof ChatMessageSendRequestSchema>;
export type ChatMessageSendResponse = z.infer<typeof ChatMessageSendResponseSchema>;
export type ChatTranscriptFetchRequest = z.infer<typeof ChatTranscriptFetchRequestSchema>;
export type ChatTranscriptFetchResponse = z.infer<typeof ChatTranscriptFetchResponseSchema>;
export type ChatArchiveRequest = z.infer<typeof ChatArchiveRequestSchema>;
export type ChatArchiveResponse = z.infer<typeof ChatArchiveResponseSchema>;
export type ChatSessionResetRequest = z.infer<typeof ChatSessionResetRequestSchema>;
export type ChatSessionResetResponse = z.infer<typeof ChatSessionResetResponseSchema>;
export type ChatTranscriptAppendedMessage = z.infer<typeof ChatTranscriptAppendedSchema>;
export type ChatUpdatedMessage = z.infer<typeof ChatUpdatedSchema>;

/** The longest room instructions a chat owner may write. */
export const CHAT_ROOM_INSTRUCTIONS_MAX_CHARS = 4000;
/** The most rounds a group discussion may be allowed; a guard rail, not a budget. */
export const CHAT_ROUNDS_MAX = 20;

/** Group name, the everyday reply policy, the room instructions and the tools off list. */
export const ChatUpdatePatchSchema = z
  .object({
    title: z.string().max(256).nullable().optional(),
    requireMention: z.boolean().optional(),
    roomInstructions: z.string().max(CHAT_ROOM_INSTRUCTIONS_MAX_CHARS).nullable().optional(),
    roundsMax: z.number().int().positive().max(CHAT_ROUNDS_MAX).optional(),
    /** The whole tools off list of the Chat; a direct chat may change only this. */
    toolsOff: z.array(z.string().min(1).max(300)).max(1000).optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.title !== undefined ||
      patch.requireMention !== undefined ||
      patch.roomInstructions !== undefined ||
      patch.roundsMax !== undefined ||
      patch.toolsOff !== undefined,
    "Choose a group setting to update",
  );
export const ChatUpdateRequestSchema = z.object({
  type: z.literal("chat.update.request"),
  requestId: z.string(),
  chatId: z.string(),
  patch: ChatUpdatePatchSchema,
});
export const ChatUpdateResponseSchema = z.object({
  type: z.literal("chat.update.response"),
  payload: z.object({
    requestId: z.string(),
    chat: ChatPayloadSchema.nullable(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});
export type ChatUpdatePatch = z.infer<typeof ChatUpdatePatchSchema>;
export type ChatUpdateRequest = z.infer<typeof ChatUpdateRequestSchema>;
export type ChatUpdateResponse = z.infer<typeof ChatUpdateResponseSchema>;

/** Stop all: ends the group discussion and interrupts every bot turn running in the chat. */
export const ChatDiscussionStopRequestSchema = z.object({
  type: z.literal("chat.discussion.stop.request"),
  requestId: z.string(),
  chatId: z.string(),
});
export const ChatDiscussionStopResponseSchema = z.object({
  type: z.literal("chat.discussion.stop.response"),
  payload: z.object({
    requestId: z.string(),
    chatId: z.string(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});
export type ChatDiscussionStopRequest = z.infer<typeof ChatDiscussionStopRequestSchema>;
export type ChatDiscussionStopResponse = z.infer<typeof ChatDiscussionStopResponseSchema>;
