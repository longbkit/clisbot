// What a bot "said" in a turn: the daemon's own rule
// (`AgentManager.getLastAssistantMessageFromTimeline`), the last contiguous run
// of `assistant_message` items. Shared by the turn tracker (live events) and the
// restart reconciliation (durable rows) so both write the same bot line.
import type { AgentTimelineItem } from "../agent/agent-sdk-types.js";

export interface TimelineReference {
  epoch: string;
  seq: number;
}

/** One timeline item with the durable row it landed on, when session storage recorded it. */
export interface AnsweredItem {
  item: AgentTimelineItem;
  row: TimelineReference | null;
  turnId?: string | undefined;
}

export interface FinalAnswer {
  text: string;
  /** The row of the last assistant item in the run. */
  lastRow: TimelineReference | null;
  turnId: string | undefined;
}

/** The Codex boundary marker prefixed to the first delta of a new assistant message. */
const ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN = "\n\n---\n\n";
/** The daemon's own copy of a failure, appended as an assistant message; never a reply. */
const SYSTEM_ERROR_PREFIX = "[System Error]";

/**
 * Items sharing a `messageId` concatenate with `""` (the daemon's coalesce window splits
 * mid-word); distinct messages of one run join with a blank line. Any other item ends the
 * run, so the answer is what came after the last tool call. `null` when the run is empty.
 */
export function finalAnswer(items: readonly AnsweredItem[]): FinalAnswer | null {
  const run = lastAssistantRun(items);
  const messages: string[] = [];
  let pendingId: string | undefined;
  let pending = "";
  let lastRow: TimelineReference | null = null;
  let turnId: string | undefined;
  for (const entry of run) {
    if (entry.item.type !== "assistant_message") continue;
    const text = cleanAssistantText(entry.item.text);
    if (text === "") continue;
    if (pending !== "" && pendingId !== entry.item.messageId) {
      messages.push(pending);
      pending = "";
    }
    pendingId = entry.item.messageId;
    pending += text;
    lastRow = entry.row ?? lastRow;
    turnId = entry.turnId ?? turnId;
  }
  if (pending !== "") messages.push(pending);
  return messages.length ? { text: messages.join("\n\n"), lastRow, turnId } : null;
}

function lastAssistantRun(items: readonly AnsweredItem[]): AnsweredItem[] {
  let start = items.length;
  while (start > 0 && items[start - 1]!.item.type === "assistant_message") start -= 1;
  return items.slice(start);
}

function cleanAssistantText(text: string): string {
  let result = text;
  while (result.startsWith(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN))
    result = result.slice(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN.length);
  return result.startsWith(SYSTEM_ERROR_PREFIX) ? "" : result;
}
