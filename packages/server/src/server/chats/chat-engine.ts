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
  agentManager: Pick<AgentManager, "subscribe" | "getAgent">;
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
  // Serialize prompt admission per session, never the running turn or the whole bot.
  private readonly deliveries = new KeyedSerialQueue();
  private readonly finalizing = new KeyedSerialQueue();
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
      const inputLine = {
        id,
        at: this.now(),
        sender: { kind: "user" as const, ...(input.actor ? { actor: input.actor } : {}) },
        text: input.text,
        hop: 0,
      };
      const decision = await this.decide(chat, rules, { ...inputLine, seq: 0 });
      const line = await this.appendLine(chat.id, {
        ...inputLine,
        deliveryBotIds: decision.targets,
      });
      this.track(this.fanOut(chat.id, decision, line));
      return { messageId: id, seq: line.seq, targets: decision.targets, duplicate: false };
    });
  }

  /** `/new` (D7): the next delivery to this bot starts a fresh session. */
  newSession(chatId: string, botId: string): Promise<void> {
    return this.changeIdleParticipant(chatId, botId, async (agentId) => {
      const bot = await this.deps.bots.get(botId);
      await this.deps.botSessions.reset(chatId, botId);
      if (agentId) this.tracker.unwatch(agentId);
      await this.appendSystem(
        chatId,
        `${bot?.displayName ?? botId} will start a new session on the next message.`,
      );
    });
  }

  removeParticipant(chatId: string, botId: string): Promise<StoredChat> {
    return this.changeIdleParticipant(chatId, botId, async (agentId) => {
      const chat = await this.deps.store.removeParticipant(chatId, botId);
      if (agentId) this.tracker.unwatch(agentId);
      return chat;
    });
  }

  /** Serialize membership changes with admission, never serialize independent running bots. */
  private changeIdleParticipant<T>(
    chatId: string,
    botId: string,
    change: (agentId: string | null) => Promise<T>,
  ): Promise<T> {
    return this.queue.run(chatId, async () => {
      const key = `${chatId}:${botId}`;
      if (this.deliveries.hasPending(key) || this.finalizing.hasPending(key))
        throw new Error("Bot is receiving a message. Wait before resetting or removing it.");
      return this.deliveries.run(key, async () => {
        const chat = await this.deps.store.require(chatId);
        const participant = chat.participants.find((entry) => entry.botId === botId);
        if (!participant) throw new Error("Bot is not a participant in this Chat");
        const agentId = participant.agentId;
        const agent = agentId ? this.deps.agentManager.getAgent(agentId) : null;
        if (
          agent &&
          (agent.lifecycle === "running" ||
            agent.lifecycle === "initializing" ||
            agent.pendingPermissions.size > 0 ||
            agent.inFlightPermissionResponses.size > 0)
        )
          throw new Error(
            "Bot is running or waiting for approval. Finish or stop its work before resetting or removing it.",
          );
        return change(agentId);
      });
    });
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

  private outcomeScope(outcome: TurnOutcome): Partial<TranscriptLineInput> {
    return {
      deliveryBotIds: [outcome.botId],
      reply: { agentId: outcome.agentId, turnId: outcome.turnId },
      ...(outcome.expectation ? { inReplyTo: outcome.expectation.messageIds.at(-1) } : {}),
    };
  }

  private appendSystem(
    chatId: string,
    text: string,
    scope: Partial<TranscriptLineInput> = {},
  ): Promise<TranscriptLine> {
    return this.appendLine(chatId, {
      id: resolveClientMessageId(undefined),
      at: this.now(),
      ...scope,
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
      decision.targets.map((botId) =>
        this.deliveries.run(`${chatId}:${botId}`, () => this.deliver(chatId, botId, [line])),
      ),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") continue;
      const botId = decision.targets[index]!;
      const bot = await this.deps.bots.get(botId);
      this.logger.warn({ chatId, botId, err: result.reason }, "chat.delivery.failed");
      await this.appendSystem(
        chatId,
        `⚠️ ${bot?.displayName ?? botId} could not take the message: ${errorLine(result.reason)}`,
        { deliveryBotIds: [botId], inReplyTo: line.id },
      );
    }
  }

  /** §2.6: resolve the session, render the window, prompt, expect the turn, mark delivered. */
  private async deliver(chatId: string, botId: string, lines: TranscriptLine[]): Promise<void> {
    const chat = await this.deps.store.require(chatId);
    if (chat.archivedAt) throw new Error(`Chat ${chatId} is archived`);
    const participant = chat.participants.find((entry) => entry.botId === botId);
    const bot = await this.deps.bots.get(botId);
    if (!participant || !bot) throw new Error(`Bot ${botId} is not in chat ${chatId}`);
    // A later queued delivery may already have included this trigger as context.
    // The per-pair queue makes the persisted watermark authoritative at admission.
    lines = lines.filter((line) => line.seq > participant.deliveredSeq);
    if (lines.length === 0) return;
    const rules = resolveChatRules(chat.rules);
    const title = sessionTitleFor(chat.title, lines[0]?.text ?? "");
    const session = await this.deps.botSessions.resolve(chat, bot, title);
    if (session.replaced) await this.appendSystem(chatId, replacementNotice(bot, session.replaced));
    const deliveredSeq = Math.max(...lines.map((entry) => entry.seq));
    // A concurrent send can already be in the log. It belongs to its own dispatch,
    // never this prompt's context or delivery watermark.
    const page = await this.deps.transcriptOf(chatId).fetch({
      direction: "before",
      cursor: { seq: deliveredSeq + 1 },
      limit: rules.context.maxMessages,
    });
    const window = page.lines.filter((entry) => entry.seq > participant.deliveredSeq);
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
    await this.tracker.dispatch(
      agentId,
      {
        messageIds: lines.map((line) => line.id),
        hop: Math.max(...lines.map((line) => line.hop)),
      },
      () =>
        this.deps.sendPrompt({
          agentId,
          prompt,
          messageId: lines.at(-1)!.id,
          ...(rules.interaction.whenBusy === "steer"
            ? { activeTurnBehavior: "steer" as const }
            : {}),
        }),
    );
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
    const work = this.finalizing.run(`${outcome.chatId}:${outcome.botId}`, () =>
      this.appendReply(outcome),
    );
    this.track(work);
    return work;
  }

  private async appendReply(outcome: TurnOutcome): Promise<void> {
    const chat = await this.deps.store.get(outcome.chatId);
    if (
      !chat ||
      chat.archivedAt ||
      !chat.participants.some(
        (entry) => entry.botId === outcome.botId && entry.agentId === outcome.agentId,
      )
    )
      return;
    if (outcome.expectation) {
      const recorded = await this.deps.store.recordCompletedTurn(chat.id, outcome.botId, {
        agentId: outcome.agentId,
        turnId: outcome.turnId,
        messageIds: outcome.expectation.messageIds,
        lastRow: outcome.lastRow,
      });
      if (
        !recorded.participants.some(
          (entry) => entry.botId === outcome.botId && entry.agentId === outcome.agentId,
        )
      )
        return;
    }
    const bot = await this.deps.bots.get(outcome.botId);
    if (outcome.text === null) {
      if (outcome.expectation)
        await this.appendSystem(
          chat.id,
          `⚠️ ${bot?.displayName ?? outcome.botId} finished without a reply.`,
          this.outcomeScope(outcome),
        );
      return;
    }
    const replyInput: TranscriptLineInput = {
      id: resolveClientMessageId(undefined),
      at: this.now(),
      sender: { kind: "bot", botId: outcome.botId },
      text: outcome.text,
      reply: { agentId: outcome.agentId, turnId: outcome.turnId, ...outcome.lastRow },
      ...(outcome.expectation ? { inReplyTo: outcome.expectation.messageIds.at(-1)! } : {}),
      hop: (outcome.expectation?.hop ?? 0) + 1,
    };
    const decision = await this.decide(chat, resolveChatRules(chat.rules), {
      ...replyInput,
      seq: 0,
    });
    const line = await this.appendLine(chat.id, {
      ...replyInput,
      deliveryBotIds: decision.targets,
    });
    this.track(this.fanOut(chat.id, decision, line));
  }

  onTurnFailed(outcome: TurnOutcome, error: string): Promise<void> {
    const work = this.finalizing.run(`${outcome.chatId}:${outcome.botId}`, () =>
      this.appendFailure(outcome, error),
    );
    this.track(work);
    return work;
  }

  private async appendFailure(outcome: TurnOutcome, error: string): Promise<void> {
    const chat = await this.deps.store.get(outcome.chatId);
    if (
      !chat ||
      chat.archivedAt ||
      !chat.participants.some(
        (entry) => entry.botId === outcome.botId && entry.agentId === outcome.agentId,
      )
    )
      return;
    const bot = await this.deps.bots.get(outcome.botId);
    await this.appendSystem(
      chat.id,
      `⚠️ ${bot?.displayName ?? outcome.botId} stopped with an error: ${errorLine(error)}`,
      this.outcomeScope(outcome),
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
