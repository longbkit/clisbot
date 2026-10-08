import type { PrepareChatMessageFiles } from "../../chats/chat-engine.js";
import { sessionActorKey, type SessionActor } from "@clisbot/protocol/session-authorship";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ChatService } from "../../chats/chat-service.js";
import type { BotService } from "../../bots/index.js";
import type { BotSessionAuthority } from "../bots/bot-session.js";

const LOCAL_OWNER: SessionActor = { kind: "user", id: "owner" };
type Request = Extract<SessionInboundMessage, { type: `chat.${string}.request` }>;

/** Session-local authority is checked again at push time, including ticket revocation. */
export class ChatSession {
  private readonly projects = new Map<string, string>();
  private readonly unsubscribes: Array<() => void> = [];
  private readonly ready: Promise<void>;
  constructor(
    private readonly service: ChatService,
    private readonly bots: BotService,
    private readonly authority: BotSessionAuthority &
      Pick<
        import("../../managed-access/resource-authorizer.js").ManagedResourceAuthorizer,
        "allowsAgentConfiguration" | "allowsChatSessionConfiguration"
      >,
    private readonly actor: () => SessionActor | undefined,
    private readonly emit: (message: SessionOutboundMessage) => void,
    private readonly prepareFiles?: PrepareChatMessageFiles,
  ) {
    this.ready = bots.list(true).then((records) => {
      for (const bot of records) this.projects.set(bot.id, bot.projectId);
      return;
    });
    this.unsubscribes.push(
      bots.subscribe((event) => {
        if (event.kind === "upsert") this.projects.set(event.bot.id, event.bot.projectId);
      }),
    );
    this.unsubscribes.push(
      service.subscribe((message) => {
        let chatId: string | null = null;
        if (message.type === "chat.updated") chatId = message.payload.chat.id;
        if (message.type === "chat.transcript.appended") chatId = message.payload.chatId;
        if (chatId && this.allows(chatId)) emit(message);
      }),
    );
  }
  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
  }
  allows(chatId: string): boolean {
    const chat = this.service.record(chatId);
    if (!chat) return false;
    if (
      sessionActorKey(chat.createdBy ?? LOCAL_OWNER) !==
      sessionActorKey(this.actor() ?? LOCAL_OWNER)
    )
      return false;
    return chat.participants.every(({ botId }) => {
      const projectId = this.projects.get(botId);
      return projectId !== undefined && this.authority.allowsProject(projectId, "project.use");
    });
  }
  /** May post in the Chat: it is theirs and they may talk to every Bot in it (`requireRun`). */
  allowsSend(chatId: string): boolean {
    const chat = this.service.record(chatId);
    if (!chat || !this.allows(chatId)) return false;
    return chat.participants.every(({ botId }) => {
      const projectId = this.projects.get(botId);
      return projectId !== undefined && this.authority.allowsProject(projectId, "agent.interact");
    });
  }
  private async requireBot(botId: string): Promise<void> {
    const bot = await this.bots.get(botId);
    if (!bot || bot.archivedAt || !this.authority.allowsProject(bot.projectId, "project.use"))
      throw new Error("Bot not found or access denied");
    this.projects.set(bot.id, bot.projectId);
  }
  private async requireRun(chatId: string): Promise<void> {
    const chat = this.service.record(chatId);
    if (!chat) throw new Error("Chat not found");
    for (const participant of chat.participants) {
      const bot = await this.bots.get(participant.botId);
      if (!bot || bot.archivedAt || !this.authority.allowsProject(bot.projectId, "agent.interact"))
        throw new Error("Bot interaction access denied");
      if (
        participant.agentId &&
        !(await this.authority.allowsChatSessionConfiguration(participant.agentId))
      )
        throw new Error("Existing Bot session configuration access denied");
      if (
        !(await this.authority.allowsAgentConfiguration(bot.workspaceId, {
          ...bot.launch,
          cwd: bot.cwd,
        }))
      )
        throw new Error("Bot configuration access denied");
    }
  }
  async handle(request: Request): Promise<void> {
    await this.ready;
    let payload: Record<string, unknown>;
    try {
      if ("chatId" in request && !this.allows(request.chatId))
        throw new Error("Chat not found or access denied");
      payload = { ...(await this.dispatch(request)), error: null };
    } catch (error) {
      payload = {
        ...errorDefaults(request),
        error: error instanceof Error ? error.message : String(error),
        errorCode: "chat_request_failed",
      };
    }
    this.emit({
      type: request.type.replace(/\.request$/, ".response"),
      payload: { requestId: request.requestId, ...payload },
    } as SessionOutboundMessage);
  }

  /** Voice uses the same transcript, authority and fan-out as a typed Chat message. */
  async sendSpokenInput(chatId: string, agentId: string, text: string): Promise<void> {
    await this.ready;
    if (!this.allows(chatId)) throw new Error("Chat not found or access denied");
    const chat = this.service.record(chatId);
    if (!chat?.participants.some((participant) => participant.agentId === agentId))
      throw new Error("Voice session is no longer an active Chat participant");
    await this.requireRun(chatId);
    await this.service.send({
      chatId,
      text,
      actor: this.actor() ?? LOCAL_OWNER,
      spokenInputAgentId: agentId,
    });
  }

  private async create(
    request: Extract<Request, { type: "chat.create.request" }>,
  ): Promise<Record<string, unknown>> {
    if (!request.botIds.length) throw new Error("A Chat needs at least one Bot");
    for (const botId of request.botIds) await this.requireBot(botId);
    const result = await this.service.create({
      ...request,
      firstMessage: undefined,
      createdBy: this.actor() ?? LOCAL_OWNER,
    });
    if (request.firstMessage) {
      await this.requireRun(result.chat.id);
      result.sent = await this.service.send({
        chatId: result.chat.id,
        ...request.firstMessage,
        prepareFiles: this.prepareFiles,
        actor: this.actor() ?? LOCAL_OWNER,
      });
    }
    return { chat: result.chat, ...(result.sent ? { sent: result.sent } : {}) };
  }

  private async dispatch(request: Request): Promise<Record<string, unknown>> {
    switch (request.type) {
      case "chat.create.request":
        return this.create(request);
      case "chat.list.request":
        return {
          chats: (await this.service.list(request.includeArchived)).filter((chat) =>
            this.allows(chat.id),
          ),
        };
      case "chat.participant.add.request":
        await this.requireBot(request.botId);
        return { chat: await this.service.addParticipant(request.chatId, request.botId) };
      case "chat.participant.remove.request":
        return { chat: await this.service.removeParticipant(request.chatId, request.botId) };
      case "chat.message.send.request":
        await this.requireRun(request.chatId);
        return {
          ...(await this.service.send({
            ...request,
            prepareFiles: this.prepareFiles,
            actor: this.actor() ?? LOCAL_OWNER,
          })),
        };
      case "chat.transcript.fetch.request":
        return { ...(await this.service.fetchTranscript(request.chatId, request)) };
      case "chat.update.request":
        return { chat: await this.service.update(request.chatId, request.patch) };
      case "chat.archive.request":
        return { chat: await this.service.archive(request.chatId) };
      case "chat.session.reset.request":
        await this.service.newSession(request.chatId, request.botId);
        return { chatId: request.chatId, botId: request.botId };
      case "chat.discussion.stop.request":
        await this.requireRun(request.chatId);
        await this.service.stopDiscussion(request.chatId);
        return { chatId: request.chatId };
    }
  }
}

export function dispatchChatMessage(
  session: ChatSession | null,
  message: SessionInboundMessage,
  emit: (message: SessionOutboundMessage) => void,
): Promise<void> | undefined {
  switch (message.type) {
    case "chat.create.request":
    case "chat.list.request":
    case "chat.participant.add.request":
    case "chat.participant.remove.request":
    case "chat.message.send.request":
    case "chat.transcript.fetch.request":
    case "chat.update.request":
    case "chat.archive.request":
    case "chat.session.reset.request":
    case "chat.discussion.stop.request":
      if (session) return session.handle(message);
      emit({
        type: "rpc_error",
        payload: {
          requestId: message.requestId,
          requestType: message.type,
          error: "Bots are disabled",
          code: "bots_disabled",
        },
      });
      return Promise.resolve();
    default:
      return undefined;
  }
}

function errorDefaults(request: Request): Record<string, unknown> {
  switch (request.type) {
    case "chat.list.request":
      return { chats: [] };
    case "chat.transcript.fetch.request":
      return { lines: [], hasOlder: false, hasNewer: false, startSeq: 0, endSeq: 0 };
    case "chat.message.send.request":
      return { messageId: null, seq: null, targets: [] };
    case "chat.session.reset.request":
      return { chatId: request.chatId, botId: request.botId };
    case "chat.discussion.stop.request":
      return { chatId: request.chatId };
    default:
      return { chat: null };
  }
}

export function createChatSession(
  service: ChatService | undefined,
  bots: BotService | undefined,
  authority: ConstructorParameters<typeof ChatSession>[2],
  actor: () => SessionActor | undefined,
  emit: (message: SessionOutboundMessage) => void,
  prepareFiles?: PrepareChatMessageFiles,
): ChatSession | null {
  return service && bots
    ? new ChatSession(service, bots, authority, actor, emit, prepareFiles)
    : null;
}
