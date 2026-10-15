import type { StreamItem } from "@/types/stream";
import { startsNewTurn } from "@/agent-stream/turn-membership";
import type { HeartbeatRun } from "@clisbot/protocol/schedule/heartbeat-notice";

export interface TurnTiming {
  completedAt: Date;
  durationMs: number | null;
  heartbeatRun?: HeartbeatRun;
}

export interface StreamTurnTiming {
  byAssistantId: Map<string, TurnTiming>;
  runningStartedAt: Date | null;
  runningHeartbeatRun?: HeartbeatRun;
}

export function deriveStreamTurnTiming(params: {
  isTurnActive: boolean;
  activeTurnStartedAt: Date | null;
  tail: StreamItem[];
  head: StreamItem[];
}): StreamTurnTiming {
  const byAssistantId = new Map<string, TurnTiming>();
  let currentUserAt: Date | null = null;
  let currentLastItemAt: Date | null = null;
  let currentAssistantIds: string[] = [];
  let previousItem: StreamItem | null = null;
  const runsByTurn = new Map<string, HeartbeatRun>();
  const rememberRun = (item: StreamItem) => {
    if (item.kind === "notification" && item.heartbeatRun && item.turnId)
      runsByTurn.set(item.turnId, item.heartbeatRun);
  };
  params.tail.forEach(rememberRun);
  params.head.forEach(rememberRun);

  const flushCompletedTurn = () => {
    if (!currentLastItemAt || currentAssistantIds.length === 0) {
      return;
    }
    const timing: TurnTiming = {
      completedAt: currentLastItemAt,
      durationMs: currentUserAt
        ? Math.max(0, currentLastItemAt.getTime() - currentUserAt.getTime())
        : null,
      ...(previousItem?.turnId && runsByTurn.has(previousItem.turnId)
        ? { heartbeatRun: runsByTurn.get(previousItem.turnId) }
        : {}),
    };
    for (const id of currentAssistantIds) {
      byAssistantId.set(id, timing);
    }
  };

  const visitItem = (item: StreamItem) => {
    if (startsNewTurn(item, previousItem)) {
      flushCompletedTurn();
      currentUserAt =
        item.kind === "user_message" ||
        (item.kind === "notification" && item.heartbeatRun && item.turnId)
          ? item.timestamp
          : null;
      currentLastItemAt = null;
      currentAssistantIds = [];
    }
    currentLastItemAt = item.timestamp;
    if (item.kind === "assistant_message") {
      currentAssistantIds.push(item.id);
    }
    previousItem = item;
  };

  for (const item of params.tail) {
    visitItem(item);
  }
  for (const item of params.head) {
    visitItem(item);
  }

  const runningStartedAt = params.isTurnActive ? params.activeTurnStartedAt : null;
  const lastTurnId = (params.head.at(-1) ?? params.tail.at(-1))?.turnId;
  if (!params.isTurnActive) {
    flushCompletedTurn();
  }

  return {
    byAssistantId,
    runningStartedAt,
    ...(params.isTurnActive && lastTurnId
      ? { runningHeartbeatRun: runsByTurn.get(lastTurnId) }
      : {}),
  };
}
