import type { MessagePayload } from "@/composer/types";
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
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

/** The whole text is `/new` with nothing after it and nothing attached. */
export function isFreshSessionCommand(payload: Pick<MessagePayload, "text" | "attachments">) {
  return payload.text.trim() === "/new" && payload.attachments.length === 0;
}

/**
 * Starts a fresh session for every Bot in the chat (D7) and keeps the chat's history. One reset
 * runs at a time: a second press while one is in flight joins it, so `/new`, its Enter and the ⋯
 * menu never reset twice.
 */
function useStartFreshSession(input: {
  client: DaemonClient | null;
  online: boolean;
  chatId: string;
  chat: ChatPayload | null;
  setChat: Dispatch<SetStateAction<ChatPayload | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const { client, online, chatId, chat, setChat, setError } = input;
  const { t } = useTranslation();
  const [resetting, setResetting] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const startFreshSession = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    if (!chat) return Promise.reject(new Error(t("bots.chat.send.chatUnavailable")));
    if (!client || !online)
      return Promise.reject(new Error(t("bots.chat.common.hostDisconnected")));
    setError(null);
    setResetting(true);
    const run = resetChat(client, chatId, chat)
      .then(() => refreshAfterSend(client, chatId, chat, setChat))
      .catch((e: unknown) => {
        setError(String(e));
        throw e;
      })
      .finally(() => {
        inFlight.current = null;
        setResetting(false);
      });
    inFlight.current = run;
    return run;
  }, [client, online, chat, chatId, setChat, setError, t]);
  return { startFreshSession, resetting };
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
  const { startFreshSession, resetting } = useStartFreshSession({
    client,
    online,
    chatId,
    chat,
    setChat,
    setError,
  });
  const send = useCallback(
    async (payload: MessagePayload) => {
      const { text } = payload;
      if (!chat) throw new Error(t("bots.chat.send.chatUnavailable"));
      if (payload.attachments.length > 0 && !attachmentsSupported)
        throw new Error(t("bots.chat.send.attachmentsNeedUpdate"));
      if (isFreshSessionCommand(payload)) return startFreshSession();
      setError(null);
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
    [
      client,
      online,
      chat,
      chatId,
      setChat,
      setError,
      attachmentsSupported,
      serverId,
      startFreshSession,
      t,
    ],
  );
  return { send, sending: resetting, startFreshSession };
}
