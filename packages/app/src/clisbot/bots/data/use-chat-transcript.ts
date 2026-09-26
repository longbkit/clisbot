import { useCallback, useMemo, useState } from "react";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import type { BotsRuntime } from "./client";
import type { ChatTranscriptPage } from "./contracts";
import { chatTranscriptQueryKey } from "./query-keys";
import {
  selectTranscript,
  transcriptKey,
  useTranscriptStore,
  type ChatTranscript,
} from "./transcript-store";

export const TRANSCRIPT_PAGE_SIZE = 50;

export type ChatTranscriptLoadState =
  | { status: "connecting" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded" };

export interface UseChatTranscriptResult {
  transcript: ChatTranscript;
  loadState: ChatTranscriptLoadState;
  /** Fetches the page before the oldest held line; a no-op while one is in flight. */
  loadOlder: () => Promise<void>;
  isLoadingOlder: boolean;
}

async function fetchPage(
  runtime: BotsRuntime,
  input: { serverId: string; chatId: string; beforeSeq?: number },
): Promise<ChatTranscriptPage> {
  const client = runtime.getClient(input.serverId);
  if (!client) throw new Error("Host is not connected");
  const page = await client.chatTranscriptFetch({
    chatId: input.chatId,
    beforeSeq: input.beforeSeq,
    limit: TRANSCRIPT_PAGE_SIZE,
  });
  if (page.error) throw new Error(page.error);
  return { messages: page.messages, hasOlder: page.hasOlder };
}

/**
 * The newest transcript page through react-query (so a reload refetches), merged into the
 * transcript store, which `chat.transcript.appended` also feeds. Older pages bypass the query:
 * they only ever extend the store.
 */
export function useChatTranscriptQuery(input: {
  serverId: string;
  chatId: string;
  runtime: BotsRuntime;
}): UseChatTranscriptResult {
  const { serverId, chatId, runtime } = input;
  const key = transcriptKey(serverId, chatId);
  const connectionStatus = useHostRuntimeConnectionStatus(serverId);
  const online = connectionStatus === "online";
  const transcript = useTranscriptStore(
    useCallback((state) => selectTranscript(state, key), [key]),
  );
  const query = useFetchQuery({
    queryKey: [...chatTranscriptQueryKey(serverId, chatId), connectionStatus],
    queryFn: async () => {
      const page = await fetchPage(runtime, { serverId, chatId });
      useTranscriptStore.getState().replacePage(key, page);
      return page;
    },
    dataShape: "value",
    staleTimeMs: 0,
    enabled: online,
  });
  const [isLoadingOlder, setLoadingOlder] = useState(false);
  const loadOlder = useCallback(async () => {
    const current = selectTranscript(useTranscriptStore.getState(), key);
    const oldest = current.messages[0];
    if (isLoadingOlder || !current.hasOlder || !oldest) return;
    setLoadingOlder(true);
    try {
      const page = await fetchPage(runtime, { serverId, chatId, beforeSeq: oldest.seq });
      useTranscriptStore.getState().prependOlder(key, page.messages, page.hasOlder);
    } finally {
      setLoadingOlder(false);
    }
  }, [chatId, isLoadingOlder, key, runtime, serverId]);
  const loadState = useMemo<ChatTranscriptLoadState>(() => {
    if (!online) return { status: "connecting" };
    if (query.isError) return { status: "error", message: toErrorMessage(query.error) };
    return query.data ? { status: "loaded" } : { status: "loading" };
  }, [online, query.data, query.error, query.isError]);
  return { transcript, loadState, loadOlder, isLoadingOlder };
}
