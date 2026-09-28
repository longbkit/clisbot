import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { AgentPromptInput } from "../agent/agent-sdk-types.js";
// `ChatEngine`: a user line is written, then fanned out; a bot's turn end is
// written as a bot line, then forwarded to the bots it mentions
// (docs/features/bots-and-chats/README.md, D5, D9; plans/server-chat.md §2).
// Every prompt goes through one delivery path; every bound that runs out ends
// in a `system` line, never in silence.
import type { Logger } from "pino";
import type { ChatMessagePayload, ChatPayload } from "@getpaseo/protocol/chats/types";
import { chatUserSender } from "@getpaseo/protocol/chats/sender";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import type { AgentManager } from "../agent/agent-manager.js";
import type { PromptDispatchDisposition } from "../agent/agent-prompt.js";
import { resolveClientMessageId } from "../client-message-id.js";
import type { BotSessions } from "./bot-sessions.js";
import {
  chatKindOf,
  chatPayload,
  resolveChatRules,
  type ChatBot,
  type ResolvedChatRules,
  type StoredChat,
} from "./chat-record.js";
import type { ChatStore } from "./chat-store.js";
import { renderChatPrompt, sessionTitleFor } from "./context-prompt.js";
import { KeyedSerialQueue } from "./keyed-queue.js";
import {
  isSilentReply,
  renderRoomContract,
  roomFingerprint,
  type RoomContractInput,
  type RoomMember,
} from "./room-contract.js";
import {
  agentPromptFor,
  botReplyLine,
  duplicateSend,
  errorLine,
  messageContentDigest,
  replacementNotice,
  roomUpdateFor,
} from "./chat-engine-lines.js";
import { ChatDiscussions, discussionOpening } from "./discussion.js";
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
  prompt: AgentPromptInput;
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
  agentManager: Pick<AgentManager, "subscribe" | "getAgent" | "cancelAgentRun">;
  sendPrompt: ChatPromptSender;
  publisher: ChatPublisher;
  logger: Logger;
  now?: () => string;
}

export interface ChatMessageFiles {
  images?: { data: string; mimeType: string }[];
  attachments?: AgentAttachment[];
}
export type PrepareChatMessageFiles = (
  directory: string,
  messageId: string,
  files: ChatMessageFiles,
) => Promise<ChatMessageFiles & { release?: () => Promise<void> }>;

export interface SendMessageInput extends ChatMessageFiles {
  prepareFiles?: PrepareChatMessageFiles;
  spokenInputAgentId?: string;
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

export class ChatEngine implements TurnTrackerHost {
  readonly tracker: TurnTracker;
  private readonly discussions: ChatDiscussions;
  private readonly queue = new KeyedSerialQueue();
  // Serialize prompt admission per session, never the running turn or the whole bot.
  private readonly deliveries = new KeyedSerialQueue();
  private readonly finalizing = new KeyedSerialQueue();
  private readonly inFlight = new Set<Promise<unknown>>();
  /** Sender-line names of every bot seen in a chat, so rendering never awaits a lookup. */
  private readonly botNames = new Map<string, RoomMember>();
  private readonly logger: Logger;
  private readonly now: () => string;

  constructor(private readonly deps: ChatEngineDependencies) {
    this.logger = deps.logger.child({ module: "chats", component: "chat-engine" });
    this.now = deps.now ?? (() => new Date().toISOString());
    this.tracker = new TurnTracker(deps.agentManager, this, this.logger);
    this.discussions = new ChatDiscussions({
      store: deps.store,
      transcriptOf: deps.transcriptOf,
      rulesOf: (chat) => resolveChatRules(chat.rules),
      members: (chat) => this.members(chat),
      wake: (chatId, botId, lines, cue) => this.wake(chatId, botId, lines, cue),
      notice: (chatId, text) => this.appendSystem(chatId, text),
    });
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
      if (existing) return duplicateSend(existing, input);
      const files = input.prepareFiles
        ? await input.prepareFiles(this.deps.transcriptOf(chat.id).directory, id, input)
        : { images: input.images, attachments: input.attachments, release: undefined };
      if (
        !input.prepareFiles &&
        input.attachments?.some(
          (a) => a.type === "uploaded_file" || (a.type === "text" && a.sourceSession),
        )
      )
        throw new Error("Attachment preparation is unavailable");
      const inputLine = {
        images: files.images,
        attachments: files.attachments,
        attachmentContentDigest: messageContentDigest(input),
        id,
        at: this.now(),
        sender: chatUserSender(input.actor),
        text: input.text,
        ...(input.spokenInputAgentId ? { spokenInputAgentId: input.spokenInputAgentId } : {}),
        hop: 0,
      };
      const discussion =
        chatKindOf(chat) === "group" && !input.spokenInputAgentId
          ? discussionOpening(await this.members(chat), rules, input.text)
          : null;
      const decision = discussion ?? (await this.decide(chat, rules, { ...inputLine, seq: 0 }));
      const line = await this.appendLine(chat.id, {
        ...inputLine,
        deliveryBotIds: decision.targets,
      });
      await files
        .release?.()
        .catch((error) => this.deps.logger.warn({ error }, "Chat upload cleanup failed"));
      // Every user line in a group takes the floor: it opens a discussion or ends the running one.
      if (discussion && discussion.targets.length > 0)
        this.track(this.discussions.start(chat.id, discussion.mode, discussion.targets));
      else if (discussion) this.discussions.stop(chat.id);
      else this.track(this.fanOut(chat.id, decision, line));
      return { messageId: id, seq: line.seq, targets: decision.targets, duplicate: false };
    });
  }

  /**
   * Stop all: ends the discussion and interrupts every bot turn running in the chat. Returns
   * whether anything was stopped.
   */
  async stopDiscussion(chatId: string): Promise<boolean> {
    const chat = await this.deps.store.require(chatId);
    let stopped = this.discussions.stop(chatId);
    for (const { agentId } of chat.participants) {
      const lifecycle = agentId ? this.deps.agentManager.getAgent(agentId)?.lifecycle : undefined;
      if (!agentId || (lifecycle !== "running" && lifecycle !== "initializing")) continue;
      await this.deps.agentManager.cancelAgentRun(agentId);
      stopped = true;
    }
    if (stopped) await this.appendSystem(chatId, "⏹ Stopped by the user.");
    return stopped;
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

  private async members(chat: StoredChat): Promise<MentionableParticipant[]> {
    await this.rememberBots(chat);
    return this.participantsOf(chat);
  }

  private participantsOf(chat: StoredChat): MentionableParticipant[] {
    return chat.participants.map(({ botId }) => ({
      botId,
      slug: this.knownBot(botId)?.slug ?? botId,
      displayName: this.knownBot(botId)?.displayName,
    }));
  }

  private async decide(
    chat: StoredChat,
    rules: ResolvedChatRules,
    line: TranscriptLine,
  ): Promise<TurnDecision> {
    if (line.sender.kind === "user" && line.spokenInputAgentId) {
      const participant = chat.participants.find(
        (entry) => entry.agentId === line.spokenInputAgentId,
      );
      if (!participant) throw new Error("Voice session is no longer an active Chat participant");
      const bot = await this.deps.bots.get(participant.botId);
      if (!bot) throw new Error("Voice bot is unavailable");
      return { targets: [participant.botId] };
    }
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
      await this.appendDeliveryFailure(chatId, decision.targets[index]!, result.reason, line.id);
    }
  }

  /** A discussion turn; a bot that cannot take it leaves a notice and the room moves on. */
  private async wake(
    chatId: string,
    botId: string,
    lines: TranscriptLine[],
    cue: string,
  ): Promise<boolean> {
    try {
      return await this.deliveries.run(`${chatId}:${botId}`, () =>
        this.deliver(chatId, botId, lines, cue),
      );
    } catch (error) {
      await this.appendDeliveryFailure(chatId, botId, error, lines.at(-1)?.id);
      return false;
    }
  }

  private async appendDeliveryFailure(
    chatId: string,
    botId: string,
    error: unknown,
    inReplyTo: string | undefined,
  ): Promise<void> {
    const bot = await this.deps.bots.get(botId);
    this.logger.warn({ chatId, botId, err: error }, "chat.delivery.failed");
    await this.appendSystem(
      chatId,
      `⚠️ ${bot?.displayName ?? botId} could not take the message: ${errorLine(error)}`,
      { deliveryBotIds: [botId], inReplyTo },
    );
  }

  /**
   * §2.6: resolve the session, render the window, prompt, expect the turn, mark delivered.
   * Resolves `true` when a turn was started; `cue` ends the prompt of a discussion turn.
   */
  private async deliver(
    chatId: string,
    botId: string,
    lines: TranscriptLine[],
    cue?: string,
  ): Promise<boolean> {
    const chat = await this.deps.store.require(chatId);
    if (chat.archivedAt) throw new Error(`Chat ${chatId} is archived`);
    const participant = chat.participants.find((entry) => entry.botId === botId);
    const bot = await this.deps.bots.get(botId);
    if (!participant || !bot) throw new Error(`Bot ${botId} is not in chat ${chatId}`);
    // A later queued delivery may already have included this trigger as context.
    // The per-pair queue makes the persisted watermark authoritative at admission.
    lines = lines.filter((line) => line.seq > participant.deliveredSeq);
    if (lines.length === 0) return false;
    const rules = resolveChatRules(chat.rules);
    const title = sessionTitleFor(chat.title, lines[0]?.text ?? "");
    await this.rememberBots(chat);
    const room = this.roomOf(chat, botId);
    const session = await this.deps.botSessions.resolve(
      chat,
      bot,
      title,
      room ? renderRoomContract(room) : undefined,
    );
    if (session.replaced) await this.appendSystem(chatId, replacementNotice(bot, session.replaced));
    const deliveredSeq = Math.max(...lines.map((entry) => entry.seq));
    const window = await this.windowOf(chatId, participant.deliveredSeq, deliveredSeq, rules);
    const prompt = renderChatPrompt({
      botId,
      window,
      triggering: lines,
      botOf: (id) => this.knownBot(id),
    });
    let started = prompt !== "";
    if (started) {
      const update = room && !session.created ? roomUpdateFor(room, participant.roomSeen) : null;
      const text = [update, prompt, cue].filter(Boolean).join("\n\n");
      const disposition = await this.prompt(chat, bot, session.agentId, rules, lines, text, window);
      // A duplicate or out-of-band command binds no turn, so nothing will end it.
      if (disposition === "out_of_band") started = false;
    }
    // A new session read the room in its system prompt; a prompted one read it or its update.
    if (room && (prompt !== "" || session.created))
      await this.deps.store.setParticipantRoomSeen(chatId, botId, roomFingerprint(room));
    await this.deps.store.markDelivered(chatId, botId, deliveredSeq);
    return started;
  }

  /**
   * Lines after the bot's watermark up to this delivery. A concurrent send can already be in the
   * log; it belongs to its own dispatch, never this prompt's context or delivery watermark.
   */
  private async windowOf(
    chatId: string,
    after: number,
    upTo: number,
    rules: ResolvedChatRules,
  ): Promise<TranscriptLine[]> {
    const page = await this.deps.transcriptOf(chatId).fetch({
      direction: "before",
      cursor: { seq: upTo + 1 },
      limit: rules.context.maxMessages,
    });
    return page.lines.filter((entry) => entry.seq > after);
  }

  private async prompt(
    chat: StoredChat,
    bot: ChatBot,
    agentId: string,
    rules: ResolvedChatRules,
    lines: TranscriptLine[],
    prompt: string,
    window: TranscriptLine[],
  ): Promise<PromptDispatchDisposition> {
    this.tracker.watch(agentId, chat.id, bot.id);
    return this.tracker.dispatch(
      agentId,
      {
        messageIds: lines.map((line) => line.id),
        hop: Math.max(...lines.map((line) => line.hop)),
      },
      () =>
        this.deps.sendPrompt({
          agentId,
          prompt: agentPromptFor(agentId, prompt, lines, window),
          messageId: lines.at(-1)!.id,
          ...(rules.interaction.whenBusy === "steer"
            ? { activeTurnBehavior: "steer" as const }
            : {}),
        }),
    );
  }

  private knownBot(botId: string): RoomMember | null {
    return this.botNames.get(botId) ?? null;
  }

  private async rememberBots(chat: StoredChat): Promise<void> {
    for (const { botId } of chat.participants) {
      const bot = await this.deps.bots.get(botId);
      if (bot)
        this.botNames.set(botId, {
          slug: bot.slug,
          displayName: bot.displayName,
          description: bot.description ?? null,
        });
    }
  }

  /** The room a group-chat bot is told about; a direct chat has none. Needs `rememberBots`. */
  private roomOf(chat: StoredChat, botId: string): RoomContractInput | null {
    const self = this.knownBot(botId);
    if (chatKindOf(chat) !== "group" || !self) return null;
    const members = chat.participants.flatMap(({ botId: id }) => this.knownBot(id) ?? []);
    const { instructions } = resolveChatRules(chat.rules).room;
    return { chatTitle: chat.title, self, members, instructions };
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
    const chat = await this.currentChatOf(outcome);
    if (!chat || !(await this.recordCompletedTurn(chat, outcome)))
      return this.releaseFloor(outcome);
    if (chatKindOf(chat) === "group") return this.appendGroupReply(chat, outcome);
    if (outcome.text === null) {
      if (outcome.expectation) {
        const bot = await this.deps.bots.get(outcome.botId);
        await this.appendSystem(
          chat.id,
          `⚠️ ${bot?.displayName ?? outcome.botId} finished without a reply.`,
          this.outcomeScope(outcome),
        );
      }
      return;
    }
    const replyInput = botReplyLine(outcome, outcome.text, this.now());
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

  /** The outcome's chat, unless it was archived or the bot's session is no longer its own. */
  private async currentChatOf(outcome: TurnOutcome): Promise<StoredChat | null> {
    const chat = await this.deps.store.get(outcome.chatId);
    return chat && !chat.archivedAt && isCurrentSession(chat, outcome) ? chat : null;
  }

  /** Records an expected turn; `false` when the session was replaced while it was recorded. */
  private async recordCompletedTurn(chat: StoredChat, outcome: TurnOutcome): Promise<boolean> {
    if (!outcome.expectation) return true;
    const recorded = await this.deps.store.recordCompletedTurn(chat.id, outcome.botId, {
      agentId: outcome.agentId,
      turnId: outcome.turnId,
      messageIds: outcome.expectation.messageIds,
      lastRow: outcome.lastRow,
    });
    return isCurrentSession(recorded, outcome);
  }

  /**
   * In a group, silence is a valid turn and the discussion, not the reply's mentions, decides
   * who speaks next (plans/group-discussion.md).
   */
  private async appendGroupReply(chat: StoredChat, outcome: TurnOutcome): Promise<void> {
    const spoke = !isSilentReply(outcome.text);
    if (spoke)
      await this.appendLine(chat.id, {
        ...botReplyLine(outcome, outcome.text!, this.now()),
        deliveryBotIds: [],
      });
    this.track(this.discussions.turnEnded(chat.id, outcome.botId, spoke));
  }

  /** Stopping the bot that holds the floor ends the discussion: the user took the floor. */
  onTurnStopped(chatId: string, botId: string): void {
    this.discussions.stopIfSpeaking(chatId, botId);
  }

  /**
   * A turn that ends without a reply line (its session was replaced, or the chat archived) still
   * ends that bot's turn in the discussion. While it holds the floor it has no newer turn.
   */
  private releaseFloor(outcome: TurnOutcome): void {
    this.track(this.discussions.turnEnded(outcome.chatId, outcome.botId, false));
  }

  onTurnFailed(outcome: TurnOutcome, error: string): Promise<void> {
    const work = this.finalizing.run(`${outcome.chatId}:${outcome.botId}`, () =>
      this.appendFailure(outcome, error),
    );
    this.track(work);
    return work;
  }

  private async appendFailure(outcome: TurnOutcome, error: string): Promise<void> {
    const chat = await this.currentChatOf(outcome);
    if (!chat) return this.releaseFloor(outcome);
    const bot = await this.deps.bots.get(outcome.botId);
    await this.appendSystem(
      chat.id,
      `⚠️ ${bot?.displayName ?? outcome.botId} stopped with an error: ${errorLine(error)}`,
      this.outcomeScope(outcome),
    );
    this.track(this.discussions.turnEnded(chat.id, outcome.botId, false));
  }

  /** The record as the app sees it. */
  async payload(chat: StoredChat): Promise<ChatPayload> {
    await this.rememberBots(chat);
    return chatPayload(chat, (botId) => this.knownBot(botId));
  }
}

/** Whether the outcome's session is still the one this bot uses in the chat. */
function isCurrentSession(chat: StoredChat, outcome: TurnOutcome): boolean {
  return chat.participants.some(
    (entry) => entry.botId === outcome.botId && entry.agentId === outcome.agentId,
  );
}
