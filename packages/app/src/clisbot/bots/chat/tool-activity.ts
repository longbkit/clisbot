// A Bot turn's tool calls, folded for the `collapsed` and `header` tool call displays
// (docs/features/bots-and-chats/app-experience.md, "Tool calls"). Pure: no React, no store.
import type { ChatDisplay, ChatToolDisplay } from "@clisbot/protocol/chats/tool-display";
import { resolveChatToolDisplay } from "@clisbot/protocol/chats/tool-display";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { describeToolCall } from "@/tool-calls/detail-level/grouping";
import type { StreamItem, ThoughtItem, ToolCallItem } from "@/types/stream";
import type { ChatLiveHead } from "./render-model";

export type ToolActivityItem = ToolCallItem | ThoughtItem;

/** One turn's tool calls and thoughts, in order, with what the folded bar shows. */
export interface ToolActivity {
  items: readonly ToolActivityItem[];
  latest: ToolActivityItem;
  /** The latest call is still running in a running turn. */
  running: boolean;
  /** Tool calls, without thoughts. */
  callCount: number;
  failedCount: number;
}

/** One Bot's latest turn, for the header. */
export interface BotToolActivity {
  botId: string;
  activity: ToolActivity;
  turnActive: boolean;
}

export function isToolActivityItem(item: StreamItem): item is ToolActivityItem {
  return item.kind === "tool_call" || item.kind === "thought";
}

function isRunning(item: ToolActivityItem): boolean {
  if (item.kind === "thought") return item.status !== "ready";
  const { status } = describeToolCall(item);
  return status === "running" || status === "executing";
}

function isFailed(item: ToolActivityItem): boolean {
  return item.kind === "tool_call" && describeToolCall(item).status === "failed";
}

/** The tool calls and thoughts among `items`; `null` when the turn used none. */
export function toolActivityOf(
  items: readonly StreamItem[],
  turnActive: boolean,
): ToolActivity | null {
  const activity = items.filter(isToolActivityItem);
  const latest = activity[activity.length - 1];
  if (!latest) return null;
  return {
    items: activity,
    latest,
    running: turnActive && isRunning(latest),
    callCount: activity.filter((item) => item.kind === "tool_call").length,
    failedCount: activity.filter(isFailed).length,
  };
}

/** The items after the head's last prompt: its running turn, or the one that just ended. */
function latestTurnItems(head: ChatLiveHead): readonly StreamItem[] {
  const lastPrompt = head.items.findLastIndex((item) => item.kind === "user_message");
  return head.items.slice(lastPrompt + 1);
}

function latestAt(activity: ToolActivity): number {
  return activity.latest.timestamp.getTime();
}

/**
 * Every Bot's latest turn that used tools: running turns first, then the most recent. Each entry
 * is one Bot and one turn, so the header never mixes turns or Bots.
 */
export function headerToolActivities(heads: ReadonlyMap<string, ChatLiveHead>): BotToolActivity[] {
  const entries: BotToolActivity[] = [];
  for (const [botId, head] of heads) {
    const activity = toolActivityOf(latestTurnItems(head), head.turnActive);
    if (activity) entries.push({ botId, activity, turnActive: head.turnActive });
  }
  return entries.sort(
    (left, right) =>
      Number(right.turnActive) - Number(left.turnActive) ||
      latestAt(right.activity) - latestAt(left.activity),
  );
}

/**
 * The display a conversation uses: a group's own setting, a direct chat's Bot's. A Host that
 * predates the setting sends neither, which is the default.
 */
export function conversationToolDisplay(
  chat: Pick<ChatPayload, "rules"> | null,
  group: boolean,
  bot: { display?: ChatDisplay } | undefined,
): ChatToolDisplay {
  return resolveChatToolDisplay(group ? chat?.rules.display : bot?.display);
}
