import { DaemonConnectionError } from "@clisbot/client/internal/daemon-client";
import { botsSessionScope, scopedTranscriptKey } from "./session-scope";
import { useCallback, useMemo, useState } from "react";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import type { BotsRuntime } from "./client";
import { fetchTranscriptPage, refreshChatTranscript } from "./transcript-refresh";
import { chatTranscriptQueryKey } from "./query-keys";
import { selectTranscript, useTranscriptStore, type ChatTranscript } from "./transcript-store";

export { TRANSCRIPT_PAGE_SIZE } from "./transcript-refresh";

export type ChatTranscriptLoadState =
  | { status: "connecting" }
  | { status: "loading" }
  | { status: "error"; message: string; retainAccepted?: boolean }
  | { status: "loaded" };

export interface UseChatTranscriptResult {
  transcript: ChatTranscript;
  loadState: ChatTranscriptLoadState;
  /** Fetches the page before the oldest held line; a no-op while one is in flight. */
  loadOlder: () => Promise<void>;
  isLoadingOlder: boolean;
}

/**
 * The initial tail and same-admission deltas through react-query (reload still revalidates),
 * merged into the transcript store, which `chat.transcript.appended` also feeds. Older pages
 * bypass the query: they only ever extend the store.
 */
export function useChatTranscriptQuery(input: {
  serverId: string;
  chatId: string;
  runtime: BotsRuntime;
}): UseChatTranscriptResult {
  const { serverId, chatId, runtime } = input;
  const snapshot = useHostRuntimeSnapshot(serverId);
  const key = scopedTranscriptKey(serverId, chatId, snapshot);
  const connectionStatus = snapshot?.connectionStatus ?? "connecting";
  const online = connectionStatus === "online";
  const transcript = useTranscriptStore(
    useCallback((state) => selectTranscript(state, key), [key]),
  );
  const query = useFetchQuery({
    queryKey: [
      ...chatTranscriptQueryKey(serverId, chatId),
      connectionStatus,
      botsSessionScope(snapshot),
    ],
    queryFn: () => refreshChatTranscript(runtime, { serverId, chatId, key }),
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
      const page = await fetchTranscriptPage(runtime, { serverId, chatId, beforeSeq: oldest.seq });
      useTranscriptStore.getState().prependOlder(key, page.messages, page.hasOlder);
    } finally {
      setLoadingOlder(false);
    }
  }, [chatId, isLoadingOlder, key, runtime, serverId]);
  const loadState = useMemo<ChatTranscriptLoadState>(() => {
    if (!online) return { status: "connecting" };
    if (query.isError)
      return {
        status: "error",
        message: toErrorMessage(query.error),
        // Only known transport failures may retain an already accepted page. RPC/auth,
        // protocol and unknown errors still hide the transcript, including on refresh.
        retainAccepted:
          query.error instanceof DaemonConnectionError &&
          query.error.code === "DAEMON_REQUEST_TIMEOUT" &&
          !snapshot?.authFailureReason &&
          query.data !== undefined,
      };
    return query.data ? { status: "loaded" } : { status: "loading" };
  }, [online, query.data, query.error, query.isError, snapshot?.authFailureReason]);
  return { transcript, loadState, loadOlder, isLoadingOlder };
}
