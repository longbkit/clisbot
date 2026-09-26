import { useMemo } from "react";
import type { BotsClient, BotsHostInput, BotsRuntime } from "./client";
import type { ChatPayload } from "./contracts";
import { chatsQueryKey } from "./query-keys";
import { useAggregatedQuery, type AggregatedQueryResult } from "./use-aggregated-query";

export const ALL_CHAT_HOSTS_FAILED_MESSAGE = "No connected hosts could load chats";

export type AggregatedChat = ChatPayload & { serverId: string; serverName: string };

async function loadChats(client: BotsClient) {
  const payload = await client.chatList();
  return { rows: payload.chats, error: payload.error };
}

/** Newest first, across hosts, so the sidebar's "recent chats" is one slice. */
export function sortChatsNewestFirst<T extends ChatPayload>(chats: readonly T[]): T[] {
  return [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function useChatsQuery(input: {
  hosts: readonly BotsHostInput[];
  runtime: BotsRuntime;
}): AggregatedQueryResult<ChatPayload> {
  const result = useAggregatedQuery({
    hosts: input.hosts,
    runtime: input.runtime,
    queryKey: chatsQueryKey(input.hosts.map((host) => host.serverId)),
    load: loadChats,
    allHostsFailedMessage: ALL_CHAT_HOSTS_FAILED_MESSAGE,
    enabled: input.hosts.length > 0,
  });
  const loadState = useMemo<AggregatedQueryResult<ChatPayload>["loadState"]>(
    () =>
      result.loadState.status === "loaded"
        ? { status: "loaded", data: sortChatsNewestFirst(result.loadState.data) }
        : result.loadState,
    [result.loadState],
  );
  return { ...result, loadState };
}
