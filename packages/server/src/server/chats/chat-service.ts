import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import type { BotLaunchDefaults } from "@clisbot/protocol/bots/types";
import { sessionActorKey } from "@clisbot/protocol/session-authorship";
// `createChatService`: wires the store, the transcripts, the sessions and the
// engine into the one object the Session handlers and bootstrap talk to
// (docs/features/bots-and-chats/plans/server-chat.md). Only built when
// `daemon.bots.enabled` is on; off, nothing here is constructed.
import type { Logger } from "pino";
import type { ChatPayload, ChatRules } from "@clisbot/protocol/chats/types";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
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
  type ScheduledLineInput,
  type ScheduledLineResult,
  type SendMessageResult,
} from "./chat-engine.js";
import { ChatStore } from "./chat-store.js";
import {
  TranscriptLog,
  type TranscriptFetchOptions,
  type TranscriptWindow,
} from "./transcript-log.js";

export interface ChatServiceOptions {
  /** `$CLISBOT_HOME/chats`; created on the first chat, never at start. */
  rootDir: string;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  createAgent: BoundCreateAgentCommand;
  bots: BotLookup;
  publisher: ChatPublisher;
  /** The durable session store, when session storage is on; restart reconciliation reads it. */
  durableTimelineStore?: Pick<AgentTimelineStore, "getSubmittedUserMessage" | "getEpoch">;
  /** Heartbeats follow a Bot's fresh session in a Chat. */
  schedules?: { retargetAgent(fromAgentId: string, toAgentId: string): Promise<number> };
  logger: Logger;
}

export interface CreateChatServiceInput {
  launch?: BotLaunchDefaults;
  idempotencyKey?: string;
  botIds: readonly string[];
  kind?: "direct" | "group";
  title?: string | null;
  rules?: ChatRules;
  createdBy?: SessionActor;
  /** Sent after the record is written, so "create by typing" is one round trip. */
  firstMessage?: Omit<SendMessageInput, "chatId" | "actor">;
}

export interface ChatService {
  update(
    chatId: string,
    patch: import("@clisbot/protocol/chats/rpc-schemas").ChatUpdatePatch,
  ): Promise<ChatPayload>;
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
  /** A heartbeat run that goes through the Chat (docs/audits/2026-10-06-conversation-schedules.md). */
  postScheduled(input: ScheduledLineInput): Promise<ScheduledLineResult>;
  fetchTranscript(chatId: string, options?: TranscriptFetchOptions): Promise<TranscriptWindow>;
  /** `/new` for one bot in one chat (D7). */
  newSession(chatId: string, botId: string): Promise<void>;
  /** Stop all (plans/group-discussion.md): ends the discussion and interrupts running turns. */
  stopDiscussion(chatId: string): Promise<boolean>;
}

type ChatServiceListener = (message: import("../messages.js").SessionOutboundMessage) => void;

/** The pieces every method reaches; built once per service. */
interface ChatServiceParts {
  options: ChatServiceOptions;
  store: ChatStore;
  engine: ChatEngine;
  publisher: ChatPublisher;
  transcriptOf: (chatId: string) => TranscriptLog;
  transcripts: Map<string, TranscriptLog>;
}

export function createChatService(options: ChatServiceOptions): ChatService {
  const listeners = new Set<ChatServiceListener>();
  const parts = createChatServiceParts(options, listeners);
  let unsubscribe: (() => void) | null = null;

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start() {
      await parts.store.load();
      unsubscribe ??= publishStoreChanges(parts);
      await watchParticipants(parts);
      await reconcile(parts).catch((error: unknown) =>
        options.logger.warn({ err: error }, "chat.reconcile.failed"),
      );
    },
    async stop() {
      unsubscribe?.();
      unsubscribe = null;
      parts.engine.stop();
      await parts.engine.idle();
      await parts.store.idle();
      await Promise.all(Array.from(parts.transcripts.values()).map((log) => log.flush()));
    },
    ...chatReads(parts),
    ...chatWrites(parts),
  };
}

function createChatServiceParts(
  options: ChatServiceOptions,
  listeners: ReadonlySet<ChatServiceListener>,
): ChatServiceParts {
  const store = new ChatStore(options.rootDir, options.logger);
  const transcripts = new Map<string, TranscriptLog>();
  const transcriptOf = (chatId: string): TranscriptLog => {
    let log = transcripts.get(chatId);
    if (!log) {
      log = new TranscriptLog(store.directory(chatId));
      transcripts.set(chatId, log);
    }
    return log;
  };
  const publisher = fanOutPublisher(options.publisher, listeners);
  const engine = createEngine(options, store, transcriptOf, publisher);
  return { options, store, engine, publisher, transcriptOf, transcripts };
}

/** Every push reaches the Session wiring and every in-process subscriber. */
function fanOutPublisher(
  sessions: ChatPublisher,
  listeners: ReadonlySet<ChatServiceListener>,
): ChatPublisher {
  return {
    chatUpdated(chat) {
      sessions.chatUpdated(chat);
      for (const listener of listeners) listener({ type: "chat.updated", payload: { chat } });
    },
    transcriptAppended(chatId, line) {
      sessions.transcriptAppended(chatId, line);
      for (const listener of listeners)
        listener({ type: "chat.transcript.appended", payload: { chatId, line } });
    },
  };
}

function createEngine(
  options: ChatServiceOptions,
  store: ChatStore,
  transcriptOf: (chatId: string) => TranscriptLog,
  publisher: ChatPublisher,
): ChatEngine {
  const { agentManager, agentStorage, logger } = options;
  const botSessions = new BotSessions({
    agentStorage,
    store,
    createAgent: options.createAgent,
    ensureLoaded: (agentId) => ensureAgentLoaded(agentId, { agentManager, agentStorage, logger }),
    moveHeartbeats: async (fromAgentIds, toAgentId) => {
      const schedules = options.schedules;
      if (!schedules) return;
      for (const fromAgentId of fromAgentIds) {
        await schedules
          .retargetAgent(fromAgentId, toAgentId)
          .catch((err: unknown) =>
            logger.warn({ err, fromAgentId, toAgentId }, "chat.heartbeats.move_failed"),
          );
      }
    },
  });
  return new ChatEngine({
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
}

/** Republishes every stored change as the app sees it; returns the unsubscribe. */
function publishStoreChanges({ store, engine, publisher, options }: ChatServiceParts): () => void {
  return store.subscribe((chat) => {
    void engine
      .payload(chat)
      .then((summary) => publisher.chatUpdated(summary))
      .catch((error: unknown) =>
        options.logger.warn({ chatId: chat.id, err: error }, "chat.updated.publish_failed"),
      );
  });
}

/** Turns of known sessions that end from now on become transcript lines. */
async function watchParticipants({ store, engine }: ChatServiceParts): Promise<void> {
  for (const chat of await store.list()) {
    for (const participant of chat.participants) {
      if (participant.agentId)
        engine.tracker.watch(participant.agentId, chat.id, participant.botId);
    }
  }
}

/** §3: replies that ended while the daemon was down, backfilled in the background. */
function reconcile({ options, store, engine, transcriptOf }: ChatServiceParts): Promise<void> {
  const { agentManager, logger } = options;
  return reconcileChats({
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
}

type ChatReads = Pick<
  ChatService,
  "record" | "list" | "get" | "participantBotIds" | "fetchTranscript"
>;

function chatReads({ store, engine, transcriptOf }: ChatServiceParts): ChatReads {
  return {
    record: (chatId) => store.getCached(chatId),
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
    fetchTranscript: async (chatId, fetchOptions) => {
      await store.require(chatId);
      return transcriptOf(chatId).fetch(fetchOptions);
    },
  };
}

type ChatWrites = Omit<ChatService, keyof ChatReads | "subscribe" | "start" | "stop">;

function chatWrites({ options, store, engine }: ChatServiceParts): ChatWrites {
  return {
    create: (input) => createChat(store, engine, input),
    async update(chatId, patch) {
      return engine.payload(await store.updateSettings(chatId, patch));
    },
    async addParticipant(chatId, botId) {
      if (!(await options.bots.get(botId))) throw new Error(`Bot ${botId} not found`);
      return engine.payload(await store.addParticipant(chatId, botId));
    },
    async removeParticipant(chatId, botId) {
      return engine.payload(await engine.removeParticipant(chatId, botId));
    },
    async archive(chatId) {
      return engine.payload(await store.archive(chatId));
    },
    send: (input) => engine.send(input),
    postScheduled: (input) => engine.postScheduled(input),
    newSession: (chatId, botId) => engine.newSession(chatId, botId),
    stopDiscussion: (chatId) => engine.stopDiscussion(chatId),
  };
}

async function createChat(
  store: ChatStore,
  engine: ChatEngine,
  input: CreateChatServiceInput,
): Promise<{ chat: ChatPayload; sent: SendMessageResult | null }> {
  if (input.launch && (input.botIds.length !== 1 || input.kind === "group"))
    throw new Error("Launch settings can only be selected for a direct chat.");
  const draftId = input.idempotencyKey
    ? `chat_${createHash("sha256")
        .update(
          JSON.stringify([
            input.createdBy ? sessionActorKey(input.createdBy) : "hostOwner",
            input.idempotencyKey,
          ]),
        )
        .digest("hex")
        .slice(0, 32)}`
    : undefined;
  const chat = await store.create({
    ...(draftId ? { id: draftId, reuseExisting: true } : {}),
    ...(input.launch ? { launch: input.launch } : {}),
    botIds: input.botIds,
    kind: input.kind,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.rules ? { rules: input.rules } : {}),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
  });
  if (
    draftId &&
    (!isDeepStrictEqual(
      chat.participants.map((p) => p.botId),
      [...new Set(input.botIds)],
    ) ||
      !isDeepStrictEqual(chat.launch, input.launch))
  )
    throw new Error(
      "This chat draft already started with different settings. Open it or start a new draft.",
    );
  const sent = input.firstMessage
    ? await engine.send({
        chatId: chat.id,
        text: input.firstMessage.text,
        images: input.firstMessage.images,
        attachments: input.firstMessage.attachments,
        ...(input.firstMessage.messageId ? { messageId: input.firstMessage.messageId } : {}),
        ...(input.createdBy ? { actor: input.createdBy } : {}),
      })
    : null;
  return { chat: await engine.payload(await store.require(chat.id)), sent };
}
