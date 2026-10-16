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
) {
  // The route is keyed by Host/chat/client generation/connection epoch. Reuse only the
  // current catalog's accepted record; the existing RPC/push owner still revalidates it.
  const [chat, setChat] = useState<ChatPayload | null>(() =>
    initialChat?.id === chatId ? initialChat : null,
  );
  const seeded = useRef(initialChat !== null);
  const [error, setError] = useState<string | null>(null);
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
          if (r.error) {
            setChat(null);
            setError(r.error);
            useTranscriptStore.getState().clear(key);
          } else {
            setChat(r.chats.find((c) => c.id === chatId) ?? null);
            if (!r.chats.some((c) => c.id === chatId)) useTranscriptStore.getState().clear(key);
            setError(
              r.chats.some((c) => c.id === chatId) ? null : i18n.t("bots.chat.record.unavailable"),
            );
          }
          return undefined;
        })
        .catch((e) => {
          if (active && !receivedUpdate) {
            // A request timeout on a non-rejected client is not an authoritative removal. Keep accepted
            // metadata within this admission; all other failures remain fail-closed.
            if (
              !(e instanceof DaemonConnectionError) ||
              e.code !== "DAEMON_REQUEST_TIMEOUT" ||
              client.authFailureReason
            )
              setChat(null);
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
