// `createChatService`: wires the store, the transcripts, the sessions and the
// engine into the one object the Session handlers and bootstrap talk to
// (docs/features/bots-and-chats/plans/server-chat.md). Only built when
// `daemon.bots.enabled` is on; off, nothing here is constructed.
import type { Logger } from "pino";
import type { ChatPayload, ChatRules } from "@getpaseo/protocol/chats/types";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import { ensureAgentLoaded } from "../agent/agent-loading.js";
import type { AgentManager } from "../agent/agent-manager.js";
import { sendPromptToAgent } from "../agent/agent-prompt.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { AgentTimelineStore } from "../agent/agent-timeline-store-types.js";
import type { BoundCreateAgentCommand } from "../agent/create-agent/create.js";
import { BotSessions } from "./bot-sessions.js";
import { reconcileChats } from "./reconcile.js";
import {
  ChatEngine,
  type BotLookup,
  type ChatPublisher,
  type SendMessageInput,
  type SendMessageResult,
} from "./chat-engine.js";
import { ChatStore } from "./chat-store.js";
import {
  TranscriptLog,
  type TranscriptFetchOptions,
  type TranscriptWindow,
} from "./transcript-log.js";

export interface ChatServiceOptions {
  /** `$PASEO_HOME/chats`; created on the first chat, never at start. */
  rootDir: string;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  createAgent: BoundCreateAgentCommand;
  bots: BotLookup;
  publisher: ChatPublisher;
  /** The durable session store, when session storage is on; restart reconciliation reads it. */
  durableTimelineStore?: Pick<AgentTimelineStore, "getSubmittedUserMessage" | "getEpoch">;
  logger: Logger;
}

export interface CreateChatServiceInput {
  botIds: readonly string[];
  kind?: "direct" | "group";
  title?: string | null;
  rules?: ChatRules;
  createdBy?: SessionActor;
  /** Sent after the record is written, so "create by typing" is one round trip. */
  firstMessage?: { text: string; messageId?: string };
}

export interface ChatService {
  record(chatId: string): import("./chat-record.js").StoredChat | null;
  subscribe(
    listener: (message: import("../messages.js").SessionOutboundMessage) => void,
  ): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  create(
    input: CreateChatServiceInput,
  ): Promise<{ chat: ChatPayload; sent: SendMessageResult | null }>;
  list(includeArchived?: boolean): Promise<ChatPayload[]>;
  get(chatId: string): Promise<ChatPayload | null>;
  /** The bot ids a Managed Access check must cover, or `null` for an unknown chat. */
  participantBotIds(chatId: string): Promise<string[] | null>;
  addParticipant(chatId: string, botId: string): Promise<ChatPayload>;
  removeParticipant(chatId: string, botId: string): Promise<ChatPayload>;
  archive(chatId: string): Promise<ChatPayload>;
  send(input: SendMessageInput): Promise<SendMessageResult>;
  fetchTranscript(chatId: string, options?: TranscriptFetchOptions): Promise<TranscriptWindow>;
  /** `/new` for one bot in one chat (D7). */
  newSession(chatId: string, botId: string): Promise<void>;
}

export function createChatService(options: ChatServiceOptions): ChatService {
  const { agentManager, agentStorage, logger } = options;
  const listeners = new Set<(message: import("../messages.js").SessionOutboundMessage) => void>();
  const publisher: ChatPublisher = {
    chatUpdated(chat) {
      options.publisher.chatUpdated(chat);
      for (const listener of listeners) listener({ type: "chat.updated", payload: { chat } });
    },
    transcriptAppended(chatId, line) {
      options.publisher.transcriptAppended(chatId, line);
      for (const listener of listeners)
        listener({ type: "chat.transcript.appended", payload: { chatId, line } });
    },
  };
  const store = new ChatStore(options.rootDir, logger);
  const transcripts = new Map<string, TranscriptLog>();
  const transcriptOf = (chatId: string): TranscriptLog => {
    let log = transcripts.get(chatId);
    if (!log) {
      log = new TranscriptLog(store.directory(chatId));
      transcripts.set(chatId, log);
    }
    return log;
  };
  const botSessions = new BotSessions({
    agentStorage,
    store,
    createAgent: options.createAgent,
    ensureLoaded: (agentId) => ensureAgentLoaded(agentId, { agentManager, agentStorage, logger }),
  });
  const engine = new ChatEngine({
    store,
    transcriptOf,
    bots: options.bots,
    botSessions,
    agentManager,
    publisher,
    logger,
    sendPrompt: (params) =>
      sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId: params.agentId,
        prompt: params.prompt,
        messageId: params.messageId,
        ...(params.activeTurnBehavior ? { activeTurnBehavior: params.activeTurnBehavior } : {}),
        unarchive: false,
        clearPendingPermissions: false,
        logger,
      }),
  });
  let unsubscribe: (() => void) | null = null;

  const payload = async (chatId: string): Promise<ChatPayload> =>
    engine.payload(await store.require(chatId));

  /** §3: replies that ended while the daemon was down, backfilled in the background. */
  const reconcile = (): Promise<void> =>
    reconcileChats({
      store,
      transcriptOf,
      bots: options.bots,
      appendLine: (chatId, input) => engine.appendLine(chatId, input),
      isRunning: (agentId) => agentManager.getAgent(agentId)?.lifecycle === "running",
      findSubmittedRow: async (agentId, messageId) => {
        const durable = options.durableTimelineStore;
        const row = await durable?.getSubmittedUserMessage?.(agentId, messageId);
        const epoch = row ? await durable?.getEpoch?.(agentId) : undefined;
        return row && epoch ? { epoch, seq: row.seq } : null;
      },
      rowsAfter: async (agentId, cursor) =>
        (await agentManager.fetchTimelineForRead(agentId, { direction: "after", cursor, limit: 0 }))
          .rows,
      logger,
    });

  return {
    record: (chatId) => store.getCached(chatId),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start() {
      await store.load();
      unsubscribe ??= store.subscribe((chat) => {
        void engine
          .payload(chat)
          .then((summary) => publisher.chatUpdated(summary))
          .catch((error: unknown) =>
            logger.warn({ chatId: chat.id, err: error }, "chat.updated.publish_failed"),
          );
      });
      for (const chat of await store.list()) {
        for (const participant of chat.participants) {
          if (participant.agentId)
            engine.tracker.watch(participant.agentId, chat.id, participant.botId);
        }
      }
      await reconcile().catch((error: unknown) =>
        logger.warn({ err: error }, "chat.reconcile.failed"),
      );
    },
    async stop() {
      unsubscribe?.();
      unsubscribe = null;
      engine.stop();
      await engine.idle();
      await store.idle();
      await Promise.all(Array.from(transcripts.values()).map((log) => log.flush()));
    },
    async create(input) {
      const chat = await store.create({
        botIds: input.botIds,
        kind: input.kind,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.rules ? { rules: input.rules } : {}),
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      });
      const sent = input.firstMessage
        ? await engine.send({
            chatId: chat.id,
            text: input.firstMessage.text,
            ...(input.firstMessage.messageId ? { messageId: input.firstMessage.messageId } : {}),
            ...(input.createdBy ? { actor: input.createdBy } : {}),
          })
        : null;
      return { chat: await payload(chat.id), sent };
    },
    async list(includeArchived = false) {
      const chats = (await store.list()).filter((chat) => includeArchived || !chat.archivedAt);
      return Promise.all(chats.map((chat) => engine.payload(chat)));
    },
    async get(chatId) {
      const chat = await store.get(chatId);
      return chat ? engine.payload(chat) : null;
    },
    async participantBotIds(chatId) {
      const chat = await store.get(chatId);
      return chat ? chat.participants.map((entry) => entry.botId) : null;
    },
    async addParticipant(chatId, botId) {
      if (!(await options.bots.get(botId))) throw new Error(`Bot ${botId} not found`);
      return engine.payload(await store.addParticipant(chatId, botId));
    },
    async removeParticipant(chatId, botId) {
      return engine.payload(await store.removeParticipant(chatId, botId));
    },
    async archive(chatId) {
      return engine.payload(await store.archive(chatId));
    },
    send: (input) => engine.send(input),
    fetchTranscript: async (chatId, fetchOptions) => {
      await store.require(chatId);
      return transcriptOf(chatId).fetch(fetchOptions);
    },
    newSession: (chatId, botId) => engine.newSession(chatId, botId),
  };
}
