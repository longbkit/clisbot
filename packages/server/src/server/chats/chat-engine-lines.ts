// The pure pieces of `ChatEngine` (chat-engine.ts): how transcript lines become a bot
// prompt, and how a bot reply, a notice and a repeated send become transcript lines.
// Nothing here reads the store or an agent.
import { createHash } from "node:crypto";
import type { AgentPromptInput } from "../agent/agent-sdk-types.js";
import { buildAgentPrompt } from "../agent/prompt-attachments.js";
import { resolveClientMessageId } from "../client-message-id.js";
import { wrapSpokenInput } from "../voice-config.js";
import type { ChatMessageFiles, SendMessageInput, SendMessageResult } from "./chat-engine.js";
import type { ChatBot } from "./chat-record.js";
import type { MentionableParticipant } from "./mentions.js";
import {
  type RoomContractInput,
  renderRoomContract,
  renderRoomUpdate,
  roomFingerprint,
} from "./room-contract.js";
import type { TranscriptLine, TranscriptLineInput } from "./transcript-log.js";
import type { TurnOutcome } from "./turn-tracker.js";

/** How much of a failure's error text reaches the transcript. */
const NOTICE_ERROR_MAX_CHARS = 300;

/** The digest a send is deduplicated by, so a retried id with other content is refused. */
export function messageContentDigest(input: { text: string } & ChatMessageFiles): string {
  return createHash("sha256").update(messageContent(input)).digest("hex");
}

export function duplicateSend(
  existing: TranscriptLine,
  input: SendMessageInput,
): SendMessageResult {
  if (
    existing.attachmentContentDigest
      ? existing.attachmentContentDigest !== messageContentDigest(input)
      : messageContent(existing) !== messageContent(input)
  )
    throw new Error(`Message ${existing.id} already exists with different text or attachments`);
  return { messageId: existing.id, seq: existing.seq, targets: [], duplicate: true };
}

/** The bot line a finished turn writes; the caller decides its `deliveryBotIds`. */
export function botReplyLine(outcome: TurnOutcome, text: string, at: string): TranscriptLineInput {
  return {
    id: resolveClientMessageId(undefined),
    at,
    sender: { kind: "bot", botId: outcome.botId },
    text,
    reply: {
      agentId: outcome.agentId,
      turnId: outcome.turnId,
      ...outcome.lastRow,
      ...(outcome.startedAt ? { startedAt: outcome.startedAt } : {}),
    },
    ...(outcome.expectation ? { inReplyTo: outcome.expectation.messageIds.at(-1)! } : {}),
    hop: (outcome.expectation?.hop ?? 0) + 1,
  };
}

/** The prompt text plus the files the users shared in the window; spoken input stays marked. */
export function agentPromptFor(
  agentId: string,
  prompt: string,
  lines: TranscriptLine[],
  window: TranscriptLine[],
): AgentPromptInput {
  const userLines = window.filter((line) => line.sender.kind === "user");
  return buildAgentPrompt(
    lines.some((line) => line.spokenInputAgentId === agentId) ? wrapSpokenInput(prompt) : prompt,
    userLines.flatMap((line) => line.images ?? []),
    userLines.flatMap((line) => line.attachments ?? []),
  );
}

export function replacementNotice(bot: ChatBot, reason: "could_not_resume" | "archived"): string {
  return reason === "archived"
    ? `${bot.displayName}'s previous session was archived; a new one starts here.`
    : `${bot.displayName}'s previous session could not resume; a new one starts here.`;
}

export function errorLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = message.replace(/\s+/gu, " ").trim();
  if (line === "") return "unknown error";
  return line.length > NOTICE_ERROR_MAX_CHARS ? `${line.slice(0, NOTICE_ERROR_MAX_CHARS)}…` : line;
}

/**
 * What a bot hears first when the room changed since its session last heard about it. A session
 * that predates the room contract has never seen it, so it gets the whole contract, rules included.
 */
export function roomUpdateFor(
  room: RoomContractInput,
  roomSeen: string | undefined,
): string | null {
  if (roomSeen === undefined) return renderRoomContract(room);
  return roomSeen === roomFingerprint(room) ? null : renderRoomUpdate(room);
}

function messageContent(input: { text: string } & ChatMessageFiles): string {
  return JSON.stringify({
    text: input.text,
    images: input.images ?? [],
    attachments: (input.attachments ?? []).map((a) =>
      a.type === "uploaded_file" ? Object.assign({}, a, { path: undefined }) : a,
    ),
  });
}

/**
 * Who a heartbeat run reaches and what it says: the Bots it was set to tag that are still members
 * (else its own Bot), and in a group their tags before the prompt so the room reads who it is for.
 */
export function scheduledLine(
  members: readonly MentionableParticipant[],
  input: { botId: string; mentionBotIds?: readonly string[]; text: string },
  group: boolean,
): { targets: string[]; text: string } {
  const present = new Set(members.map((member) => member.botId));
  const chosen = (input.mentionBotIds ?? []).filter((botId) => present.has(botId));
  const targets = [...new Set(chosen.length > 0 ? chosen : [input.botId])];
  if (!group) return { targets, text: input.text };
  const tags = targets.map(
    (botId) => `@${members.find((member) => member.botId === botId)?.slug ?? botId}`,
  );
  return { targets, text: `${tags.join(" ")} ${input.text}` };
}
