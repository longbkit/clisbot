import { queryClient } from "@/data/query-client";
import { fetchQueryOptions } from "@/data/query";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { openTimelineFetch, planTimelineTailFetch } from "@/timeline/timeline-sync-plan";
import { botsRuntime } from "@/clisbot/bots/data/runtime";
import { chatTranscriptFetchInput } from "@/clisbot/bots/data/use-chat-transcript";
import { OFFLINE_CACHE_ENABLED } from "@/runtime/replica-cache/offline-flag";
import { createOpenPreloadScheduler } from "./scheduler";
import { createOpenPreloads, type AgentOpenTarget, type ChatOpenTarget } from "./targets";

/** The device tail first (cheap), then the same bounded tail the open itself asks for. */
async function loadAgent({ serverId, agentId }: AgentOpenTarget): Promise<void> {
  const runtime = getHostRuntimeStore();
  if (runtime.getSnapshot(serverId)?.connectionStatus !== "online") return;
  await runtime.prepareAgentTimeline(serverId, agentId);
  await runtime.fetchAgentTimeline(serverId, agentId, openTimelineFetch(planTimelineTailFetch()));
}

/** Fills the route's own transcript query, so its first render already holds the page. */
async function loadChat({ serverId, chatId, presentationScope }: ChatOpenTarget): Promise<void> {
  const snapshot = botsRuntime.getSnapshot(serverId);
  if (snapshot?.connectionStatus !== "online") return;
  const input = chatTranscriptFetchInput({
    serverId,
    chatId,
    runtime: botsRuntime,
    presentationScope,
    snapshot,
  });
  await queryClient.prefetchQuery(fetchQueryOptions(input));
}

async function skip(): Promise<void> {}

// Part of the O2 open path: `EXPO_PUBLIC_CLISBOT_OFFLINE_CACHE=0` turns preloading off too.
export const openPreloads = createOpenPreloads(
  createOpenPreloadScheduler({ maxConcurrent: 2, freshMs: 30_000, now: Date.now }),
  OFFLINE_CACHE_ENABLED ? { loadAgent, loadChat } : { loadAgent: skip, loadChat: skip },
);
