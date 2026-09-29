import { useEffect, useState } from "react";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
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
    let receivedUpdate = false;
    if (client && online)
      void client
        .listChats()
        .then((r) => {
          if (!active || receivedUpdate) return undefined;
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
          if (active && !receivedUpdate) {
            setChat(null);
            setError(String(e));
          }
        });
    const feed = online ? client?.observeEvents(["chat.updated"]) : undefined;
    feed?.subscribe({
      snapshot: () => {},
      update: (event) => {
        if (active && event.type === "chat.updated" && event.payload.chat.id === chatId) {
          // The fetch began before this push; never let its older snapshot replace a
          // newly bound agent session (or hide it with an older request failure).
          receivedUpdate = true;
          setChat(event.payload.chat);
          setError(null);
        }
      },
    });
    return () => {
      active = false;
      void feed?.release().catch(() => undefined);
    };
  }, [chatId, client, online, key]);
  return { chat, setChat, error, setError };
}
