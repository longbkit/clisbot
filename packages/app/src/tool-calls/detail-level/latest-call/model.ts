import type { ToolCallItem } from "@/types/stream";
import { describeToolCall, type ToolCallRun } from "../grouping";

export interface LatestCallToolCallGroup {
  mode: "summary-with-latest-call";
  run: ToolCallRun;
  /** The newest tool call; runs also fold reasoning, and a run of only reasoning has none. */
  latestToolCall: ToolCallItem | null;
  toolCallCount: number;
  isLoading: boolean;
  failedCount: number;
}

export function buildLatestCallGroup(run: ToolCallRun): LatestCallToolCallGroup {
  let isLoading = false;
  let failedCount = 0;
  let toolCallCount = 0;
  let latestToolCall: ToolCallItem | null = null;
  for (const call of run.calls) {
    if (call.kind === "thought") {
      isLoading ||= call.status !== "ready";
      continue;
    }
    toolCallCount += 1;
    latestToolCall = call;
    const { status } = describeToolCall(call);
    isLoading ||= status === "running" || status === "executing";
    if (status === "failed") failedCount += 1;
  }
  return {
    mode: "summary-with-latest-call",
    run,
    latestToolCall,
    toolCallCount,
    isLoading,
    failedCount,
  };
}
