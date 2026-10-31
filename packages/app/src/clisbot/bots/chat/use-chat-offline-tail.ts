import { useEffect, useState } from "react";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { offlineT } from "@/i18n/offline";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { CachedChatTail } from "@/runtime/replica-cache/chat-tail";
import { OFFLINE_CACHE_ENABLED } from "@/runtime/replica-cache/offline-flag";
import type { ChatMessage } from "../data/contracts";
import { useTranscriptStore, type ChatTranscript } from "../data/transcript-store";
import type { UseChatTranscriptResult } from "../data/use-chat-transcript";

/** The saved tail as the transcript shows it: each image left on the Host is a placeholder. */
export function offlineChatTranscript(
  tail: CachedChatTail,
  imagePlaceholder: string,
): ChatTranscript {
  const messages = tail.messages.map(({ offlineImageCount, ...message }): ChatMessage => {
    if (!offlineImageCount) return message;
    const images = Array.from({ length: offlineImageCount }, () => imagePlaceholder).join(" ");
    return { ...message, text: message.text ? `${message.text}\n\n${images}` : images };
  });
  return { messages, hasOlder: tail.hasOlder };
}

/**
 * Paints the chat's saved tail before the Host answers: the transcript lines into the store and
 * the record for the route. Returns the saved record; it authorizes nothing.
 */
export function useOfflineChatTail(serverId: string, chatId: string, key: string) {
  const [offlineChat, setOfflineChat] = useState<ChatPayload | null>(null);
  useEffect(() => {
    if (!OFFLINE_CACHE_ENABLED) return;
    let active = true;
    void getHostRuntimeStore()
      .getReplicaCache()
      .readChatTail(serverId, chatId)
      .then((tail) => {
        if (!active || !tail) return undefined;
        useTranscriptStore
          .getState()
          .hydrateCached(key, offlineChatTranscript(tail, offlineT("chat.image")));
        setOfflineChat(tail.chat);
        return undefined;
      });
    return () => {
      active = false;
    };
  }, [serverId, chatId, key]);
  return offlineChat;
}

/** Saves the accepted record and transcript, so the next open paints without waiting. */
export function useSaveChatTail(input: {
  serverId: string;
  chatId: string;
  chat: ChatPayload | null;
  authorized: boolean;
  transcript: UseChatTranscriptResult;
}): void {
  const { serverId, chatId, chat, authorized } = input;
  const { transcript, loadState } = input.transcript;
  const accepted = authorized && loadState.status === "loaded" && !transcript.cached;
  useEffect(() => {
    if (!OFFLINE_CACHE_ENABLED || !accepted || !chat) return;
    getHostRuntimeStore().getReplicaCache().commitChatTail(serverId, chatId, {
      chat,
      messages: transcript.messages,
      hasOlder: transcript.hasOlder,
    });
  }, [accepted, chat, chatId, serverId, transcript]);
}
