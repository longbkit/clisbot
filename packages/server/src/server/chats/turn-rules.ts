// Who answers a transcript line (docs/features/bots-and-chats/README.md, D9;
// plans/server-chat.md §2.2). Pure: the engine hands in the participants, the
// resolved rules and the line, and gets back the bot ids to deliver to and the
// system notice a stopped hop chain owes the user.
import type { ChatMessagePayload } from "@getpaseo/protocol/chats/types";
import { limitValue, type ResolvedChatRules } from "./chat-record.js";
import { parseMentions, type MentionableParticipant } from "./mentions.js";

export interface TurnDecision {
  /** Bot ids to deliver the line to, in mention order (or participant order). */
  targets: string[];
  /** A `system` line the engine appends instead of delivering, when a rule stopped a chain. */
  notice?: string;
}

export interface TurnRuleInput {
  participants: readonly MentionableParticipant[];
  rules: ResolvedChatRules;
  line: Pick<ChatMessagePayload, "sender" | "text" | "hop">;
  /** The bot's display name for the notice text. */
  botName: (botId: string) => string;
}

const NONE: TurnDecision = { targets: [] };

export function targetsFor(input: TurnRuleInput): TurnDecision {
  const { line, participants } = input;
  if (line.sender.kind === "system" || participants.length === 0) return NONE;
  if (line.sender.kind === "user") return userLineTargets(input);
  return botLineTargets(input, line.sender.botId);
}

/** A user line: the mentioned bots; with none, everyone unless a mention is required. */
function userLineTargets(input: TurnRuleInput): TurnDecision {
  const { participants, rules, line } = input;
  if (participants.length === 1) return { targets: [participants[0]!.botId] };
  const mentioned = parseMentions(line.text, participants);
  if (mentioned.length > 0) return { targets: mentioned };
  if (rules.interaction.requireMention) return NONE;
  return { targets: participants.map((participant) => participant.botId) };
}

/**
 * A bot line: only the bots it mentions, never itself, never a broadcast (a broadcast reply
 * would fan out to every bot on every hop). Past the hop limit the chain ends in a notice.
 */
function botLineTargets(input: TurnRuleInput, authorId: string): TurnDecision {
  const { participants, rules, line } = input;
  const mentioned = parseMentions(line.text, participants).filter((botId) => botId !== authorId);
  if (mentioned.length === 0) return NONE;
  if (line.hop <= rules.hops.max) return { targets: mentioned };
  const names = mentioned.map((botId) => `@${slugOf(participants, botId)}`).join(", ");
  return {
    targets: [],
    notice: `⚠️ ${input.botName(authorId)} mentioned ${names}, but the hop limit (${rules.hops.max}) was reached; nothing was forwarded.`,
  };
}

function slugOf(participants: readonly MentionableParticipant[], botId: string): string {
  return participants.find((participant) => participant.botId === botId)?.slug ?? botId;
}

/** The refusal for a message over `limits.maxInputCharacters`, or `null` when it fits. */
export function inputLimitError(rules: ResolvedChatRules, text: string): string | null {
  const max = limitValue(rules, "maxInputCharacters");
  if (max === null || text.length <= max) return null;
  return `Message is ${text.length} characters; this chat accepts at most ${max}.`;
}
