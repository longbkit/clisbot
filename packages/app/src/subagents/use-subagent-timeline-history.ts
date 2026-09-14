import { useCallback, useEffect, useMemo, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { providerSubagentKey, useProviderSubagentStore } from "@/subagents/provider-store";
import type { TimelineCursor } from "@/timeline/session-stream-reducers";
import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";

type SubagentHistoryClient = Pick<
  DaemonClient,
  "fetchProviderSubagentTimeline" | "getConnectionState" | "subscribeConnectionStatus"
>;

export interface SubagentTimelineHistory {
  historyError: string | null;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  progressKey: string | null;
  onLoadOlder: () => boolean;
}

function fetchTimelinePage(
  client: SubagentHistoryClient,
  target: { parentAgentId: string; subagentId: string },
  page: { resume: { epoch: string; seq: number } | null; readable: boolean; signal: AbortSignal },
) {
  return client.fetchProviderSubagentTimeline(target.parentAgentId, target.subagentId, {
    direction: page.resume ? "after" : "tail",
    ...(page.resume ? { cursor: page.resume } : {}),
    ...(page.readable ? { pagingMode: "source_ranges" as const } : {}),
    limit: TIMELINE_FETCH_PAGE_SIZE,
    signal: page.signal,
  });
}

function historyMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load history";
}

/**
 * A host that keeps reporting `hasNewer` without moving the cursor would spin the follow loop
 * forever, so a non-advancing page is an error rather than another round trip.
 */
function assertHistoryAdvanced(
  before: TimelineCursor | null | undefined,
  after: TimelineCursor | null | undefined,
): void {
  if (before?.epoch === after?.epoch && before?.endSeq === after?.endSeq)
    throw new Error("Subagent history did not advance");
}

function firstLoadedSeq(timeline: { cursor?: TimelineCursor | null; rows: Map<number, unknown> }) {
  if (timeline.cursor?.startSeq !== undefined) return timeline.cursor.startSeq;
  return timeline.rows.size ? Math.min(...timeline.rows.keys()) : null;
}

/**
 * Follows a provider subagent's timeline: drains newer pages while the socket is up, and pages
 * backwards on demand. Lives outside the panel so the paging loop is testable on its own and the
 * component stays a render function.
 */
export function useSubagentTimelineHistory(input: {
  client: SubagentHistoryClient | null;
  serverId: string;
  parentAgentId: string;
  subagentId: string;
  supported: boolean;
  readable: boolean;
  isActive: boolean;
}): SubagentTimelineHistory {
  const { client, serverId, parentAgentId, subagentId, supported, readable, isActive } = input;
  const key = providerSubagentKey(serverId, parentAgentId, subagentId);
  const timeline = useProviderSubagentStore((state) => state.timelines.get(key) ?? null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  useEffect(() => {
    if (!client || !supported || !isActive) return;
    const state = {
      canceled: false,
      running: false,
      connected: client.getConnectionState().status === "connected",
    };
    let controller: AbortController | null = null;
    const readCursor = () => useProviderSubagentStore.getState().timelines.get(key)?.cursor;
    // Read through a call so the loop condition tracks the flags the subscriptions mutate.
    const shouldContinue = () => !state.canceled && state.connected;

    const load = async (tail: boolean) => {
      if (state.running || !shouldContinue()) return;
      state.running = true;
      setHistoryError(null);
      try {
        let fromTail = tail;
        do {
          const before = readCursor();
          const resume = fromTail || !before ? null : { epoch: before.epoch, seq: before.endSeq };
          controller = new AbortController();
          const payload = await fetchTimelinePage(
            client,
            { parentAgentId, subagentId },
            { resume, readable, signal: controller.signal },
          );
          if (state.canceled || controller.signal.aborted) return;
          useProviderSubagentStore.getState().replaceTimeline(serverId, payload);
          const after = useProviderSubagentStore.getState().timelines.get(key);
          if (!after?.hasNewer) break;
          if (resume) assertHistoryAdvanced(before, after.cursor);
          fromTail = false;
        } while (shouldContinue());
      } catch (error) {
        if (!state.canceled && controller?.signal.aborted !== true)
          setHistoryError(historyMessage(error));
      } finally {
        state.running = false;
        if (shouldContinue() && controller?.signal.aborted === true) void load(true);
      }
    };

    const unsubscribe = useProviderSubagentStore.subscribe((next, previous) => {
      const current = next.timelines.get(key);
      if (current?.hasNewer && current !== previous.timelines.get(key)) void load(false);
    });
    const unsubscribeConnection = client.subscribeConnectionStatus((next) => {
      const wasConnected = state.connected;
      state.connected = next.status === "connected";
      if (!state.connected) controller?.abort();
      else if (!wasConnected) void load(true);
    });
    void load(true);
    return () => {
      state.canceled = true;
      controller?.abort();
      unsubscribe();
      unsubscribeConnection();
    };
  }, [client, serverId, key, supported, readable, isActive, parentAgentId, subagentId]);

  const onLoadOlder = useCallback((): boolean => {
    if (!client || !supported || isLoadingOlder || !timeline?.hasOlder || !timeline.epoch)
      return false;
    const firstSeq = firstLoadedSeq(timeline);
    if (firstSeq === null) return false;
    setIsLoadingOlder(true);
    setHistoryError(null);
    void client
      .fetchProviderSubagentTimeline(parentAgentId, subagentId, {
        direction: "before",
        ...(readable ? { pagingMode: "source_ranges" as const } : {}),
        cursor: { epoch: timeline.epoch, seq: firstSeq },
        limit: TIMELINE_FETCH_PAGE_SIZE,
      })
      .then((payload) => {
        useProviderSubagentStore.getState().replaceTimeline(serverId, payload);
        return undefined;
      })
      .catch((error: unknown) => setHistoryError(historyMessage(error)))
      .finally(() => setIsLoadingOlder(false));
    return true;
  }, [client, readable, isLoadingOlder, serverId, supported, parentAgentId, subagentId, timeline]);

  const firstSeq = timeline ? firstLoadedSeq(timeline) : null;
  const progressKey = timeline?.epoch && firstSeq !== null ? `${timeline.epoch}:${firstSeq}` : null;
  return useMemo(
    () => ({
      historyError,
      hasOlder: timeline?.hasOlder === true,
      isLoadingOlder,
      progressKey,
      onLoadOlder,
    }),
    [historyError, isLoadingOlder, onLoadOlder, progressKey, timeline?.hasOlder],
  );
}
