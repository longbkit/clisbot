// `ChatEngine`: a user line is written, then fanned out; a bot's turn end is
// written as a bot line, then forwarded to the bots it mentions
// (docs/features/bots-and-chats/README.md, D5, D9; plans/server-chat.md §2).
// Every prompt goes through one delivery path; every bound that runs out ends
// in a `system` line, never in silence.
import type { Logger } from "pino";
import type { ChatMessagePayload, ChatPayload } from "@getpaseo/protocol/chats/types";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import type { AgentManager } from "../agent/agent-manager.js";
import type { PromptDispatchDisposition } from "../agent/agent-prompt.js";
import { resolveClientMessageId } from "../client-message-id.js";
import type { BotSessions } from "./bot-sessions.js";
import {
  chatPayload,
  resolveChatRules,
  type ChatBot,
  type ResolvedChatRules,
  type StoredChat,
} from "./chat-record.js";
import type { ChatStore } from "./chat-store.js";
import { renderChatPrompt, sessionTitleFor } from "./context-prompt.js";
import { KeyedSerialQueue } from "./keyed-queue.js";
import type { MentionableParticipant } from "./mentions.js";
import type { TranscriptLine, TranscriptLineInput, TranscriptLog } from "./transcript-log.js";
import { inputLimitError, targetsFor, type TurnDecision } from "./turn-rules.js";
import { TurnTracker, type TurnOutcome, type TurnTrackerHost } from "./turn-tracker.js";

export interface BotLookup {
  get(botId: string): Promise<ChatBot | null>;
}

/** The one prompt path (`sendPromptToAgent`), narrowed to what a delivery needs. */
export type ChatPromptSender = (params: {
  agentId: string;
  prompt: string;
  messageId: string;
  activeTurnBehavior?: "steer";
}) => Promise<{ disposition: PromptDispatchDisposition }>;

/** What the engine pushes; the Session wiring fans these out to subscribed clients. */
export interface ChatPublisher {
  transcriptAppended(chatId: string, line: ChatMessagePayload): void;
  chatUpdated(chat: ChatPayload): void;
}

export interface ChatEngineDependencies {
  store: ChatStore;
  transcriptOf: (chatId: string) => TranscriptLog;
  bots: BotLookup;
  botSessions: BotSessions;
  agentManager: Pick<AgentManager, "subscribe">;
  sendPrompt: ChatPromptSender;
  publisher: ChatPublisher;
  logger: Logger;
  now?: () => string;
}

export interface SendMessageInput {
  chatId: string;
  text: string;
  messageId?: string;
  actor?: SessionActor;
}

export interface SendMessageResult {
  messageId: string;
  seq: number;
  /** Bot ids the line was handed to; empty for a duplicate send. */
  targets: string[];
  duplicate: boolean;
}

/** How much of a failure's error text reaches the transcript. */
const NOTICE_ERROR_MAX_CHARS = 300;

export class ChatEngine implements TurnTrackerHost {
  readonly tracker: TurnTracker;
  private readonly queue = new KeyedSerialQueue();
  private readonly inFlight = new Set<Promise<unknown>>();
  /** Sender-line names of every bot seen in a chat, so rendering never awaits a lookup. */
  private readonly botNames = new Map<string, { slug: string; displayName: string }>();
  private readonly logger: Logger;
  private readonly now: () => string;

  constructor(private readonly deps: ChatEngineDependencies) {
    this.logger = deps.logger.child({ module: "chats", component: "chat-engine" });
    this.now = deps.now ?? (() => new Date().toISOString());
    this.tracker = new TurnTracker(deps.agentManager, this, this.logger);
  }

  /** Appends the user line, decides who answers, and returns before any bot is prompted. */
  send(input: SendMessageInput): Promise<SendMessageResult> {
    return this.queue.run(input.chatId, async () => {
      const chat = await this.deps.store.require(input.chatId);
      if (chat.archivedAt) throw new Error(`Chat ${chat.id} is archived`);
      const rules = resolveChatRules(chat.rules);
      const refusal = inputLimitError(rules, input.text);
      if (refusal) throw new Error(refusal);
      const id = resolveClientMessageId(input.messageId);
      const existing = await this.deps.transcriptOf(chat.id).findById(id);
      if (existing) return duplicateSend(existing, input.text);
      const line = await this.appendLine(chat.id, {
        id,
        at: this.now(),
        sender: { kind: "user", ...(input.actor ? { actor: input.actor } : {}) },
        text: input.text,
        hop: 0,
      });
      const decision = await this.decide(chat, rules, line);
      this.track(this.fanOut(chat.id, decision, line));
      return { messageId: id, seq: line.seq, targets: decision.targets, duplicate: false };
    });
  }

  /** `/new` (D7): the next delivery to this bot starts a fresh session. */
  async newSession(chatId: string, botId: string): Promise<void> {
    const bot = await this.deps.bots.get(botId);
    await this.deps.botSessions.reset(chatId, botId);
    await this.appendSystem(
      chatId,
      `${bot?.displayName ?? botId} will start a new session on the next message.`,
    );
  }

  /** Resolves once every delivery and forwarding started so far has settled. Tests and stop. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled(Array.from(this.inFlight));
  }

  stop(): void {
    this.tracker.stop();
  }

  private track(work: Promise<unknown>): void {
    this.inFlight.add(work);
    void work
      .catch((error: unknown) => this.logger.error({ err: error }, "chat.fan_out.failed"))
      .finally(() => this.inFlight.delete(work));
  }

  /** Writes a line, publishes it, and moves the chat's `lastMessageAt`. */
  async appendLine(chatId: string, input: TranscriptLineInput): Promise<TranscriptLine> {
    const line = await this.deps.transcriptOf(chatId).append(input);
    this.deps.publisher.transcriptAppended(chatId, line);
    await this.deps.store.touchLastMessage(chatId, line.at);
    return line;
  }

  private appendSystem(chatId: string, text: string): Promise<TranscriptLine> {
    return this.appendLine(chatId, {
      id: resolveClientMessageId(undefined),
      at: this.now(),
      sender: { kind: "system" },
      text,
      hop: 0,
    });
  }

  private participantsOf(chat: StoredChat): MentionableParticipant[] {
    return chat.participants.map(({ botId }) => ({
      botId,
      slug: this.knownBot(botId)?.slug ?? botId,
    }));
  }

  private async decide(
    chat: StoredChat,
    rules: ResolvedChatRules,
    line: TranscriptLine,
  ): Promise<TurnDecision> {
    await this.rememberBots(chat);
    return targetsFor({
      participants: this.participantsOf(chat),
      rules,
      line,
      botName: (botId) => this.knownBot(botId)?.displayName ?? botId,
    });
  }

  /** Deliveries run in parallel; a bot that cannot take the line leaves a notice, not silence. */
  private async fanOut(
    chatId: string,
    decision: TurnDecision,
    line: TranscriptLine,
  ): Promise<void> {
    if (decision.notice) await this.appendSystem(chatId, decision.notice);
    const results = await Promise.allSettled(
      decision.targets.map((botId) => this.deliver(chatId, botId, [line])),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") continue;
      const botId = decision.targets[index]!;
      const bot = await this.deps.bots.get(botId);
      this.logger.warn({ chatId, botId, err: result.reason }, "chat.delivery.failed");
      await this.appendSystem(
        chatId,
        `⚠️ ${bot?.displayName ?? botId} could not take the message: ${errorLine(result.reason)}`,
      );
    }
  }

  /** §2.6: resolve the session, render the window, prompt, expect the turn, mark delivered. */
  private async deliver(chatId: string, botId: string, lines: TranscriptLine[]): Promise<void> {
    const chat = await this.deps.store.require(chatId);
    const participant = chat.participants.find((entry) => entry.botId === botId);
    const bot = await this.deps.bots.get(botId);
    if (!participant || !bot) throw new Error(`Bot ${botId} is not in chat ${chatId}`);
    const rules = resolveChatRules(chat.rules);
    const title = sessionTitleFor(chat.title, lines[0]?.text ?? "");
    const session = await this.deps.botSessions.resolve(chat, bot, title);
    if (session.replaced) await this.appendSystem(chatId, replacementNotice(bot, session.replaced));
    const window = await this.deps
      .transcriptOf(chatId)
      .since(participant.deliveredSeq, rules.context.maxMessages);
    const deliveredSeq = Math.max(...[...window, ...lines].map((entry) => entry.seq));
    await this.rememberBots(chat);
    const prompt = renderChatPrompt({
      botId,
      window,
      triggering: lines,
      botOf: (id) => this.knownBot(id),
    });
    if (prompt !== "") await this.prompt(chat, bot, session.agentId, rules, lines, prompt);
    await this.deps.store.markDelivered(chatId, botId, deliveredSeq);
  }

  private async prompt(
    chat: StoredChat,
    bot: ChatBot,
    agentId: string,
    rules: ResolvedChatRules,
    lines: TranscriptLine[],
    prompt: string,
  ): Promise<void> {
    this.tracker.watch(agentId, chat.id, bot.id);
    const result = await this.deps.sendPrompt({
      agentId,
      prompt,
      messageId: lines.at(-1)!.id,
      ...(rules.interaction.whenBusy === "steer" ? { activeTurnBehavior: "steer" } : {}),
    });
    this.tracker.expect(agentId, {
      messageIds: lines.map((line) => line.id),
      hop: Math.max(...lines.map((line) => line.hop)),
      disposition: result.disposition,
    });
  }

  private knownBot(botId: string): { slug: string; displayName: string } | null {
    return this.botNames.get(botId) ?? null;
  }

  private async rememberBots(chat: StoredChat): Promise<void> {
    for (const { botId } of chat.participants) {
      const bot = await this.deps.bots.get(botId);
      if (bot) this.botNames.set(botId, { slug: bot.slug, displayName: bot.displayName });
    }
  }

  /** §2.7: the turn's final text becomes a bot line, then its mentions are forwarded. */
  onTurnCompleted(outcome: TurnOutcome): Promise<void> {
    const work = this.appendReply(outcome);
    this.track(work);
    return work;
  }

  private async appendReply(outcome: TurnOutcome): Promise<void> {
    const chat = await this.deps.store.get(outcome.chatId);
    if (!chat || chat.archivedAt) return;
    const bot = await this.deps.bots.get(outcome.botId);
    if (outcome.text === null) {
      if (outcome.expectation)
        await this.appendSystem(
          chat.id,
          `⚠️ ${bot?.displayName ?? outcome.botId} finished without a reply.`,
        );
      return;
    }
    const line = await this.appendLine(chat.id, {
      id: resolveClientMessageId(undefined),
      at: this.now(),
      sender: { kind: "bot", botId: outcome.botId },
      text: outcome.text,
      reply: { agentId: outcome.agentId, turnId: outcome.turnId, ...outcome.lastRow },
      ...(outcome.expectation ? { inReplyTo: outcome.expectation.messageIds.at(-1)! } : {}),
      hop: (outcome.expectation?.hop ?? 0) + 1,
    });
    const decision = await this.decide(chat, resolveChatRules(chat.rules), line);
    this.track(this.fanOut(chat.id, decision, line));
  }

  onTurnFailed(outcome: TurnOutcome, error: string): Promise<void> {
    const work = this.appendFailure(outcome, error);
    this.track(work);
    return work;
  }

  private async appendFailure(outcome: TurnOutcome, error: string): Promise<void> {
    const chat = await this.deps.store.get(outcome.chatId);
    if (!chat || chat.archivedAt) return;
    const bot = await this.deps.bots.get(outcome.botId);
    await this.appendSystem(
      chat.id,
      `⚠️ ${bot?.displayName ?? outcome.botId} stopped with an error: ${errorLine(error)}`,
    );
  }

  /** The record as the app sees it. */
  async payload(chat: StoredChat): Promise<ChatPayload> {
    await this.rememberBots(chat);
    return chatPayload(chat, (botId) => this.knownBot(botId));
  }
}

function duplicateSend(existing: TranscriptLine, text: string): SendMessageResult {
  if (existing.text !== text)
    throw new Error(`Message ${existing.id} already exists with different text`);
  return { messageId: existing.id, seq: existing.seq, targets: [], duplicate: true };
}

function replacementNotice(bot: ChatBot, reason: "could_not_resume" | "archived"): string {
  return reason === "archived"
    ? `${bot.displayName}'s previous session was archived; a new one starts here.`
    : `${bot.displayName}'s previous session could not resume; a new one starts here.`;
}

function errorLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = message.replace(/\s+/gu, " ").trim();
  if (line === "") return "unknown error";
  return line.length > NOTICE_ERROR_MAX_CHARS ? `${line.slice(0, NOTICE_ERROR_MAX_CHARS)}…` : line;
}
