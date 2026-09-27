// Startup backfill of replies that never reached a transcript
// (docs/features/bots-and-chats/plans/server-chat.md, §3): a turn that ended
// while the daemon was down left its answer in the bot's timeline only. One
// receipt scan and one forward window per participant; a backfilled reply
// is never forwarded, the next user message continues the chat.
import type { Logger } from "pino";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";
import { resolveClientMessageId } from "../client-message-id.js";
import type { BotLookup } from "./chat-engine.js";
import type { ChatCompletedTurn, StoredChat, StoredChatParticipant } from "./chat-record.js";
import type { ChatStore } from "./chat-store.js";
import { finalAnswer, type TimelineReference } from "./final-answer.js";
import type { TranscriptLine, TranscriptLineInput, TranscriptLog } from "./transcript-log.js";

export interface ReconcileDependencies {
  store: Pick<ChatStore, "list" | "markDelivered">;
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

/** Bound each disk read without bounding the recovery horizon. */
const PAGE_LINES = 256;
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
  // Delivery can be pending behind arbitrarily many replies from other bots.
  // Page the complete journal; the UI context window is not a recovery boundary.
  const lines: TranscriptLine[] = [];
  let cursor = 0;
  for (;;) {
    const page = await deps
      .transcriptOf(chat.id)
      .fetch({ direction: "after", cursor: { seq: cursor }, limit: PAGE_LINES });
    lines.push(...page.lines);
    if (!page.hasNewer || page.endSeq <= cursor) break;
    cursor = page.endSeq;
  }
  for (const storedParticipant of chat.participants) {
    const participant = await repairDeliveredSequence(deps, chat.id, storedParticipant, lines);
    const pending = missingReply(lines, participant);
    if (!pending || (participant.agentId && deps.isRunning(participant.agentId))) continue;
    await backfill(
      deps,
      chat,
      participant.botId,
      participant.agentId,
      pending,
      participant.completedTurn,
    );
  }
}

/** Prompt acceptance and the Chat watermark are separate durable writes. Only an actual
 * submitted row proves ingress; a projected reply or an unknown recovery notice does not.
 * Run independently of reply backfill, including when the newest trigger was never submitted.
 */
async function repairDeliveredSequence(
  deps: ReconcileDependencies,
  chatId: string,
  participant: StoredChatParticipant,
  lines: readonly TranscriptLine[],
): Promise<StoredChatParticipant> {
  if (!participant.agentId) return participant;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!;
    if (line.seq <= participant.deliveredSeq) break;
    if (
      line.sender.kind === "system" ||
      (line.sender.kind === "bot" && line.sender.botId === participant.botId) ||
      (participant.resetAt && line.at <= participant.resetAt)
    )
      continue;
    if (!(await deps.findSubmittedRow(participant.agentId, line.id))) continue;
    await deps.store.markDelivered(chatId, participant.botId, line.seq);
    return { ...participant, deliveredSeq: line.seq };
  }
  return participant;
}

/** The newest line handed to the bot whose reply never landed, or `null` when none is owed. */
function missingReply(
  lines: readonly TranscriptLine[],
  participant: StoredChatParticipant,
): TranscriptLine | null {
  const own = (line: TranscriptLine) =>
    line.sender.kind === "bot" && line.sender.botId === participant.botId;
  const delivered = lines.filter(
    (line) =>
      line.sender.kind !== "system" &&
      !own(line) &&
      (line.deliveryBotIds
        ? line.deliveryBotIds.includes(participant.botId)
        : line.seq <= participant.deliveredSeq) &&
      (!participant.resetAt || line.at > participant.resetAt),
  );
  const newest = delivered.at(-1);
  if (!newest) return null;
  const answered = lines.some(
    (line) =>
      line.seq > newest.seq &&
      ((own(line) &&
        line.reply?.agentId === participant.agentId &&
        (line.inReplyTo === newest.id || (!line.inReplyTo && !line.deliveryBotIds))) ||
        (line.sender.kind === "system" &&
          line.inReplyTo === newest.id &&
          (line.deliveryBotIds?.includes(participant.botId) ||
            (participant.agentId !== null &&
              line.reply?.agentId === participant.agentId &&
              line.text.endsWith(BACKFILL_FAILURE_SUFFIX))))),
  );
  return answered ? null : newest;
}

async function backfill(
  deps: ReconcileDependencies,
  chat: StoredChat,
  botId: string,
  agentId: string | null,
  pending: TranscriptLine,
  receipt?: ChatCompletedTurn | null,
): Promise<void> {
  const at = deps.now?.() ?? new Date().toISOString();
  const submitted = agentId ? await deps.findSubmittedRow(agentId, pending.id) : null;
  const answer = await completedAnswer(deps, agentId, pending.id, submitted, receipt);
  if (answer && agentId) {
    await deps.appendLine(chat.id, {
      id: resolveClientMessageId(undefined),
      at,
      sender: { kind: "bot", botId },
      text: answer.text,
      reply: { agentId, ...(answer.turnId ? { turnId: answer.turnId } : {}), ...answer.lastRow },
      inReplyTo: pending.id,
      hop: pending.hop + 1,
      deliveryBotIds: [],
    });
    return;
  }
  const bot = await deps.bots.get(botId);
  await deps.appendLine(chat.id, {
    id: resolveClientMessageId(undefined),
    at,
    sender: { kind: "system" },
    text: `⚠️ ${bot?.displayName ?? botId} ${!submitted && pending.deliveryBotIds ? "delivery could not be confirmed after restart; send a new message to retry." : BACKFILL_FAILURE_SUFFIX}`,
    ...(agentId ? { reply: { agentId } } : {}),
    deliveryBotIds: [botId],
    inReplyTo: pending.id,
    hop: 0,
  });
}

async function completedAnswer(
  deps: ReconcileDependencies,
  agentId: string | null,
  messageId: string,
  submitted: TimelineReference | null,
  receipt?: ChatCompletedTurn | null,
) {
  if (
    !agentId ||
    !submitted ||
    !receipt?.lastRow ||
    receipt.agentId !== agentId ||
    !receipt.messageIds.includes(messageId) ||
    receipt.lastRow.epoch !== submitted.epoch
  )
    return null;
  const rows = await deps.rowsAfter(agentId, submitted);
  const nextPrompt = rows.findIndex((row) => row.item.type === "user_message");
  const turn = (nextPrompt < 0 ? rows : rows.slice(0, nextPrompt)).filter(
    (row) => row.seq <= receipt.lastRow!.seq,
  );
  const answer = finalAnswer(
    turn.map((row) => ({
      item: row.item,
      row: { epoch: submitted.epoch, seq: row.seq },
      turnId: row.turnId,
    })),
  );
  if (
    !answer ||
    (answer.turnId && answer.turnId !== receipt.turnId) ||
    answer.lastRow?.seq !== receipt.lastRow.seq
  )
    return null;
  return answer;
}
