import type { MessagePayload } from "@/composer/types";
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { discardChatSend, startChatSend } from "@/outbox/chat-delivery";
import { handOffDelivery } from "@/outbox/handoff";
import { refreshBotsAndChats } from "../data/runtime";

function refreshAfterSend(
  client: DaemonClient,
  chatId: string,
  chat: ChatPayload,
  setChat: Dispatch<SetStateAction<ChatPayload | null>>,
): void {
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
}

async function resetChat(client: DaemonClient, chatId: string, chat: ChatPayload) {
  for (const p of chat.participants) {
    const r = await client.resetChatSession({ chatId, botId: p.botId });
    if (r.error) throw new Error(r.error);
  }
}

/**
 * A message shows in the press frame and is delivered from the outbox under one id, so the
 * composer is free at once and a retry is deduplicated by the Host. `/new` still waits: it
 * resets sessions rather than adding a line.
 */
export function useChatSend(
  client: DaemonClient | null,
  online: boolean,
  chatId: string,
  chat: ChatPayload | null,
  setChat: Dispatch<SetStateAction<ChatPayload | null>>,
  setError: Dispatch<SetStateAction<string | null>>,
  attachmentsSupported = false,
  serverId?: string,
) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const send = useCallback(
    async (payload: MessagePayload) => {
      const { text } = payload;
      if (!chat) throw new Error(t("bots.chat.send.chatUnavailable"));
      if (payload.attachments.length > 0 && !attachmentsSupported)
        throw new Error(t("bots.chat.send.attachmentsNeedUpdate"));
      setError(null);
      if (text.trim() === "/new" && payload.attachments.length === 0) {
        if (!client || !online) throw new Error(t("bots.chat.common.hostDisconnected"));
        setSending(true);
        try {
          await resetChat(client, chatId, chat);
          refreshAfterSend(client, chatId, chat, setChat);
        } catch (e) {
          setError(String(e));
          throw e;
        } finally {
          setSending(false);
        }
        return;
      }
      const { clientMessageId, delivery } = startChatSend({
        serverId: serverId ?? "",
        client: online ? client : null,
        chat,
        text,
        attachments: payload.attachments,
        ...(payload.activeTurnBehavior ? { activeTurnBehavior: payload.activeTurnBehavior } : {}),
        ...(payload.queueParts ? { queueParts: payload.queueParts } : {}),
      });
      void delivery.then((outcome) => {
        if (outcome.kind === "sent" && client) refreshAfterSend(client, chatId, chat, setChat);
        return undefined;
      });
      await handOffDelivery(delivery, () => discardChatSend(clientMessageId));
    },
    [client, online, chat, chatId, setChat, setError, attachmentsSupported, serverId, t],
  );
  return { send, sending };
}
