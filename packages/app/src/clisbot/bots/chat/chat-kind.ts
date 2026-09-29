import type { ChatPayload } from "@clisbot/protocol/chats/types";

/**
 * Whether a chat is a group. Chats created before `kind` existed carry no kind: more than one
 * participant makes them a group. Pure.
 */
export function isGroupChat(chat: Pick<ChatPayload, "kind" | "participants">): boolean {
  if (chat.kind) return chat.kind === "group";
  return chat.participants.length > 1;
}
