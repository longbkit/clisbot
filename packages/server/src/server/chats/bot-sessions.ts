import type { SessionOperationIdentity } from "../agent/session-authorship.js";
import { withSessionOperationIdentity } from "../agent/session-operation-context.js";
// One agent session per (bot, chat) pair (docs/features/bots-and-chats/README.md,
// D2, D7). The labels on the agent are the truth; `participants[bot].agentId` is a
// cache of the lookup. A session that cannot resume, or was archived from the
// cowork view, is replaced by a new one and the caller writes the system line.
import { BOT_ID_LABEL, CHAT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import type { AgentAttachment } from "@clisbot/protocol/agent-attachments";
import type { BotLaunchDefaults } from "@clisbot/protocol/bots/types";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import { formatProviderModel, type BoundCreateAgentCommand } from "../agent/create-agent/create.js";
import type { ChatBot, StoredChat } from "./chat-record.js";
import type { ChatStore } from "./chat-store.js";
import { KeyedSerialQueue } from "./keyed-queue.js";

export type BotSessionReplacement = "could_not_resume" | "archived";

export interface ResolvedBotSession {
  agentId: string;
  /** A session was created for this call. */
  created: boolean;
  /** Why an earlier session was left behind, when one was. */
  replaced: BotSessionReplacement | null;
}

export interface BotSessionsDependencies {
  agentStorage: Pick<import("../agent/agent-storage.js").AgentStorage, "get" | "list">;
  store: Pick<
    ChatStore,
    "require" | "setParticipantAgent" | "resetParticipantSession" | "forkParticipantSession"
  >;
  createAgent: BoundCreateAgentCommand;
  /** Loads (resumes) the session; throws when the provider cannot resume it. */
  ensureLoaded: (agentId: string) => Promise<unknown>;
  /**
   * Points the pair's heartbeats from its earlier sessions at the new one, so they keep reporting
   * into the Chat after `/new` (docs/audits/2026-10-06-conversation-schedules.md). Never throws.
   */
  moveHeartbeats?: (fromAgentIds: readonly string[], toAgentId: string) => Promise<void>;
  /** Archives a session a fork created but could not record, so no scan adopts it. */
  discardAgent?: (agentId: string) => Promise<void>;
}

/** What a fork carries: the previous session and its conversation, read when it was confirmed. */
export interface ForkCarry {
  fromAgentId: string;
  attachment: Extract<AgentAttachment, { type: "text" }>;
}

/** What a session created by `resolve` starts with. */
export interface SessionStart {
  title: string | undefined;
  systemPrompt: string | undefined;
  creationIdentity?: SessionOperationIdentity;
}

export class BotSessions {
  private readonly queue = new KeyedSerialQueue();

  constructor(private readonly deps: BotSessionsDependencies) {}

  /**
   * The live session for the pair, created when none exists. Serialized per pair. `systemPrompt`
   * applies only to a session created here; an existing one keeps what it was created with.
   */
  resolve(
    chat: StoredChat,
    bot: ChatBot,
    title?: string,
    systemPrompt?: string,
    creationIdentity?: SessionOperationIdentity,
  ): Promise<ResolvedBotSession> {
    return this.queue.run(pairKey(chat.id, bot.id), () =>
      this.resolveUnlocked(chat, bot, {
        title,
        systemPrompt,
        ...(creationIdentity ? { creationIdentity } : {}),
      }),
    );
  }

  /** `/new`: forgets the current session so the next delivery starts a fresh one. */
  reset(chatId: string, botId: string): Promise<void> {
    return this.queue.run(pairKey(chatId, botId), async () => {
      await this.deps.store.resetParticipantSession(chatId, botId);
    });
  }

  /**
   * A provider switch: starts the pair's session on `launch` now, then records the launch, the
   * session and what it carries in one write. A launch that cannot start throws before anything
   * changes; a session that could not be recorded is archived. Either way the old session stays
   * the pair's.
   */
  fork(
    chat: StoredChat,
    bot: ChatBot,
    launch: BotLaunchDefaults,
    start: SessionStart,
    carry: ForkCarry | null,
  ): Promise<ResolvedBotSession> {
    return this.queue.run(pairKey(chat.id, bot.id), async () => {
      // Before the new session exists: the label scan adopts only sessions created after it.
      const resetAt = new Date(Date.now() - 1).toISOString();
      const agentId = await this.launchAgent(chat, bot, launch, start, {});
      try {
        await this.deps.store.forkParticipantSession(chat.id, bot.id, {
          launch,
          agentId,
          resetAt,
          pendingContext: carry ? { ...carry, agentId } : undefined,
        });
      } catch (error) {
        await this.deps.discardAgent?.(agentId).catch(() => undefined);
        throw error;
      }
      await this.moveHeartbeats(chat.id, bot.id, agentId);
      return { agentId, created: true, replaced: null };
    });
  }

  private async resolveUnlocked(
    chat: StoredChat,
    bot: ChatBot,
    start: SessionStart,
  ): Promise<ResolvedBotSession> {
    const current = await this.deps.store.require(chat.id);
    const participant = current.participants.find((entry) => entry.botId === bot.id);
    const cached = participant?.agentId ?? null;
    const known =
      (await this.cachedSession(cached, chat.id, bot.id)) ??
      (await this.scan(chat.id, bot.id, participant?.resetAt ?? null));
    if (known?.archivedAt) return this.create(chat, bot, start, "archived");
    if (!known) return this.create(chat, bot, start, null);
    try {
      await this.deps.ensureLoaded(known.id);
    } catch {
      return this.create(chat, bot, start, "could_not_resume");
    }
    if (known.id !== cached) await this.deps.store.setParticipantAgent(chat.id, bot.id, known.id);
    return { agentId: known.id, created: false, replaced: null };
  }

  /** The cached agent, when it still carries this pair's labels. */
  private async cachedSession(
    agentId: string | null,
    chatId: string,
    botId: string,
  ): Promise<StoredAgentRecord | null> {
    if (!agentId) return null;
    const record = await this.deps.agentStorage.get(agentId);
    return record && belongsTo(record, chatId, botId) ? record : null;
  }

  /**
   * The newest unarchived agent labelled with this pair and created after the last `/new`;
   * the crash-safe fallback for a lost cache.
   */
  private async scan(
    chatId: string,
    botId: string,
    resetAt: string | null,
  ): Promise<StoredAgentRecord | null> {
    const matches = (await this.deps.agentStorage.list()).filter(
      (record) =>
        belongsTo(record, chatId, botId) &&
        !record.archivedAt &&
        (resetAt === null || record.createdAt > resetAt),
    );
    matches.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return matches[0] ?? null;
  }

  private async create(
    chat: StoredChat,
    bot: ChatBot,
    start: SessionStart,
    replaced: BotSessionReplacement | null,
  ): Promise<ResolvedBotSession> {
    const agentId = await this.launchAgent(chat, bot, chat.launch ?? bot.launch, start, {});
    await this.deps.store.setParticipantAgent(chat.id, bot.id, agentId);
    await this.moveHeartbeats(chat.id, bot.id, agentId);
    return { agentId, created: true, replaced };
  }

  /** Creates the pair's agent on `launch`; it carries the pair's labels plus `labels`. */
  private async launchAgent(
    chat: StoredChat,
    bot: ChatBot,
    launch: BotLaunchDefaults,
    { title, systemPrompt, creationIdentity }: SessionStart,
    labels: Record<string, string>,
  ): Promise<string> {
    const result = await withSessionOperationIdentity(
      creationIdentity ?? { actor: chat.createdBy },
      () =>
        this.deps.createAgent({
          kind: "mcp",
          provider: formatProviderModel(launch.provider, launch.model),
          title: title ?? chat.title ?? bot.displayName,
          ...(launch.modeId ? { mode: launch.modeId } : {}),
          ...(launch.thinkingOptionId ? { thinking: launch.thinkingOptionId } : {}),
          ...(launch.featureValues ? { features: launch.featureValues } : {}),
          ...(systemPrompt ? { config: { systemPrompt } } : {}),
          cwd: bot.cwd,
          workspaceId: bot.workspaceId,
          labels: { ...labels, [BOT_ID_LABEL]: bot.id, [CHAT_ID_LABEL]: chat.id },
          notifyOnFinish: false,
          promptFailure: "throw",
        }),
    );
    return result.snapshot.id;
  }

  private async moveHeartbeats(chatId: string, botId: string, agentId: string): Promise<void> {
    if (!this.deps.moveHeartbeats) return;
    const earlier = (await this.deps.agentStorage.list())
      .filter((record) => record.id !== agentId && belongsTo(record, chatId, botId))
      .map((record) => record.id);
    if (earlier.length > 0) await this.deps.moveHeartbeats(earlier, agentId);
  }
}

function pairKey(chatId: string, botId: string): string {
  return `${chatId}:${botId}`;
}

function belongsTo(record: StoredAgentRecord, chatId: string, botId: string): boolean {
  return record.labels[CHAT_ID_LABEL] === chatId && record.labels[BOT_ID_LABEL] === botId;
}
