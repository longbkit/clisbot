import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import { generateDraftId } from "@/stores/draft-keys";
import { createMessageAttemptCache } from "./message-attempt";
import { refreshBotsAndChats } from "../data/runtime";
const attempts = createMessageAttemptCache(generateDraftId);

export function useChatSend(
  client: DaemonClient | null,
  online: boolean,
  chatId: string,
  chat: ChatPayload | null,
  setChat: Dispatch<SetStateAction<ChatPayload | null>>,
  setError: Dispatch<SetStateAction<string | null>>,
) {
  const [sending, setSending] = useState(false);
  const send = useCallback(
    async (text: string) => {
      if (!client || !online) throw new Error("Host is disconnected");
      if (!chat) throw new Error("Chat is not available");
      const attempt = attempts.forChat(client, chatId);
      setSending(true);
      setError(null);
      try {
        if (text.trim() === "/new") {
          for (const p of chat?.participants ?? []) {
            const r = await client.resetChatSession({ chatId, botId: p.botId });
            if (r.error) throw new Error(r.error);
          }
        } else {
          const messageId = attempt.forText(text);
          const result = await client.sendChatMessage({ chatId, text, messageId });
          if (result.error) throw new Error(result.error);
          attempt.accepted(messageId);
        }
        void client
          .listChats()
          .then((result) => {
            // A binding update can arrive before this follow-up RPC. Only replace the
            // exact record this submit started with, never a newer pushed record.
            if (!result.error) {
              const fetched = result.chats.find((c) => c.id === chatId) ?? null;
              setChat((current) => (current === chat ? fetched : current));
            }
            return undefined;
          })
          .catch(() => undefined);
        refreshBotsAndChats();
      } catch (e) {
        setError(String(e));
        throw e;
      } finally {
        setSending(false);
      }
    },
    [client, online, chat, chatId, setChat, setError],
  );
  return { send, sending };
}
