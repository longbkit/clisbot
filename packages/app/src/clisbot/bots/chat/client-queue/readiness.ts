import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { isGroupChat } from "../chat-kind";

/** Absence of the optional group discussion projection is not proof between speakers is idle. */
export function clientChatBusy(
  chat: ChatPayload,
  participant: (id: string) => { active: boolean; known: boolean; permission: boolean },
): boolean | null {
  let unknown = isGroupChat(chat) && chat.discussionActive === undefined;
  if (chat.discussionActive === true) return true;
  for (const member of chat.participants) {
    if (!member.agentId) continue;
    const state = participant(member.agentId);
    if (state.active || state.permission) return true;
    unknown ||= !state.known;
  }
  return unknown ? null : false;
}
