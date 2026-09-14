import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { processTimelineResponse, type TimelineCursor } from "@/timeline/session-stream-reducers";
import type { ProviderSubagentTimelineState } from "./provider-store";

export type ProviderSubagentTimelinePage = Extract<
  SessionOutboundMessage,
  {
    type: "agent.provider_subagents.timeline.get.response";
  }
>["payload"];

/** Subagent pages share main-timeline projection, coverage and context reconciliation. */
/** Adapts a subagent page onto the shared timeline-response reducer input. */
function projectedResponseInput(
  current: ProviderSubagentTimelineState | undefined,
  page: ProviderSubagentTimelinePage,
): Parameters<typeof processTimelineResponse>[0] {
  return {
    payload: {
      agentId: page.parentAgentId,
      projection: "projected",
      pagingMode: "source_ranges",
      direction: page.direction,
      reset: page.reset,
      epoch: page.epoch,
      window: page.window,
      startCursor: page.startCursor ?? null,
      endCursor: page.endCursor ?? null,
      entries: page.entries ?? [],
      contextEntries: page.contextEntries,
      hasOlder: page.hasOlder,
      hasNewer: page.hasNewer,
      error: page.error,
    },
    currentTail: current?.tail ?? [],
    currentHead: current?.head ?? [],
    currentCursor: current?.cursor ?? undefined,
    isInitializing: !current?.cursor,
    hasActiveInitDeferred: !current?.cursor,
    initRequestDirection: "tail",
    sendingClientMessageIds: [],
  };
}

export function applyProjectedSubagentPage(
  current: ProviderSubagentTimelineState | undefined,
  page: ProviderSubagentTimelinePage,
): ProviderSubagentTimelineState {
  const result = processTimelineResponse(projectedResponseInput(current, page));
  if (result.error) throw new Error(result.error);
  const cursor: TimelineCursor | null = result.cursor ?? null;
  const observed = current?.latestObserved;
  const stillBehind = Boolean(
    observed && (!cursor || observed.epoch !== cursor.epoch || observed.seq > cursor.endSeq),
  );
  return {
    ...(stillBehind ? { latestObserved: observed } : {}),
    tail: result.tail,
    head: result.head,
    rows: new Map(),
    pagingMode: "source_ranges",
    historyReady: true,
    epoch: page.epoch,
    cursor,
    lastSeq: cursor?.endSeq ?? 0,
    hasOlder:
      result.older === "unchanged"
        ? (current?.hasOlder ?? page.hasOlder)
        : result.older === "available",
    hasNewer: page.hasNewer || stillBehind,
  };
}
