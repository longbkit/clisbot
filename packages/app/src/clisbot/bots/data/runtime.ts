import { scopedTranscriptKey } from "./session-scope";
import { useEffect, useMemo } from "react";
import { getHostRuntimeStore, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import { queryClient } from "@/data/query-client";
import { useBotsFeatureHosts } from "../feature";
import type { BotsRuntime } from "./client";
import { botView, chatView, messageView } from "./contracts";
import { useBotsQuery } from "./use-bots";
import { useChatsQuery } from "./use-chats";
import { useTranscriptStore } from "./transcript-store";

export const botsRuntime: BotsRuntime = {
  getSnapshot: (id) => getHostRuntimeStore().getSnapshot(id),
  getClient(id) {
    const client = getHostRuntimeStore().getClient(id);
    if (!client) return null;
    return {
      async botList() {
        const r = await client.listBots();
        return { bots: r.bots.map(botView), error: r.error ?? undefined };
      },
      async chatList() {
        const r = await client.listChats();
        return { chats: r.chats.map(chatView), error: r.error ?? undefined };
      },
      async chatTranscriptFetch({ chatId, beforeSeq, limit }) {
        const r = await client.fetchChatTranscript({
          chatId,
          direction: beforeSeq === undefined ? "tail" : "before",
          cursor: beforeSeq === undefined ? undefined : { seq: beforeSeq },
          limit,
        });
        return {
          messages: r.lines.map(messageView),
          hasOlder: r.hasOlder,
          error: r.error ?? undefined,
        };
      },
    };
  },
};
export function refreshBotsAndChats() {
  void queryClient.invalidateQueries({ queryKey: ["bots"] });
  void queryClient.invalidateQueries({ queryKey: ["chats"] });
}
export function useBotCatalog() {
  const featureHosts = useBotsFeatureHosts();
  const hosts = useMemo(
    () => featureHosts.map((h) => ({ serverId: h.serverId, serverName: h.label })),
    [featureHosts],
  );
  const bots = useBotsQuery({ hosts, runtime: botsRuntime });
  const chats = useChatsQuery({ hosts, runtime: botsRuntime });
  const ids = useMemo(() => hosts.map((h) => h.serverId), [hosts]);
  const statuses = useHostRuntimeConnectionStatuses(ids);
  const connectionKey = ids
    .map(
      (id) =>
        `${id}:${statuses.get(id)}:${getHostRuntimeStore().getSnapshot(id)?.clientGeneration ?? 0}:${getHostRuntimeStore().getSnapshot(id)?.connectionEpoch ?? 0}`,
    )
    .join("|");
  useEffect(() => {
    if (!connectionKey) return;
    const cleanups = ids.flatMap((serverId) => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) return [];
      const admittedSnapshot = getHostRuntimeStore().getSnapshot(serverId);
      const feed = client.observeEvents([
        "bot.updated",
        "chat.updated",
        "chat.transcript.appended",
      ]);
      feed.subscribe({
        snapshot: () => {
          refreshBotsAndChats();
          void queryClient.invalidateQueries({ queryKey: ["chat-transcript"] });
        },
        update: (event) => {
          if (event.type === "chat.transcript.appended") {
            useTranscriptStore
              .getState()
              .append(
                scopedTranscriptKey(serverId, event.payload.chatId, admittedSnapshot),
                messageView(event.payload.line),
              );
            void queryClient.invalidateQueries({ queryKey: ["chats"] });
          } else if (event.type === "chat.updated" || event.type === "bot.updated")
            refreshBotsAndChats();
        },
      });
      return [
        () => {
          void feed.release().catch(() => undefined);
        },
      ];
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [ids, connectionKey]);
  return { hosts: featureHosts, bots, chats };
}
