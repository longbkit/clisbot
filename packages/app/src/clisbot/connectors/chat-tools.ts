import { createContext, useCallback, useContext, useMemo } from "react";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { useHostFeature } from "@/runtime/host-features";
import { useHostedOffList, type SessionOffEdit } from "./session-connectors";

/**
 * A Chat's own tools off list (docs/features/connectors/README.md, "In a Chat"): what every Bot
 * in it leaves off. It lives on the Chat (`rules.tools.off`), so it outlasts `/new` and reaches a
 * Bot added later, and it only takes away from each Bot's own settings: a change in Bot settings
 * reaches the Chat unless the Chat turned that thing off itself.
 */

export interface ChatToolsBot {
  botId: string;
  name: string;
  workspaceId?: string;
  agentId?: string;
}

export interface ChatTools {
  serverId: string;
  chatId: string;
  group: boolean;
  bots: readonly ChatToolsBot[];
  off: ReadonlySet<string>;
  update(edit: SessionOffEdit): Promise<void>;
}

// COMPAT(chatTools): added in v0.10.2-fusion; remove the gate after 2027-06-30.
const CHAT_TOOLS_FEATURE = "chatTools";

export const ChatToolsContext = createContext<ChatTools | null>(null);

export function useChatTools(): ChatTools | null {
  return useContext(ChatToolsContext);
}

const NONE: ReadonlySet<string> = new Set();

/** The Chat's list as the Host holds it, switched as the session's list is (`useHostedOffList`). */
export function useChatToolsValue(input: {
  serverId: string;
  chat: ChatPayload | null;
  bots: readonly ChatToolsBot[];
  group: boolean;
  client: DaemonClient | null;
}): ChatTools | null {
  const { serverId, chat, bots, group, client } = input;
  const supported = useHostFeature(serverId, CHAT_TOOLS_FEATURE);
  const storedList = chat?.rules.tools?.off;
  const storedKey = storedList?.join(",") ?? "";
  // A new array arrives with every `chat.updated`; the list only changes when its keys do.
  const stored = useMemo(() => (storedKey ? new Set(storedKey.split(",")) : NONE), [storedKey]);
  const chatId = chat?.id ?? null;
  const write = useCallback(
    async (next: ReadonlySet<string>) => {
      if (!client || !chatId) throw new Error("This Host is not connected.");
      const answer = await client.updateChat({ chatId, patch: { toolsOff: [...next] } });
      if (answer.error) throw new Error(answer.error);
    },
    [chatId, client],
  );
  const { off, update } = useHostedOffList({ stored, owner: chatId, write });
  return useMemo(
    () => (supported && chatId ? { serverId, chatId, group, bots, off, update } : null),
    [bots, chatId, group, off, serverId, supported, update],
  );
}
