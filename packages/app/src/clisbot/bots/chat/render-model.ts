import type { PendingPermission } from "@/types/shared";
import { flushHeadToTail, type StreamItem } from "@/types/stream";
import {
  isSilentBotReply,
  isSilentReply,
  mayBecomeSilentBotReply,
  stripAssistantMessageBoundary,
} from "@clisbot/protocol/chats/room";
import type { ChatMessage } from "../data/contracts";
import type { HeartbeatRun } from "@clisbot/protocol/schedule/heartbeat-notice";
import { isHeartbeatRunNotification } from "@clisbot/protocol/schedule/heartbeat-notice";

/**
 * One bot's in-progress work in a chat: its session's stream tail and head, whether the turn is
 * running, and the approvals it is waiting on. The screen builds this from store selectors;
 * nothing here reads React or the store (plans/app.md §4 "Render model").
 */
export interface ChatLiveHead {
  agentId: string;
  items: readonly StreamItem[];
  /** Uncommitted streaming items, kept separate so unrelated store updates stay a no-op. */
  streamingItems?: readonly StreamItem[];
  turnActive: boolean;
  startedAt?: Date | null;
  permissions: readonly PendingPermission[];
}

export type ChatRenderRow =
  | { kind: "user"; key: string; line: ChatMessage; opensGroup: boolean }
  | {
      kind: "bot";
      key: string;
      line: ChatMessage;
      botId: string;
      opensGroup: boolean;
      heartbeatRun?: HeartbeatRun;
    }
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
      startedAt?: Date | null;
      opensGroup: boolean;
      heartbeatRun?: HeartbeatRun;
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

/**
 * Direct and group Chats share the exact Bot markers. Only a group also treats no text as
 * silence; direct Chats retain their reply-less-turn notice.
 */
export function isSilentBotText(text: string, group: boolean): boolean {
  return group ? isSilentReply(text) : isSilentBotReply(text);
}

/** The same head/tail handoff used by the session timeline, without changing stored history. */
export function chatLiveItems(head: ChatLiveHead): readonly StreamItem[] {
  return head.streamingItems?.length
    ? flushHeadToTail([...head.items], [...head.streamingItems])
    : head.items;
}

/** Projected assistant messages in one contiguous run; never join different turns. */
function assistantRunText(items: readonly StreamItem[], start: number, end: number): string {
  let text = "";
  let messageId: string | undefined;
  for (const item of items.slice(start, end)) {
    if (item.kind !== "assistant_message") continue;
    const part = stripAssistantMessageBoundary(item.text);
    if (!part) continue;
    if (text && messageId !== item.messageId) text += "\n\n";
    text += part;
    messageId = item.messageId;
  }
  return text;
}

function assistantRunStart(items: readonly StreamItem[], end: number): number {
  let start = end;
  const turnId = items[end - 1]?.turnId;
  while (
    start > 0 &&
    items[start - 1]?.kind === "assistant_message" &&
    items[start - 1]?.turnId === turnId
  )
    start -= 1;
  return start;
}

/**
 * The live items without silence: a finished silent reply, and the running turn's last assistant run
 * while it still spells a marker's start, so `HEARTBEAT_OK` never flashes on screen.
 */
function withoutSilence(
  items: readonly StreamItem[],
  group: boolean,
  turnActive: boolean,
): StreamItem[] {
  const visible: StreamItem[] = [];
  let end = items.length;
  while (end > 0) {
    if (items[end - 1]?.kind !== "assistant_message") {
      visible.push(items[--end]!);
      continue;
    }
    const start = assistantRunStart(items, end);
    const text = assistantRunText(items, start, end);
    const pending =
      turnActive && end === items.length && (text.trim() === "" || mayBecomeSilentBotReply(text));
    if (!isSilentBotText(text, group) && !pending)
      visible.push(...items.slice(start, end).toReversed());
    end = start;
  }
  return visible.toReversed();
}

function transcriptRow(line: ChatMessage, previous: ChatRenderRow | undefined): ChatRenderRow {
  const key = `line:${line.id}`;
  if (line.sender.kind === "system") return { kind: "system", key, line };
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
    if (item.kind === "notification" && isHeartbeatRunNotification(item)) return false;
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
 * `PASS` or `HEARTBEAT_OK` writes no line, so successful tool calls must not linger below the
 * transcript. Notices, failed tools and approvals remain visible.
 */
function directTurnItems(head: ChatLiveHead): readonly StreamItem[] {
  if (head.turnActive) return head.items;
  const lastPrompt = head.items.findLastIndex((item) => item.kind === "user_message");
  const lastReply = head.items.findLastIndex((item) => item.kind === "assistant_message");
  if (lastReply <= lastPrompt) return head.items;
  const text = assistantRunText(
    head.items,
    assistantRunStart(head.items, lastReply + 1),
    lastReply + 1,
  );
  if (!isSilentBotReply(text)) return head.items;
  const replyTurnId = head.items[lastReply]?.turnId;
  return head.items.filter(
    (item, index) =>
      index <= lastPrompt ||
      item.kind === "notification" ||
      (replyTurnId !== undefined && item.turnId !== undefined && item.turnId !== replyTurnId) ||
      (item.kind === "tool_call" &&
        (item.payload.data.status === "failed" ||
          item.payload.data.status === "canceled" ||
          item.payload.data.error != null)),
  );
}

function liveRow(
  transcript: readonly ChatMessage[],
  botId: string,
  head: ChatLiveHead,
  previous: ChatRenderRow | undefined,
  group: boolean,
): ChatRenderRow | null {
  const completeHead = { ...head, items: chatLiveItems(head) };
  const tail = group ? groupTurnItems(completeHead) : directTurnItems(completeHead);
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
    // The canonical scheduled input ID identifies the running turn. Never use proximity.
    heartbeatRun: heartbeatForLiveTurn(transcript, completeHead.items),
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
  const runsByMessageId = new Map(
    transcript
      .filter((line) => line.sender.kind === "user" && line.scheduleRun)
      .map((line) => [line.id, heartbeatSnapshot(line)]),
  );
  for (const line of transcript) {
    if (line.sender.kind === "user" && line.scheduleRun) continue;
    // A silent reply persisted before the daemon dropped it (or by an older one) stays hidden.
    if (line.sender.kind === "bot" && isSilentBotText(line.text, group)) continue;
    const row = transcriptRow(line, rows[rows.length - 1]);
    if (row.kind === "bot" && line.inReplyTo) {
      const run = runsByMessageId.get(line.inReplyTo);
      if (run) row.heartbeatRun = run;
    }
    rows.push(row);
  }
  for (const [botId, head] of liveHeadsByBot) {
    const row = liveRow(transcript, botId, head, rows[rows.length - 1], group);
    if (row) rows.push(row);
  }
  return { rows };
}

/** Older Chat runs have identity/run but only a formatted display snapshot of their total/name. */
function heartbeatSnapshot(source: ChatMessage): HeartbeatRun | undefined {
  if (!source.scheduleRun || source.sender.kind !== "user") return undefined;
  const snapshot = source.scheduleRun;
  if (snapshot.maxRuns !== undefined) return snapshot;
  const legacy = /^Heartbeat · (.*) · run (\d+)(?: of (\d+))?$/u.exec(
    source.sender.displayName ?? "",
  );
  if (!legacy || Number(legacy[2]) !== snapshot.run) return snapshot;
  // A legacy title can be a prompt fallback, so it cannot establish a heartbeat name.
  return { ...snapshot, maxRuns: legacy[3] ? Number(legacy[3]) : null };
}

function heartbeatForLiveTurn(transcript: readonly ChatMessage[], items: readonly StreamItem[]) {
  const prompt = items.findLast((item) => item.kind === "user_message");
  if (prompt?.kind !== "user_message" || !prompt.turnId || prompt.turnId !== items.at(-1)?.turnId)
    return undefined;
  const source = transcript.find(
    (line) => line.id === (prompt.clientMessageId ?? prompt.messageId),
  );
  return source?.sender.kind === "user" ? heartbeatSnapshot(source) : undefined;
}
