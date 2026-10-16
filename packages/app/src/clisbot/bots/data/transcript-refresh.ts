import { i18n } from "@/i18n/i18next";
import { traceConversationPhase } from "@/performance/conversation-trace";
import type { BotsRuntime } from "./client";
import type { ChatTranscriptPage } from "./contracts";
import { scopedTranscriptKey } from "./session-scope";
import { selectTranscript, useTranscriptStore } from "./transcript-store";

export const TRANSCRIPT_PAGE_SIZE = 50;

export async function fetchTranscriptPage(
  runtime: BotsRuntime,
  input: { serverId: string; chatId: string; beforeSeq?: number; afterSeq?: number },
): Promise<ChatTranscriptPage> {
  const client = runtime.getClient(input.serverId);
  if (!client) throw new Error(i18n.t("bots.workspace.errors.hostNotConnected"));
  const page = await client.chatTranscriptFetch({
    chatId: input.chatId,
    beforeSeq: input.beforeSeq,
    afterSeq: input.afterSeq,
    limit: TRANSCRIPT_PAGE_SIZE,
  });
  if (page.error) throw new Error(page.error);
  return page;
}

/** A refresh still checks authority. Only a confirmed contiguous append-only window uses a delta. */
export async function refreshChatTranscript(
  runtime: BotsRuntime,
  input: { serverId: string; chatId: string; key: string },
) {
  const { serverId, chatId, key } = input;
  const currentAdmission = () => {
    const snapshot = runtime.getSnapshot(serverId);
    return (
      snapshot?.connectionStatus === "online" &&
      !snapshot.authFailureReason &&
      scopedTranscriptKey(serverId, chatId, snapshot) === key
    );
  };
  if (!currentAdmission()) throw new Error(i18n.t("bots.workspace.errors.hostNotConnected"));
  const store = useTranscriptStore.getState();
  const read = store.beginRead(key);
  traceConversationPhase("transcript.request", key, {
    direction: read.afterSeq === undefined ? "tail" : "after",
  });
  let page = await fetchTranscriptPage(runtime, { serverId, chatId, afterSeq: read.afterSeq });
  if (!currentAdmission() || !store.acceptsRead(key, read))
    return selectTranscript(useTranscriptStore.getState(), key);
  let delta = read.afterSeq !== undefined;
  if (
    delta &&
    (page.hasNewer !== false ||
      page.messages.some((line, index) => line.seq !== read.afterSeq! + index + 1))
  ) {
    // A disjoint tail is not a contiguous delta. Keep the existing bounded reload contract:
    // at most one additional tail page, with truthful hasOlder, instead of draining a backlog.
    traceConversationPhase("transcript.request", key, { direction: "tail-fallback" });
    page = await fetchTranscriptPage(runtime, { serverId, chatId });
    delta = false;
  }
  traceConversationPhase("transcript.response", key, { rows: String(page.messages.length) });
  if (currentAdmission()) store.acceptRead(key, read, page, delta);
  return selectTranscript(useTranscriptStore.getState(), key);
}
