import { createCatalogEventFeeds } from "./catalog-event-feeds";
import { traceConversationFetch } from "@/performance/conversation-trace";
import { botsSessionScope, scopedTranscriptKey } from "./session-scope";
import { useEffect, useMemo, useRef } from "react";
import { getHostRuntimeStore, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import { queryClient } from "@/data/query-client";
import { useBotsFeatureHosts } from "../feature";
import type { BotsRuntime } from "./client";
import { botView, chatView, messageView } from "./contracts";
import { useBotsQuery } from "./use-bots";
import { useChatsQuery } from "./use-chats";
import { useTranscriptStore } from "./transcript-store";
import { chatTranscriptQueryBaseKey } from "./query-keys";

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
      async chatTranscriptFetch({ chatId, beforeSeq, afterSeq, limit }) {
        let direction: "before" | "after" | "tail" = "tail";
        let cursor: { seq: number } | undefined;
        if (beforeSeq !== undefined) {
          direction = "before";
          cursor = { seq: beforeSeq };
        } else if (afterSeq !== undefined) {
          direction = "after";
          cursor = { seq: afterSeq };
        }
        const traceResponse = traceConversationFetch(
          scopedTranscriptKey(id, chatId, getHostRuntimeStore().getSnapshot(id)),
          direction,
        );
        const r = await client.fetchChatTranscript({
          chatId,
          direction,
          cursor,
          limit,
        });
        traceResponse?.(r);
        return {
          messages: r.lines.map(messageView),
          hasOlder: r.hasOlder,
          hasNewer: r.hasNewer,
          error: r.error ?? undefined,
        };
      },
    };
  },
};
export function refreshBotsAndChats() {
  void refreshBotsAndChatsNow();
}
/** Resolves once the active bot and chat queries have refetched. */
export async function refreshBotsAndChatsNow(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["bots"] }),
    queryClient.invalidateQueries({ queryKey: ["chats"] }),
  ]);
}
const retainCatalogEvents = createCatalogEventFeeds();

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
  // Each Host's admission on its own: another Host's connection state must not restart this
  // Host's feed. A restart reconciles from a snapshot, which refetches every open transcript.
  useHostCatalogFeeds(ids.map((id) => [id, `${statuses.get(id)}:${admissionOf(id)}`] as const));
  return { hosts: featureHosts, bots, chats, connectionStatuses: statuses };
}

function admissionOf(serverId: string): string {
  const snapshot = getHostRuntimeStore().getSnapshot(serverId);
  return `${snapshot?.clientGeneration ?? 0}:${snapshot?.connectionEpoch ?? 0}`;
}

type HeldFeeds = Map<string, { key: string; release: () => void }>;

/**
 * Brings the held feeds to the wanted Hosts: a Host whose key is unchanged keeps its feed, a
 * changed or departed one is released, a new one is retained.
 */
export function reconcileHostFeeds(
  feeds: HeldFeeds,
  wanted: ReadonlyMap<string, string>,
  retain: (serverId: string) => (() => void) | null,
): void {
  for (const [serverId, feed] of feeds)
    if (wanted.get(serverId) !== feed.key) {
      feed.release();
      feeds.delete(serverId);
    }
  for (const [serverId, key] of wanted) {
    if (feeds.has(serverId)) continue;
    const release = retain(serverId);
    if (release) feeds.set(serverId, { key, release });
  }
}

/** One catalog event feed per Host, kept while that Host's own key is unchanged. */
function useHostCatalogFeeds(hostKeys: readonly (readonly [string, string])[]) {
  const held = useRef<HeldFeeds>(new Map());
  const joined = JSON.stringify(hostKeys);
  useEffect(() => {
    reconcileHostFeeds(
      held.current,
      new Map(JSON.parse(joined) as [string, string][]),
      retainHostFeed,
    );
  }, [joined]);
  useEffect(() => {
    const feeds = held.current;
    return () => {
      for (const feed of feeds.values()) feed.release();
      feeds.clear();
    };
  }, []);
}

function retainHostFeed(serverId: string): (() => void) | null {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) return null;
  const admittedSnapshot = getHostRuntimeStore().getSnapshot(serverId);
  const admission = `${serverId}:${botsSessionScope(admittedSnapshot)}`;
  return retainCatalogEvents(
    client,
    admission,
    () => {
      const store = getHostRuntimeStore();
      const current = store.getSnapshot(serverId);
      return (
        store.getClient(serverId) === client &&
        current?.connectionStatus === "online" &&
        botsSessionScope(current) === botsSessionScope(admittedSnapshot)
      );
    },
    {
      snapshot: () => {
        refreshBotsAndChats();
        // Only this Host's transcripts: the snapshot says nothing about another Host's chats.
        void queryClient.invalidateQueries({
          queryKey: [...chatTranscriptQueryBaseKey, serverId],
        });
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
    },
  );
}
