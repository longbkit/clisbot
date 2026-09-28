// Turns in rounds for a group chat (docs/features/bots-and-chats/plans/group-discussion.md):
// one bot speaks at a time per Chat, each wake carries everything the bot has not seen, and
// a round in which nobody speaks ends the discussion. `rounds.max` is a guard rail, not a
// target. The state is in memory: a daemon restart ends a discussion, never a transcript.
import type { StoredChat, ResolvedChatRules } from "./chat-record.js";
import type { ChatStore } from "./chat-store.js";
import { KeyedSerialQueue } from "./keyed-queue.js";
import { parseMessageMentions, type MentionableParticipant } from "./mentions.js";
import { renderTurnCue } from "./room-contract.js";
import type { TranscriptLine, TranscriptLog } from "./transcript-log.js";

/**
 * `open`: the user addressed the room (or nobody), so every member with unseen lines takes a
 * turn in later rounds. `addressed`: the user named bots, so later rounds wake only bots a
 * message named since their last turn.
 */
export type DiscussionMode = "open" | "addressed";

export interface DiscussionDependencies {
  store: Pick<ChatStore, "require">;
  transcriptOf: (chatId: string) => TranscriptLog;
  rulesOf: (chat: StoredChat) => ResolvedChatRules;
  /** Members in Members order, with display names for bot-line mentions. */
  members: (chat: StoredChat) => Promise<MentionableParticipant[]>;
  /** Wakes a bot with `lines`; resolves `true` when a turn started. Failures are its notice. */
  wake: (chatId: string, botId: string, lines: TranscriptLine[], cue: string) => Promise<boolean>;
  notice: (chatId: string, text: string) => Promise<unknown>;
}

interface Discussion {
  mode: DiscussionMode;
  queue: string[];
  round: number;
  /** Someone spoke this round; a silent round ends the discussion. */
  spoke: boolean;
  /** The bot whose turn is running. */
  current: string | null;
}

interface Standing {
  botId: string;
  /** Lines from others since this bot's last turn, oldest first. */
  unseen: TranscriptLine[];
  /** One of those lines names this bot. */
  named: boolean;
}

/** How far back a bot's unseen lines are read; a longer backlog still reaches it as context. */
const UNSEEN_LIMIT = 200;

/**
 * Who a user line in a group wakes first: the bots it names, the whole room for `@everyone` or
 * no mention, nobody when a mention is required and missing. `members` is in Members order.
 */
export function discussionOpening(
  members: readonly MentionableParticipant[],
  rules: Pick<ResolvedChatRules, "interaction">,
  text: string,
): { mode: DiscussionMode; targets: string[] } {
  const mentions = parseMessageMentions(text, members);
  const everyone = members.map((member) => member.botId);
  if (mentions.room)
    return { mode: "open", targets: [...new Set([...mentions.botIds, ...everyone])] };
  if (mentions.botIds.length > 0) return { mode: "addressed", targets: mentions.botIds };
  return { mode: "open", targets: rules.interaction.requireMention ? [] : everyone };
}

export class ChatDiscussions {
  private readonly active = new Map<string, Discussion>();
  private readonly queue = new KeyedSerialQueue();

  constructor(private readonly deps: DiscussionDependencies) {}

  /**
   * Replaces any running discussion in the chat. A bot still speaking in the replaced one keeps
   * the floor: the first bot of the new one wakes when that turn ends, so one bot speaks at a time.
   */
  start(chatId: string, mode: DiscussionMode, first: readonly string[]): Promise<void> {
    const speaking = this.active.get(chatId)?.current ?? null;
    const discussion: Discussion = {
      mode,
      queue: [...first],
      round: 1,
      spoke: false,
      current: speaking,
    };
    this.active.set(chatId, discussion);
    if (speaking) return Promise.resolve();
    return this.queue.run(chatId, () => this.advance(chatId, discussion));
  }

  /** A bot's turn ended: it spoke, passed or failed. Only the running turn moves the room. */
  turnEnded(chatId: string, botId: string, spoke: boolean): Promise<void> {
    return this.queue.run(chatId, async () => {
      const discussion = this.active.get(chatId);
      if (!discussion || discussion.current !== botId) return;
      discussion.current = null;
      discussion.spoke ||= spoke;
      await this.advance(chatId, discussion);
    });
  }

  /** Ends the discussion; returns whether one was running. */
  stop(chatId: string): boolean {
    return this.active.delete(chatId);
  }

  /** Someone stopped this bot: when it holds the floor, the discussion ends with it. */
  stopIfSpeaking(chatId: string, botId: string): void {
    if (this.active.get(chatId)?.current === botId) this.active.delete(chatId);
  }

  private async advance(chatId: string, discussion: Discussion): Promise<void> {
    while (this.active.get(chatId) === discussion) {
      const botId = discussion.queue.shift();
      if (botId === undefined) {
        if (!(await this.nextRound(chatId, discussion))) this.end(chatId, discussion);
        continue;
      }
      if (await this.wake(chatId, botId, discussion)) return;
    }
  }

  private async wake(chatId: string, botId: string, discussion: Discussion): Promise<boolean> {
    const chat = await this.deps.store.require(chatId);
    const participant = chat.participants.find((entry) => entry.botId === botId);
    if (!participant) return false;
    const standing = await this.standingOf(chat.id, participant, await this.deps.members(chat));
    if (standing.unseen.length === 0) return false;
    const cue = renderTurnCue(discussion.round, this.deps.rulesOf(chat).rounds.max);
    const started = await this.deps.wake(chatId, botId, standing.unseen, cue);
    if (started && this.active.get(chatId) === discussion) discussion.current = botId;
    return started;
  }

  /** Queues the next round; `false` when the discussion is over. */
  private async nextRound(chatId: string, discussion: Discussion): Promise<boolean> {
    if (!discussion.spoke) return false;
    const chat = await this.deps.store.require(chatId);
    const next = (await this.standings(chat))
      .filter((entry) => entry.unseen.length > 0 && (discussion.mode === "open" || entry.named))
      .sort((left, right) => Number(right.named) - Number(left.named));
    if (next.length === 0) return false;
    const max = this.deps.rulesOf(chat).rounds.max;
    if (discussion.round >= max) {
      await this.deps.notice(
        chatId,
        `The discussion stopped after ${max} ${max === 1 ? "round" : "rounds"}.`,
      );
      return false;
    }
    discussion.round += 1;
    discussion.spoke = false;
    discussion.queue = next.map((entry) => entry.botId);
    return true;
  }

  private end(chatId: string, discussion: Discussion): void {
    if (this.active.get(chatId) === discussion) this.active.delete(chatId);
  }

  private async standings(chat: StoredChat): Promise<Standing[]> {
    const members = await this.deps.members(chat);
    return Promise.all(
      chat.participants.map((participant) => this.standingOf(chat.id, participant, members)),
    );
  }

  private async standingOf(
    chatId: string,
    { botId, deliveredSeq }: { botId: string; deliveredSeq: number },
    members: readonly MentionableParticipant[],
  ): Promise<Standing> {
    const page = await this.deps.transcriptOf(chatId).fetch({
      direction: "after",
      cursor: { seq: deliveredSeq },
      limit: UNSEEN_LIMIT,
    });
    const unseen = page.lines.filter((line) => isFromOthers(line, botId));
    const named = unseen.some((line) =>
      parseMessageMentions(line.text, members, {
        displayNames: line.sender.kind === "bot",
      }).botIds.includes(botId),
    );
    return { botId, unseen, named };
  }
}

function isFromOthers(line: TranscriptLine, botId: string): boolean {
  if (line.sender.kind === "system") return false;
  return !(line.sender.kind === "bot" && line.sender.botId === botId);
}
