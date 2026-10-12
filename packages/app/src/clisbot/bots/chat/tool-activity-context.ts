import { createContext, useContext } from "react";
import type { ChatBotIdentity } from "./chat-rows";
import type { BotToolActivity } from "./tool-activity";

/**
 * What the header shows under the `header` tool call display: every Bot's latest turn that used
 * tools. The chat route provides it only in that display; elsewhere it is `null`.
 */
export interface ChatToolActivityHeader {
  serverId: string;
  group: boolean;
  activities: readonly BotToolActivity[];
  bots: ReadonlyMap<string, ChatBotIdentity>;
}

export const ChatToolActivityHeaderContext = createContext<ChatToolActivityHeader | null>(null);

export function useChatToolActivityHeader(): ChatToolActivityHeader | null {
  return useContext(ChatToolActivityHeaderContext);
}
