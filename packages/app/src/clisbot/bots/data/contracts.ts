import type {
  BotPayload as WireBot,
  BotKind,
  BotLaunchDefaults,
} from "@clisbot/protocol/bots/types";
import type {
  ChatRules,
  ChatMessageSender,
  ChatMessagePayload,
  ChatPayload as WireChat,
} from "@clisbot/protocol/chats/types";
export type { BotKind, BotLaunchDefaults, ChatRules, ChatMessageSender };
// Display projections of canonical protocol records. The wire is never re-declared here.
export type BotPayload = Pick<
  WireBot,
  | "id"
  | "slug"
  | "name"
  | "title"
  | "description"
  | "avatar"
  | "projectId"
  | "workspaceId"
  | "cwd"
  | "kind"
  | "canConfigure"
  | "isOwner"
> &
  Partial<Pick<WireBot, "template" | "sharesProject">> & { launchDefaults: BotLaunchDefaults };
export type ChatParticipant = Pick<WireChat["participants"][number], "botId" | "agentId"> &
  Partial<Pick<WireChat["participants"][number], "displayName">>;
export type ChatPayload = Pick<WireChat, "id" | "kind" | "rules" | "createdAt" | "updatedAt"> & {
  title: string;
  participants: ChatParticipant[];
};
export type ChatMessage = Pick<
  ChatMessagePayload,
  "id" | "seq" | "at" | "sender" | "text" | "images" | "attachments" | "scheduleRun"
> & {
  agentId?: string;
  timelineItemId?: string;
  reply?: ChatMessagePayload["reply"];
};
export interface ChatTranscriptPage {
  messages: ChatMessage[];
  hasOlder: boolean;
}
export function botView(bot: WireBot): BotPayload {
  return { ...bot, launchDefaults: bot.launch };
}
export function chatView(chat: WireChat): ChatPayload {
  return { ...chat, title: chat.title ?? chat.participants.map((p) => p.displayName).join(", ") };
}
export function messageView(line: ChatMessagePayload): ChatMessage {
  return { ...line, agentId: line.reply?.agentId };
}
