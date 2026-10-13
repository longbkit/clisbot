import { describeToolCall, type ToolCallRun } from "../grouping";

export interface LatestCallToolCallGroup {
  mode: "summary-with-latest-call";
  run: ToolCallRun;
  isLoading: boolean;
  failedCount: number;
}

export function buildLatestCallGroup(run: ToolCallRun): LatestCallToolCallGroup {
  let isLoading = false;
  let failedCount = 0;
  for (const call of run.calls) {
    const { status } = describeToolCall(call);
    isLoading ||= status === "running" || status === "executing";
    if (status === "failed") failedCount += 1;
  }
  return { mode: "summary-with-latest-call", run, isLoading, failedCount };
}
