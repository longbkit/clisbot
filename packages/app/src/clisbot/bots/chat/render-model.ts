import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";
import {
  HEARTBEAT_ACK_REPLY,
  isHeartbeatAck,
  isSilentReply,
  PASS_REPLY,
} from "@clisbot/protocol/chats/room";
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
  startedAt?: Date | null;
  permissions: readonly PendingPermission[];
}

export type ChatRenderRow =
  | { kind: "user"; key: string; line: ChatMessage; opensGroup: boolean }
  | { kind: "bot"; key: string; line: ChatMessage; botId: string; opensGroup: boolean }
  | { kind: "system"; key: string; line: ChatMessage }
  /** A heartbeat run posted into the chat: a marker, not a message from the user. */
  | { kind: "heartbeat"; key: string; line: ChatMessage; label: string }
  | {
      kind: "live";
      key: string;
      botId: string;
      agentId: string;
      items: StreamItem[];
      permissions: PendingPermission[];
      /** The turn is still running; false when only unreferenced tail items remain. */
      inProgress: boolean;
      startedAt?: Date | null;
      opensGroup: boolean;
    };

export interface ChatRenderModel {
  rows: ChatRenderRow[];
}

/** The sender a row belongs to, for grouping; a system line belongs to nobody. */
export function chatRowSender(row: ChatRenderRow | undefined): string | null {
  if (!row) return null;
  if (row.kind === "user") return "user";
  if (row.kind === "system" || row.kind === "heartbeat") return null;
  return `bot:${row.botId}`;
}

const senderOf = chatRowSender;

/**
 * A Bot reply that is silence, never a message: exactly `PASS` or `HEARTBEAT_OK` in a group, and
 * exactly `HEARTBEAT_OK` in a direct chat, where `PASS` can be a real answer. Matching is on the
 * trimmed text, so a reply that only mentions a marker still shows.
 */
export function isSilentBotText(text: string, group: boolean): boolean {
  return group ? isSilentReply(text) : isHeartbeatAck(text);
}

/** A still-streaming reply that so far spells the start of a silence marker. */
function mayBecomeSilent(text: string, group: boolean): boolean {
  const trimmed = text.trim();
  const markers = group ? [PASS_REPLY, HEARTBEAT_ACK_REPLY] : [HEARTBEAT_ACK_REPLY];
  return trimmed !== "" && markers.some((marker) => marker.startsWith(trimmed));
}

/**
 * The live items without silence: a finished silent reply, and the running turn's last reply
 * while it still spells a marker's start, so `HEARTBEAT_OK` never flashes on screen.
 */
function withoutSilence(
  items: readonly StreamItem[],
  group: boolean,
  turnActive: boolean,
): StreamItem[] {
  const last = items.findLastIndex((item) => item.kind === "assistant_message");
  return items.filter((item, index) => {
    if (item.kind !== "assistant_message") return true;
    if (isSilentBotText(item.text, group)) return false;
    return !(turnActive && index === last && mayBecomeSilent(item.text, group));
  });
}

function transcriptRow(line: ChatMessage, previous: ChatRenderRow | undefined): ChatRenderRow {
  const key = `line:${line.id}`;
  if (line.sender.kind === "system") return { kind: "system", key, line };
  // Only the daemon sets `scheduleRun`; a sender name alone could be any user's.
  if (line.scheduleRun && line.sender.kind === "user") {
    return { kind: "heartbeat", key, line, label: line.sender.displayName ?? "" };
  }
  if (line.sender.kind === "user") {
    return { kind: "user", key, line, opensGroup: senderOf(previous) !== "user" };
  }
  const botId = line.sender.botId;
  return { kind: "bot", key, line, botId, opensGroup: opensBotGroup(line, botId, previous) };
}

/**
 * A bot line joins the line above when the same bot wrote both in one turn. A later turn with no
 * prompt between, such as a heartbeat run in a session, starts its own group with the face.
 */
function opensBotGroup(line: ChatMessage, botId: string, previous: ChatRenderRow | undefined) {
  if (senderOf(previous) !== `bot:${botId}`) return true;
  const turn = line.reply?.turnId;
  const previousTurn = previous?.kind === "bot" ? previous.line.reply?.turnId : undefined;
  return turn !== undefined && previousTurn !== undefined && turn !== previousTurn;
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

/**
 * A group bot's live row shows only its running turn: a spoken reply becomes a transcript line
 * and a silent one (`PASS`) becomes nothing, so an ended turn leaves no tail behind
 * (plans/group-discussion.md, "Silence is a valid turn").
 */
function groupTurnItems(head: ChatLiveHead): readonly StreamItem[] {
  if (!head.turnActive) return [];
  const lastPrompt = head.items.findLastIndex((item) => item.kind === "user_message");
  return head.items.slice(lastPrompt + 1);
}

/**
 * A direct chat's tail, less a finished turn that ended in silence: a heartbeat run answered
 * `HEARTBEAT_OK` writes no line, so its tool calls must not linger below the transcript.
 */
function directTurnItems(head: ChatLiveHead): readonly StreamItem[] {
  if (head.turnActive) return head.items;
  const lastPrompt = head.items.findLastIndex((item) => item.kind === "user_message");
  const reply = head.items
    .slice(lastPrompt + 1)
    .findLast((item) => item.kind === "assistant_message");
  const silent = reply?.kind === "assistant_message" && isSilentBotText(reply.text, false);
  return silent ? head.items.slice(0, lastPrompt + 1) : head.items;
}

function liveRow(
  transcript: readonly ChatMessage[],
  botId: string,
  head: ChatLiveHead,
  previous: ChatRenderRow | undefined,
  group: boolean,
): ChatRenderRow | null {
  const tail = group ? groupTurnItems(head) : directTurnItems(head);
  const unreferenced = unreferencedItems(tail, linesFromAgent(transcript, botId, head.agentId));
  const items = withoutSilence(unreferenced, group, head.turnActive);
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
    startedAt: head.startedAt ?? null,
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
  options: { group?: boolean } = {},
): ChatRenderModel {
  const rows: ChatRenderRow[] = [];
  const group = options.group === true;
  for (const line of transcript) {
    // A silent reply persisted before the daemon dropped it (or by an older one) stays hidden.
    if (line.sender.kind === "bot" && isSilentBotText(line.text, group)) continue;
    rows.push(transcriptRow(line, rows[rows.length - 1]));
  }
  for (const [botId, head] of liveHeadsByBot) {
    const row = liveRow(transcript, botId, head, rows[rows.length - 1], group);
    if (row) rows.push(row);
  }
  return { rows };
}
