import { withSessionOperationIdentity } from "../agent/session-operation-context.js";
// One agent session per (bot, chat) pair (docs/features/bots-and-chats/README.md,
// D2, D7). The labels on the agent are the truth; `participants[bot].agentId` is a
// cache of the lookup. A session that cannot resume, or was archived from the
// cowork view, is replaced by a new one and the caller writes the system line.
import { BOT_ID_LABEL, CHAT_ID_LABEL } from "@clisbot/protocol/bots/labels";
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
  store: Pick<ChatStore, "require" | "setParticipantAgent" | "resetParticipantSession">;
  createAgent: BoundCreateAgentCommand;
  /** Loads (resumes) the session; throws when the provider cannot resume it. */
  ensureLoaded: (agentId: string) => Promise<unknown>;
}

/** What a session created by `resolve` starts with. */
interface SessionStart {
  title: string | undefined;
  systemPrompt: string | undefined;
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
  ): Promise<ResolvedBotSession> {
    return this.queue.run(pairKey(chat.id, bot.id), () =>
      this.resolveUnlocked(chat, bot, { title, systemPrompt }),
    );
  }

  /** `/new`: forgets the current session so the next delivery starts a fresh one. */
  reset(chatId: string, botId: string): Promise<void> {
    return this.queue.run(pairKey(chatId, botId), async () => {
      await this.deps.store.resetParticipantSession(chatId, botId);
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
    { title, systemPrompt }: SessionStart,
    replaced: BotSessionReplacement | null,
  ): Promise<ResolvedBotSession> {
    const { launch } = bot;
    const result = await withSessionOperationIdentity({ actor: chat.createdBy }, () =>
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
        labels: { [BOT_ID_LABEL]: bot.id, [CHAT_ID_LABEL]: chat.id },
        background: true,
        notifyOnFinish: false,
        promptFailure: "throw",
      }),
    );
    const agentId = result.snapshot.id;
    await this.deps.store.setParticipantAgent(chat.id, bot.id, agentId);
    return { agentId, created: true, replaced };
  }
}

function pairKey(chatId: string, botId: string): string {
  return `${chatId}:${botId}`;
}

function belongsTo(record: StoredAgentRecord, chatId: string, botId: string): boolean {
  return record.labels[CHAT_ID_LABEL] === chatId && record.labels[BOT_ID_LABEL] === botId;
}
