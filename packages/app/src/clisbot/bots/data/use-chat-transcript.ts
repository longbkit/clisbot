import { DaemonConnectionError } from "@clisbot/client/internal/daemon-client";
import { botsSessionScope, scopedTranscriptKey } from "./session-scope";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import type { BotsRuntime } from "./client";
import { fetchTranscriptPage, refreshChatTranscript } from "./transcript-refresh";
import { chatTranscriptQueryKey } from "./query-keys";
import { selectTranscript, useTranscriptStore, type ChatTranscript } from "./transcript-store";

const EMPTY_PRESENTATION: ChatTranscript = { messages: [], hasOlder: false };

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
  /** A request may be active while accepted content remains loaded. */
  isFetching: boolean;
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
  /** Presentation-only retention; query/store authority stays transport-scoped. */
  presentationScope?: string;
  /** An authoritative metadata removal revokes even the mounted presentation. */
  presentationAllowed?: boolean;
}): UseChatTranscriptResult {
  const { serverId, chatId, runtime } = input;
  const snapshot = useHostRuntimeSnapshot(serverId);
  const key = scopedTranscriptKey(serverId, chatId, snapshot);
  const connectionStatus = snapshot?.connectionStatus ?? "connecting";
  const online = connectionStatus === "online";
  const transcript = useTranscriptStore(
    useCallback((state) => selectTranscript(state, key), [key]),
  );
  const readPrincipal = useTranscriptStore(
    useCallback((state) => state.reads[key]?.principalScope, [key]),
  );
  const samePrincipal = readPrincipal === input.presentationScope;
  const query = useFetchQuery({
    queryKey: [
      ...chatTranscriptQueryKey(serverId, chatId),
      input.presentationScope,
      connectionStatus,
      botsSessionScope(snapshot),
    ],
    queryFn: () =>
      refreshChatTranscript(runtime, {
        serverId,
        chatId,
        key,
        principalScope: input.presentationScope,
      }),
    dataShape: "value",
    staleTimeMs: 0,
    enabled: online,
  });
  const owner = JSON.stringify([
    serverId,
    chatId,
    input.presentationScope,
    snapshot?.clientGeneration ?? 0,
  ]);
  const retained = useRef<{ owner: string; transcript: ChatTranscript } | null>(null);
  const recoverable = query.error instanceof DaemonConnectionError && !snapshot?.authFailureReason;
  const rejected = Boolean(snapshot?.authFailureReason) || (query.isError && !recoverable);
  const blocked = rejected || input.presentationAllowed === false;
  const previous =
    !blocked && retained.current?.owner === owner ? retained.current.transcript : undefined;
  const acceptedCurrent = query.data !== undefined && samePrincipal;
  // The offline tail paints until a page is accepted; a refusal below still hides it.
  const offlineTail = transcript.cached ? transcript : undefined;
  let presented = acceptedCurrent ? transcript : (previous ?? offlineTail ?? EMPTY_PRESENTATION);
  if (blocked) presented = EMPTY_PRESENTATION;
  useLayoutEffect(() => {
    if (blocked || retained.current?.owner !== owner) retained.current = null;
    if (rejected && useTranscriptStore.getState().transcripts[key])
      useTranscriptStore.getState().clear(key);
    if (!blocked && acceptedCurrent) retained.current = { owner, transcript };
  }, [acceptedCurrent, blocked, key, owner, rejected, transcript]);
  const [isLoadingOlder, setLoadingOlder] = useState(false);
  const loadOlder = useCallback(async () => {
    const current = selectTranscript(useTranscriptStore.getState(), key);
    const oldest = current.messages[0];
    if (blocked || !online || !acceptedCurrent || isLoadingOlder || !current.hasOlder || !oldest)
      return;
    setLoadingOlder(true);
    try {
      const page = await fetchTranscriptPage(runtime, { serverId, chatId, beforeSeq: oldest.seq });
      const latest = runtime.getSnapshot(serverId);
      const store = useTranscriptStore.getState();
      if (
        latest?.connectionStatus === "online" &&
        !latest.authFailureReason &&
        scopedTranscriptKey(serverId, chatId, latest) === key &&
        store.reads[key]?.principalScope === input.presentationScope
      )
        store.prependOlder(key, page.messages, page.hasOlder);
    } finally {
      setLoadingOlder(false);
    }
  }, [
    acceptedCurrent,
    blocked,
    chatId,
    isLoadingOlder,
    key,
    online,
    runtime,
    serverId,
    input.presentationScope,
  ]);
  const loadState = useMemo<ChatTranscriptLoadState>(() => {
    if (!online) return { status: "connecting" };
    if (query.isError)
      return {
        status: "error",
        message: toErrorMessage(query.error),
        // Only known transport failures may retain an already accepted page. RPC/auth,
        // protocol and unknown errors still hide the transcript, including on refresh.
        retainAccepted: recoverable && (acceptedCurrent || previous !== undefined),
      };
    return acceptedCurrent ? { status: "loaded" } : { status: "loading" };
  }, [acceptedCurrent, online, query.error, query.isError, recoverable, previous]);
  return {
    transcript: presented,
    loadState,
    loadOlder,
    isLoadingOlder,
    isFetching: query.isFetching,
  };
}
