// Startup backfill of replies that never reached a transcript
// (docs/features/bots-and-chats/plans/server-chat.md, §3): a turn that ended
// while the daemon was down left its answer in the bot's timeline only. One
// submission lookup and one forward window per participant; a backfilled reply
// is never forwarded, the next user message continues the chat.
import type { Logger } from "pino";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";
import { resolveClientMessageId } from "../client-message-id.js";
import type { BotLookup } from "./chat-engine.js";
import type { StoredChat, StoredChatParticipant } from "./chat-record.js";
import type { ChatStore } from "./chat-store.js";
import { finalAnswer, type TimelineReference } from "./final-answer.js";
import type { TranscriptLine, TranscriptLineInput, TranscriptLog } from "./transcript-log.js";

export interface ReconcileDependencies {
  store: Pick<ChatStore, "list">;
  transcriptOf: (chatId: string) => Pick<TranscriptLog, "fetch">;
  bots: BotLookup;
  /** Appends through the engine so the line is published like any other. */
  appendLine: (chatId: string, input: TranscriptLineInput) => Promise<unknown>;
  /** Whether the agent has a turn running now; a running turn is the tracker's to finish. */
  isRunning: (agentId: string) => boolean;
  /** The durable row of the bot's `user_message` for a chat line, or `null` without storage. */
  findSubmittedRow: (agentId: string, messageId: string) => Promise<TimelineReference | null>;
  /** Every durable row after the cursor, oldest first. */
  rowsAfter: (agentId: string, cursor: TimelineReference) => Promise<AgentTimelineRow[]>;
  logger: Logger;
  now?: () => string;
}

/** How far back the transcript is read; a missing reply is never older than this. */
const TAIL_LINES = 200;
const BACKFILL_FAILURE_SUFFIX = "stopped while the daemon was down; no reply was recorded.";

/** Runs one chat at a time; a chat that fails is logged and the next one still runs. */
export async function reconcileChats(deps: ReconcileDependencies): Promise<void> {
  for (const chat of await deps.store.list()) {
    if (chat.archivedAt) continue;
    try {
      await reconcileChat(deps, chat);
    } catch (error) {
      deps.logger.warn({ chatId: chat.id, err: error }, "chat.reconcile.failed");
    }
  }
}

async function reconcileChat(deps: ReconcileDependencies, chat: StoredChat): Promise<void> {
  const { lines } = await deps.transcriptOf(chat.id).fetch({ limit: TAIL_LINES });
  for (const participant of chat.participants) {
    if (!participant.agentId) continue;
    const pending = missingReply(lines, participant);
    if (!pending || deps.isRunning(participant.agentId)) continue;
    await backfill(deps, chat, participant.botId, participant.agentId, pending);
  }
}

/** The newest line handed to the bot whose reply never landed, or `null` when none is owed. */
function missingReply(
  lines: readonly TranscriptLine[],
  participant: StoredChatParticipant,
): TranscriptLine | null {
  const own = (line: TranscriptLine) =>
    line.sender.kind === "bot" && line.sender.botId === participant.botId;
  const delivered = lines.filter((line) => line.seq <= participant.deliveredSeq && !own(line));
  const newest = delivered.at(-1);
  if (!newest) return null;
  const answered = lines.some(
    (line) =>
      line.seq > newest.seq &&
      ((own(line) && line.reply?.agentId === participant.agentId) ||
        (line.sender.kind === "system" && line.text.endsWith(BACKFILL_FAILURE_SUFFIX))),
  );
  return answered ? null : newest;
}

async function backfill(
  deps: ReconcileDependencies,
  chat: StoredChat,
  botId: string,
  agentId: string,
  pending: TranscriptLine,
): Promise<void> {
  const at = deps.now?.() ?? new Date().toISOString();
  const submitted = await deps.findSubmittedRow(agentId, pending.id);
  const rows = submitted ? await deps.rowsAfter(agentId, submitted) : [];
  // The window starts after the submitted user row and ends at the next prompt.
  const nextPrompt = rows.findIndex((row) => row.item.type === "user_message");
  const turn = nextPrompt < 0 ? rows : rows.slice(0, nextPrompt);
  const answer = finalAnswer(
    turn.map((row) => ({
      item: row.item,
      row: submitted ? { epoch: submitted.epoch, seq: row.seq } : null,
      turnId: row.turnId,
    })),
  );
  if (answer) {
    await deps.appendLine(chat.id, {
      id: resolveClientMessageId(undefined),
      at,
      sender: { kind: "bot", botId },
      text: answer.text,
      reply: { agentId, ...(answer.turnId ? { turnId: answer.turnId } : {}), ...answer.lastRow },
      inReplyTo: pending.id,
      hop: pending.hop + 1,
    });
    return;
  }
  const bot = await deps.bots.get(botId);
  await deps.appendLine(chat.id, {
    id: resolveClientMessageId(undefined),
    at,
    sender: { kind: "system" },
    text: `⚠️ ${bot?.displayName ?? botId} ${BACKFILL_FAILURE_SUFFIX}`,
    hop: 0,
  });
}
