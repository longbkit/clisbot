import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChatRenderRow } from "@/clisbot/bots/chat/render-model";
import { schedulesQueryBaseKey } from "@/schedules/aggregated-schedules";
import { heartbeatsByTurnLine } from "./chat-turn-heartbeats";
import { useHostHeartbeats } from "./use-heartbeats";

/**
 * The heartbeats a Chat's turns created, by reply line. The daemon pushes no schedule changes,
 * so each new bot line (a turn that may have made one, or a run that counted) refreshes them.
 */
export function useChatTurnHeartbeats(
  serverId: string,
  rows: readonly ChatRenderRow[],
): Map<string, string[]> {
  const queryClient = useQueryClient();
  const { heartbeats } = useHostHeartbeats(serverId);
  const settled = useSettledRows(rows);
  const newestBotLine = settled.findLast((row) => row.kind === "bot")?.key ?? null;
  useEffect(() => {
    if (newestBotLine) void queryClient.invalidateQueries({ queryKey: schedulesQueryBaseKey });
  }, [newestBotLine, queryClient]);
  return useMemo(() => heartbeatsByTurnLine(settled, heartbeats), [heartbeats, settled]);
}

/**
 * The transcript lines without the live rows, the same array while no line arrives, so a
 * streaming turn does not recompute every card.
 */
function useSettledRows(rows: readonly ChatRenderRow[]): readonly ChatRenderRow[] {
  const previous = useRef<readonly ChatRenderRow[]>([]);
  const settled = rows.filter((row) => row.kind !== "live");
  const same =
    settled.length === previous.current.length &&
    settled.every((row, index) => row === previous.current[index]);
  if (!same) previous.current = settled;
  return previous.current;
}
