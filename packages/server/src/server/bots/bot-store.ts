import { randomBytes } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import { StoredBotSchema, type StoredBot } from "@clisbot/protocol/bots/types";
import { writeJsonFileAtomic } from "../atomic-file.js";

/**
 * One JSON file per bot at `$CLISBOT_HOME/bots/{botId}.json`, written atomically
 * (docs/features/bots-and-chats/README.md, D2; docs/data-model.md). The directory is
 * made on the first write, never at construction, so a daemon with no bots leaves
 * its home byte-identical to a flag-off one.
 */
export type BotChangeEvent = { kind: "upsert"; bot: StoredBot } | { kind: "remove"; botId: string };

type BotUpdater = (bot: StoredBot) => StoredBot;
type BotChangeListener = (event: BotChangeEvent) => void;

export function generateBotId(): string {
  return `bot_${randomBytes(8).toString("hex")}`;
}

function parseStoredBot(
  content: string,
): { success: true; data: StoredBot } | { success: false; error: unknown } {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (error) {
    return { success: false, error };
  }
  return StoredBotSchema.safeParse(json);
}

export class BotStore {
  private readonly mutations = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<BotChangeListener>();
  private reportedInvalidFiles = new Set<string>();
  /** Bumped by every write here, so a list read before the write is never served after it. */
  private generation = 0;
  private listed: { generation: number; directoryMtimeNs: bigint; bots: StoredBot[] } | null = null;

  constructor(
    private readonly dir: string,
    private readonly logger: Logger,
    private readonly options: { listCache?: boolean } = {},
  ) {}

  private filePath(id: string): string {
    if (!/^bot_[0-9a-f]{16}$/.test(id)) throw new Error("Invalid Bot id");
    return join(this.dir, `${id}.json`);
  }

  subscribe(listener: BotChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Every record on disk, oldest first; a file that is not a bot is reported once and skipped.
   * With the list cache on, a read is reused until a write here or a change of the directory's
   * mtime (an added, removed or renamed-in file) (docs/features/agent-session-storage/cold-storage.md).
   */
  async list(): Promise<StoredBot[]> {
    if (!this.options.listCache) return this.readAll();
    const generation = this.generation;
    const directoryMtimeNs = await this.directoryMtimeNs();
    const cached = this.listed;
    if (cached?.generation === generation && cached.directoryMtimeNs === directoryMtimeNs)
      return [...cached.bots];
    const bots = await this.readAll();
    this.listed = { generation, directoryMtimeNs, bots };
    return [...bots];
  }

  private async directoryMtimeNs(): Promise<bigint> {
    return stat(this.dir, { bigint: true }).then(
      (stats) => stats.mtimeNs,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return -1n;
        throw error;
      },
    );
  }

  private async readAll(): Promise<StoredBot[]> {
    const entries = await readdir(this.dir, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^bot_[0-9a-f]{16}\.json$/.test(entry.name))
        .map(async (entry) => {
          const filePath = join(this.dir, entry.name);
          return { filePath, parsed: parseStoredBot(await readFile(filePath, "utf-8")) };
        }),
    );
    const bots: StoredBot[] = [];
    const invalidFiles = new Set<string>();
    for (const { filePath, parsed } of files) {
      if (parsed.success) {
        bots.push(parsed.data);
        continue;
      }
      invalidFiles.add(filePath);
      if (!this.reportedInvalidFiles.has(filePath)) {
        this.logger.error({ err: parsed.error, filePath }, "Skipping invalid bot file");
      }
    }
    this.reportedInvalidFiles = invalidFiles;
    return bots.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async get(id: string): Promise<StoredBot | null> {
    try {
      return StoredBotSchema.parse(JSON.parse(await readFile(this.filePath(id), "utf-8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async getBySlug(slug: string): Promise<StoredBot | null> {
    return (await this.list()).find((bot) => bot.slug === slug) ?? null;
  }

  async getByCwd(cwd: string): Promise<StoredBot | null> {
    return (await this.list()).find((bot) => bot.cwd === cwd) ?? null;
  }

  async create(bot: Omit<StoredBot, "id">): Promise<StoredBot> {
    const created = StoredBotSchema.parse({ ...bot, id: generateBotId() });
    await this.write(created);
    return created;
  }

  /** Read-merge-write behind a per-id queue, so two edits never interleave. */
  async update(id: string, updater: BotUpdater): Promise<StoredBot | null> {
    return this.serializeMutation(id, async () => {
      const current = await this.get(id);
      if (!current) return null;
      const next = updater(current);
      if (next.id !== id) throw new Error(`Bot update cannot change id: ${id}`);
      const updated = StoredBotSchema.parse(next);
      await this.write(updated);
      return updated;
    });
  }

  private async write(bot: StoredBot): Promise<void> {
    this.generation += 1;
    await writeJsonFileAtomic(this.filePath(bot.id), bot);
    this.generation += 1;
    for (const listener of this.listeners) listener({ kind: "upsert", bot });
  }

  private async serializeMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(mutation);
    this.mutations.set(key, next);
    try {
      return await next;
    } finally {
      if (this.mutations.get(key) === next) this.mutations.delete(key);
    }
  }
}
