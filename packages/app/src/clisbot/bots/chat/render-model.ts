import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";
import type { ChatMessage } from "../data/contracts";

/**
 * One bot's in-progress work in a chat: its session's stream tail, whether the turn is
 * running, and the approvals it is waiting on. The screen builds this from store selectors;
 * nothing here reads React or the store (plans/app.md §4 "Render model").
 */
export interface ChatLiveHead {
  agentId: string;
  items: readonly StreamItem[];
  turnActive: boolean;
  permissions: readonly PendingPermission[];
}

export type ChatRenderRow =
  | { kind: "user"; key: string; line: ChatMessage; opensGroup: boolean }
  | { kind: "bot"; key: string; line: ChatMessage; botId: string; opensGroup: boolean }
  | { kind: "system"; key: string; line: ChatMessage }
  | {
      kind: "live";
      key: string;
      botId: string;
      agentId: string;
      items: StreamItem[];
      permissions: PendingPermission[];
      /** The turn is still running; false when only unreferenced tail items remain. */
      inProgress: boolean;
      opensGroup: boolean;
    };

export interface ChatRenderModel {
  rows: ChatRenderRow[];
}

/** The sender a row belongs to, for grouping; a system line belongs to nobody. */
export function chatRowSender(row: ChatRenderRow | undefined): string | null {
  if (!row) return null;
  if (row.kind === "user") return "user";
  if (row.kind === "system") return null;
  return `bot:${row.botId}`;
}

const senderOf = chatRowSender;

function transcriptRow(line: ChatMessage, previous: ChatRenderRow | undefined): ChatRenderRow {
  const key = `line:${line.id}`;
  if (line.sender.kind === "system") return { kind: "system", key, line };
  if (line.sender.kind === "user") {
    return { kind: "user", key, line, opensGroup: senderOf(previous) !== "user" };
  }
  const botId = line.sender.botId;
  return { kind: "bot", key, line, botId, opensGroup: senderOf(previous) !== `bot:${botId}` };
}

/** The bot's lines that came out of this agent, newest last. */
function linesFromAgent(
  transcript: readonly ChatMessage[],
  botId: string,
  agentId: string,
): ChatMessage[] {
  return transcript.filter(
    (line) => line.sender.kind === "bot" && line.sender.botId === botId && line.agentId === agentId,
  );
}

function itemReferences(item: StreamItem): string[] {
  const ids = [item.id];
  if (item.kind === "assistant_message" && item.messageId) ids.push(item.messageId);
  return ids;
}

/**
 * Tail items newer than the last transcript line that references this agent, minus anything a
 * line already references. The cut is the referenced item when the tail still holds it, else
 * the line's time — the tail is a window and may have dropped the item.
 */
function unreferencedItems(
  items: readonly StreamItem[],
  lines: readonly ChatMessage[],
): StreamItem[] {
  const referenced = new Set(lines.map((line) => line.timelineItemId).filter(Boolean));
  const lastReferencedIndex = items.reduce(
    (found, item, index) => (itemReferences(item).some((id) => referenced.has(id)) ? index : found),
    -1,
  );
  const lastLine = lines[lines.length - 1];
  const cutoff = lastReferencedIndex < 0 && lastLine ? Date.parse(lastLine.at) : Number.NaN;
  return items.filter((item, index) => {
    const cursor = item.timelineCursor;
    if (
      cursor &&
      lines.some(
        (line) =>
          line.reply?.epoch === cursor.epoch &&
          line.reply.seq !== undefined &&
          cursor.seq <= line.reply.seq,
      )
    )
      return false;
    if (item.kind === "user_message") return false;
    if (index <= lastReferencedIndex) return false;
    if (!Number.isNaN(cutoff) && item.timestamp.getTime() <= cutoff) return false;
    return !itemReferences(item).some((id) => referenced.has(id));
  });
}

function liveRow(
  transcript: readonly ChatMessage[],
  botId: string,
  head: ChatLiveHead,
  previous: ChatRenderRow | undefined,
): ChatRenderRow | null {
  const items = unreferencedItems(head.items, linesFromAgent(transcript, botId, head.agentId));
  const permissions = [...head.permissions];
  if (!head.turnActive && items.length === 0 && permissions.length === 0) return null;
  return {
    kind: "live",
    key: `live:${botId}`,
    botId,
    agentId: head.agentId,
    items,
    permissions,
    inProgress: head.turnActive,
    opensGroup: senderOf(previous) !== `bot:${botId}`,
  };
}

/**
 * Transcript lines in order, then one live row per bot with unfinished work, in the order the
 * heads were given. Dedupe is by referenced timeline item id, never by text (README D5).
 */
export function buildChatRenderModel(
  transcript: readonly ChatMessage[],
  liveHeadsByBot: ReadonlyMap<string, ChatLiveHead>,
): ChatRenderModel {
  const rows: ChatRenderRow[] = [];
  for (const line of transcript) rows.push(transcriptRow(line, rows[rows.length - 1]));
  for (const [botId, head] of liveHeadsByBot) {
    const row = liveRow(transcript, botId, head, rows[rows.length - 1]);
    if (row) rows.push(row);
  }
  return { rows };
}
