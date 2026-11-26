import { getClisbotToolActionLabel } from "@clisbot/protocol/clisbot-tool-presentation/index";
import { isTurnTrigger } from "@/agent-stream/turn-membership";

import { describeToolCall, type GroupableItem, type ToolCallRun } from "../grouping";

const DIRECT_SEARCH_TOOL_SUFFIX_PATTERN = /(?:^|[_.:/])(?:web_search|llm_context)$/;

export interface OverviewSummary {
  thoughtCount: number;
  editedFileCount: number;
  commandCount: number;
  readFileCount: number;
  searchCount: number;
  otherToolCount: number;
  clisbotActions: Record<string, number>;
}

export interface OverviewToolCallGroup {
  mode: "overview";
  run: ToolCallRun;
  summary: OverviewSummary;
  isLoading: boolean;
}

function isSearchCall(name: string): boolean {
  return DIRECT_SEARCH_TOOL_SUFFIX_PATTERN.test(name);
}

/** Counts tool calls by what they did, for any summary of a stretch of agent work. */
export function summarizeToolCalls(calls: readonly GroupableItem[]): OverviewSummary {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  let thoughtCount = 0;
  let commandCount = 0;
  let searchCount = 0;
  let otherToolCount = 0;
  const clisbotActions: Record<string, number> = {};

  for (const call of calls) {
    if (call.kind === "thought") {
      thoughtCount += 1;
      continue;
    }
    if (isTurnTrigger(call)) continue;
    const descriptor = describeToolCall(call);
    const normalizedName = descriptor.name.trim().toLowerCase();
    const action = getClisbotToolActionLabel(descriptor.name);
    if (action) {
      clisbotActions[action] = (clisbotActions[action] ?? 0) + 1;
    } else if (descriptor.detail.type === "edit" || descriptor.detail.type === "write") {
      editedFiles.add(descriptor.detail.filePath);
    } else if (descriptor.detail.type === "shell") {
      commandCount += 1;
    } else if (descriptor.detail.type === "read") {
      readFiles.add(descriptor.detail.filePath);
    } else if (descriptor.detail.type === "search" || isSearchCall(normalizedName)) {
      searchCount += 1;
    } else {
      otherToolCount += 1;
    }
  }

  return {
    thoughtCount,
    editedFileCount: editedFiles.size,
    commandCount,
    readFileCount: readFiles.size,
    searchCount,
    otherToolCount,
    clisbotActions,
  };
}

export function buildOverviewGroup(run: ToolCallRun): OverviewToolCallGroup {
  const isLoading = run.calls.some((call) => {
    if (call.kind === "thought") return call.status !== "ready";
    const status = describeToolCall(call).status;
    return status === "running" || status === "executing";
  });
  return {
    mode: "overview",
    run,
    isLoading,
    summary: summarizeToolCalls(run.calls),
  };
}
