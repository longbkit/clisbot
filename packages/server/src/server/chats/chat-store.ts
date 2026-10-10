import type { BotLaunchDefaults } from "@clisbot/protocol/bots/types";
import { ChatUpdatePatchSchema, type ChatUpdatePatch } from "@clisbot/protocol/chats/rpc-schemas";
// `ChatStore`: every `chat.json` under `$CLISBOT_HOME/chats/{chatId}/`, cached after one scan,
// written with the session record's durable write (temp file, fsync, rename, directory
// sync). Mutations under one chat run in order; chats never wait on each other.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import type { ChatRules } from "@clisbot/protocol/chats/types";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { writeDurableJson } from "../agent/session-storage/durable-file.js";
import { assertSessionId } from "../agent/session-storage/layout.js";
import {
  StoredChatSchema,
  newChatId,
  type ChatCompletedTurn,
  type StoredChat,
  type StoredChatParticipant,
} from "./chat-record.js";
import { KeyedSerialQueue } from "./keyed-queue.js";

const RECORD_FILE = "chat.json";

export interface CreateChatInput {
  id?: string;
  launch?: BotLaunchDefaults;
  reuseExisting?: boolean;
  title?: string | null;
  botIds: readonly string[];
  kind?: "direct" | "group";
  rules?: ChatRules;
  createdBy?: SessionActor;
}

export type ChatChangeListener = (chat: StoredChat) => void;

/**
 * Sets the Chat's tools off list. An empty list leaves no `tools` key, so a Chat that never kept
 * one stays readable by an older daemon, whose stored rules are strict.
 */
function withToolsOff(chat: StoredChat, toolsOff: readonly string[] | undefined): StoredChat {
  if (toolsOff === undefined) return chat;
  const { tools: _previous, ...rules } = chat.rules;
  const off = [...new Set(toolsOff)].sort();
  return { ...chat, rules: off.length > 0 ? { ...rules, tools: { off } } : rules };
}

export class ChatStore {
  private readonly cache = new Map<string, StoredChat>();
  private readonly writes = new KeyedSerialQueue();
  private readonly listeners = new Set<ChatChangeListener>();
  private loaded: Promise<void> | null = null;
  private readonly logger: Logger;

  constructor(
    readonly rootDir: string,
    logger: Logger,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.logger = logger.child({ module: "chats", component: "chat-store" });
  }

  /** `$CLISBOT_HOME/chats/{chatId}`; the id is checked before it joins a path. */
  directory(chatId: string): string {
    assertSessionId(chatId);
    return path.join(this.rootDir, chatId);
  }

  /** Scans once; a damaged record is reported and skipped, never fatal. */
  load(): Promise<void> {
    this.loaded ??= this.scan();
    return this.loaded;
  }

  private async scan(): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const file = path.join(this.rootDir, entry.name, RECORD_FILE);
      const chat = await this.readRecord(file);
      if (chat && chat.id === entry.name) this.cache.set(chat.id, chat);
      else if (chat) this.logger.warn({ file, id: chat.id }, "chat.record.directory_mismatch");
    }
  }

  private async readRecord(file: string): Promise<StoredChat | null> {
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      this.logger.warn({ file, err: error }, "chat.record.invalid_json");
      return null;
    }
    const parsed = StoredChatSchema.safeParse(value);
    if (parsed.success)
      return {
        ...parsed.data,
        kind: parsed.data.kind ?? (parsed.data.participants.length > 1 ? "group" : "direct"),
      };
    this.logger.warn({ file, issues: parsed.error.issues }, "chat.record.invalid");
    return null;
  }

  getCached(chatId: string): StoredChat | null {
    return this.cache.get(chatId) ?? null;
  }

  async list(): Promise<StoredChat[]> {
    await this.load();
    return Array.from(this.cache.values());
  }

  async get(chatId: string): Promise<StoredChat | null> {
    await this.load();
    return this.cache.get(chatId) ?? null;
  }

  async require(chatId: string): Promise<StoredChat> {
    const chat = await this.get(chatId);
    if (!chat) throw new Error(`Chat ${chatId} not found`);
    return chat;
  }

  subscribe(listener: ChatChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async create(input: CreateChatInput): Promise<StoredChat> {
    await this.load();
    const at = this.now();
    const chat: StoredChat = StoredChatSchema.parse({
      id: input.id ?? newChatId(),
      title: input.title ?? null,
      kind: new Set(input.botIds).size > 1 ? "group" : (input.kind ?? "direct"),
      participants: Array.from(new Set(input.botIds)).map((botId) => participant(botId, at)),
      rules: input.rules ?? {},
      ...(input.launch ? { launch: input.launch } : {}),
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      createdAt: at,
      updatedAt: at,
      lastMessageAt: null,
      archivedAt: null,
    });
    return this.writes.run(chat.id, () => {
      const existing = this.cache.get(chat.id);
      if (existing) {
        if (input.reuseExisting) return Promise.resolve(existing);
        throw new Error(`Chat ${chat.id} already exists`);
      }
      return this.write(chat);
    });
  }

  updateSettings(chatId: string, input: ChatUpdatePatch): Promise<StoredChat> {
    const patch = ChatUpdatePatchSchema.parse(input);
    return this.update(chatId, (chat) => {
      const group =
        chat.kind === "group" || (chat.kind === undefined && chat.participants.length > 1);
      // A direct chat keeps only its tools off list here; the rest are a group's settings.
      const onlyTools = Object.keys(patch).every((key) => key === "toolsOff");
      if (!group && !onlyTools) throw new Error("Only group chats have editable group settings");
      if (chat.archivedAt) throw new Error("Archived chats cannot be edited");
      return withToolsOff(
        {
          ...chat,
          ...(patch.title !== undefined ? { title: patch.title?.trim() || null } : {}),
          rules: {
            ...chat.rules,
            ...(patch.requireMention !== undefined
              ? { interaction: { ...chat.rules.interaction, requireMention: patch.requireMention } }
              : {}),
            ...(patch.roundsMax !== undefined ? { rounds: { max: patch.roundsMax } } : {}),
            ...(patch.roomInstructions !== undefined
              ? {
                  room: {
                    ...chat.rules.room,
                    instructions: patch.roomInstructions?.trim() || null,
                  },
                }
              : {}),
          },
        },
        patch.toolsOff,
      );
    });
  }

  /**
   * Applies `mutate` to the current record under the chat's queue and writes the result with
   * `at` as `updatedAt`. `mutate` returning the same object is a no-op: nothing is written
   * or published.
   */
  update(
    chatId: string,
    mutate: (chat: StoredChat, at: string) => StoredChat,
  ): Promise<StoredChat> {
    return this.writes.run(chatId, async () => {
      const current = await this.require(chatId);
      const at = this.now();
      const next = mutate(current, at);
      if (next === current) return current;
      return this.write({ ...next, updatedAt: at });
    });
  }

  private async write(chat: StoredChat): Promise<StoredChat> {
    const accepted = structuredClone(chat);
    await writeDurableJson(path.join(this.directory(chat.id), RECORD_FILE), accepted);
    this.cache.set(accepted.id, accepted);
    for (const listener of this.listeners) listener(accepted);
    return accepted;
  }

  /** Moves a participant's delivered mark forward; an older seq never moves it back. */
  markDelivered(chatId: string, botId: string, seq: number): Promise<StoredChat> {
    return this.update(chatId, (chat) =>
      mapParticipant(chat, botId, (entry) =>
        seq > entry.deliveredSeq ? { ...entry, deliveredSeq: seq } : entry,
      ),
    );
  }

  setParticipantAgent(chatId: string, botId: string, agentId: string | null): Promise<StoredChat> {
    return this.update(chatId, (chat) =>
      mapParticipant(chat, botId, (entry) =>
        entry.agentId === agentId ? entry : { ...entry, agentId },
      ),
    );
  }

  /** Records which room state this bot's session has been told (plans/group-discussion.md). */
  setParticipantRoomSeen(chatId: string, botId: string, roomSeen: string): Promise<StoredChat> {
    return this.update(chatId, (chat) =>
      mapParticipant(chat, botId, (entry) =>
        entry.roomSeen === roomSeen ? entry : { ...entry, roomSeen },
      ),
    );
  }

  /** `/new` (D7): drops the session cache and marks the time, so a label scan never re-adopts it. */
  resetParticipantSession(chatId: string, botId: string): Promise<StoredChat> {
    return this.update(chatId, (chat, at) =>
      mapParticipant(chat, botId, (entry) => ({
        ...entry,
        agentId: null,
        resetAt: at,
        completedTurn: null,
      })),
    );
  }

  recordCompletedTurn(
    chatId: string,
    botId: string,
    receipt: ChatCompletedTurn,
  ): Promise<StoredChat> {
    return this.update(chatId, (chat) =>
      mapParticipant(chat, botId, (entry) =>
        entry.agentId === receipt.agentId ? { ...entry, completedTurn: receipt } : entry,
      ),
    );
  }

  addParticipant(chatId: string, botId: string): Promise<StoredChat> {
    return this.update(chatId, (chat, at) =>
      chat.participants.some((entry) => entry.botId === botId)
        ? chat
        : { ...chat, kind: "group", participants: [...chat.participants, participant(botId, at)] },
    );
  }

  removeParticipant(chatId: string, botId: string): Promise<StoredChat> {
    return this.update(chatId, (chat) =>
      chat.participants.some((entry) => entry.botId === botId)
        ? {
            ...chat,
            kind: chat.kind ?? (chat.participants.length > 1 ? "group" : "direct"),
            participants: chat.participants.filter((entry) => entry.botId !== botId),
          }
        : chat,
    );
  }

  touchLastMessage(chatId: string, at: string): Promise<StoredChat> {
    return this.update(chatId, (chat) => ({ ...chat, lastMessageAt: at }));
  }

  archive(chatId: string): Promise<StoredChat> {
    return this.update(chatId, (chat, at) =>
      chat.archivedAt ? chat : { ...chat, archivedAt: at },
    );
  }

  /** Waits for every queued write; a clean stop calls this before the process exits. */
  idle(): Promise<void> {
    return this.writes.idle();
  }
}

function participant(botId: string, addedAt: string): StoredChatParticipant {
  return { botId, addedAt, agentId: null, resetAt: null, deliveredSeq: 0 };
}

function mapParticipant(
  chat: StoredChat,
  botId: string,
  mutate: (entry: StoredChatParticipant) => StoredChatParticipant,
): StoredChat {
  let changed = false;
  const participants = chat.participants.map((entry) => {
    if (entry.botId !== botId) return entry;
    const next = mutate(entry);
    changed ||= next !== entry;
    return next;
  });
  return changed ? { ...chat, participants } : chat;
}
