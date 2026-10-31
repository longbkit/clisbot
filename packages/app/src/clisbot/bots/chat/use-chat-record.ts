import { traceConversationPhase } from "@/performance/conversation-trace";
import { useEffect, useRef, useState } from "react";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { DaemonConnectionError, type DaemonClient } from "@clisbot/client/internal/daemon-client";
import { i18n } from "@/i18n/i18next";
import { useTranscriptStore } from "../data/transcript-store";
import type { AggregatedQueryResult } from "../data/use-aggregated-query";
import type { ChatPayload as CatalogChat } from "../data/contracts";

/** Only this admission's successful Host catalog may seed a newly mounted detail. */
export function acceptedChatRecord(
  catalog: AggregatedQueryResult<CatalogChat>,
  serverId: string,
  chatId: string,
): ChatPayload | null {
  if (
    catalog.isError ||
    catalog.loadState.status !== "loaded" ||
    !catalog.acceptedServerIds.includes(serverId) ||
    catalog.hostErrors.some((host) => host.serverId === serverId)
  )
    return null;
  const record = catalog.loadState.data.find(
    (chat) => chat.serverId === serverId && chat.id === chatId,
  )?.record;
  return record && !record.archivedAt ? record : null;
}

export function useChatRecord(
  client: DaemonClient | null,
  online: boolean,
  chatId: string,
  key: string,
  initialChat: ChatPayload | null = null,
  /** The record saved for offline use; shown until the Host answers for this chat. */
  offlineChat: ChatPayload | null = null,
) {
  // Presentation survives reconnect on the same client/principal. The key still identifies
  // each transport admission; stale responses cannot authorize the new admission.
  const [chat, setChat] = useState<ChatPayload | null>(() =>
    initialChat?.id === chatId ? initialChat : null,
  );
  const seeded = useRef(initialChat !== null);
  const [acceptedKey, setAcceptedKey] = useState(initialChat ? key : null);
  const [error, setError] = useState<string | null>(null);
  const [transportInterrupted, setTransportInterrupted] = useState(false);
  useEffect(() => {
    let active = true;
    let receivedUpdate = false;
    if (client && online) {
      traceConversationPhase("record.request", key, { seeded: String(seeded.current) });
      void client
        .listChats()
        .then((r) => {
          traceConversationPhase("record.response", key, {
            active: String(active),
            error: String(Boolean(r.error)),
          });
          if (!active || receivedUpdate) return undefined;
          setTransportInterrupted(false);
          if (r.error) {
            setChat(null);
            setAcceptedKey(null);
            setError(r.error);
            useTranscriptStore.getState().clear(key);
          } else {
            const current = r.chats.find((c) => c.id === chatId && !c.archivedAt) ?? null;
            setChat(current);
            setAcceptedKey(current ? key : null);
            if (!current) useTranscriptStore.getState().clear(key);
            setError(current ? null : i18n.t("bots.chat.record.unavailable"));
          }
          return undefined;
        })
        .catch((e) => {
          if (active && !receivedUpdate) {
            // Transport loss/timeout is not an authoritative removal. Keep the accepted
            // presentation; authentication, RPC and unknown errors still clear it.
            const transport = e instanceof DaemonConnectionError && !client.authFailureReason;
            setTransportInterrupted(transport);
            if (!transport) {
              setChat(null);
              setAcceptedKey(null);
            }
            setError(String(e));
          }
        });
    }
    const feed = online ? client?.observeEvents(["chat.updated"]) : undefined;
    feed?.subscribe({
      snapshot: () => {},
      update: (event) => {
        if (active && event.type === "chat.updated" && event.payload.chat.id === chatId) {
          // The fetch began before this push; never let its older snapshot replace a
          // newly bound agent session (or hide it with an older request failure).
          receivedUpdate = true;
          setTransportInterrupted(false);
          const current = event.payload.chat.archivedAt ? null : event.payload.chat;
          setChat(current);
          setAcceptedKey(current ? key : null);
          if (!current) useTranscriptStore.getState().clear(key);
          setError(current ? null : i18n.t("bots.chat.record.unavailable"));
        }
      },
    });
    return () => {
      active = false;
      void feed?.release().catch(() => undefined);
    };
  }, [chatId, client, online, key]);
  // Every refusal or removal sets an error; a transport failure does not answer for the chat.
  const hostAnswered = error !== null && !transportInterrupted;
  const showOffline = !hostAnswered && offlineChat?.id === chatId;
  return {
    chat: chat ?? (showOffline ? offlineChat : null),
    setChat,
    error,
    setError,
    transportInterrupted,
    authorized: online && acceptedKey === key && !client?.authFailureReason,
  };
}
