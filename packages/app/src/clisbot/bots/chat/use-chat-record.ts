import { useEffect, useState } from "react";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useTranscriptStore } from "../data/transcript-store";
export function useChatRecord(
  client: DaemonClient | null,
  online: boolean,
  chatId: string,
  key: string,
) {
  const [chat, setChat] = useState<ChatPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (client && online)
      void client
        .listChats()
        .then((r) => {
          if (!active) return undefined;
          if (r.error) {
            setChat(null);
            setError(r.error);
            useTranscriptStore.getState().clear(key);
          } else {
            setChat(r.chats.find((c) => c.id === chatId) ?? null);
            if (!r.chats.some((c) => c.id === chatId)) useTranscriptStore.getState().clear(key);
            setError(r.chats.some((c) => c.id === chatId) ? null : "Chat is no longer available");
          }
          return undefined;
        })
        .catch((e) => {
          if (active) {
            setChat(null);
            setError(String(e));
          }
        });
    const feed = online ? client?.observeEvents(["chat.updated"]) : undefined;
    feed?.subscribe({
      snapshot: () => {},
      update: (event) => {
        if (event.type === "chat.updated" && event.payload.chat.id === chatId)
          setChat(event.payload.chat);
      },
    });
    return () => {
      active = false;
      void feed?.release().catch(() => undefined);
    };
  }, [chatId, client, online, key]);
  return { chat, setChat, error, setError };
}
