import { z } from "zod";
import {
  ChatMessageSenderSchema,
  ChatPayloadSchema,
  type ChatPayload,
} from "@clisbot/protocol/chats/types";
import type { ChatMessage } from "@/clisbot/bots/data/contracts";

/** How many transcript lines a Chat keeps on the device (docs/features/offline/offline-cache.md). */
export const CHAT_TAIL_MAX_LINES = 50;

/** A cached line; its images stay on the Host and show as a placeholder until it reconnects. */
export type CachedChatMessage = ChatMessage & { offlineImageCount?: number };

export interface CachedChatTail {
  chat: ChatPayload;
  messages: CachedChatMessage[];
  hasOlder: boolean;
}

const StoredChatLineSchema = z.strictObject({
  id: z.string(),
  seq: z.number().int(),
  at: z.string(),
  sender: ChatMessageSenderSchema,
  text: z.string(),
  agentId: z.string().optional(),
  inReplyTo: z.string().optional(),
  imageCount: z.number().int().positive().optional(),
});

export const StoredChatTailSchema = z.strictObject({
  chat: ChatPayloadSchema,
  lines: z.array(StoredChatLineSchema),
  hasOlder: z.boolean(),
});

type StoredChatTail = z.infer<typeof StoredChatTailSchema>;
type StoredChatLine = z.infer<typeof StoredChatLineSchema>;

function serializeLine(message: CachedChatMessage): StoredChatLine {
  const imageCount = message.images?.length ?? message.offlineImageCount ?? 0;
  return {
    id: message.id,
    seq: message.seq,
    at: message.at,
    sender: message.sender,
    text: message.text,
    ...(message.agentId ? { agentId: message.agentId } : {}),
    ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
    ...(imageCount > 0 ? { imageCount } : {}),
  };
}

export function serializeChatTail(tail: CachedChatTail): StoredChatTail {
  const lines = tail.messages.slice(-CHAT_TAIL_MAX_LINES);
  return {
    chat: tail.chat,
    lines: lines.map(serializeLine),
    hasOlder: tail.hasOlder || lines.length < tail.messages.length,
  };
}

export function deserializeChatTail(stored: StoredChatTail): CachedChatTail {
  return {
    chat: stored.chat,
    messages: stored.lines.map(({ imageCount, ...line }) => ({
      ...line,
      ...(imageCount ? { offlineImageCount: imageCount } : {}),
    })),
    hasOlder: stored.hasOlder,
  };
}
