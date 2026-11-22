// What a provider switch promised to carry (`session-fork.ts`), kept beside `chat.json` in
// `fork-carry.json` rather than inside it: an older daemon reads `chat.json` with a strict schema
// and would drop the whole chat for an unknown field, while it never opens this file. Downgraded,
// the chat still loads; only the not yet delivered carry is left behind.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import { TextAttachmentSchema } from "@clisbot/protocol/agent-attachments";
import { writeDurableJson } from "../agent/session-storage/durable-file.js";

const CARRY_FILE = "fork-carry.json";

export const ForkCarrySchema = z
  .object({
    /** The session whose conversation `attachment` is; sending it needs access to it. */
    sourceAgentId: z.string(),
    /** The session the switch left; a repeated confirmation names it. Null when there was none. */
    previousAgentId: z.string().nullable(),
    /** The session the switch started. */
    agentId: z.string(),
    /** The participant's `resetAt` the switch wrote; a later `/new` or switch makes this stale. */
    resetAt: z.string(),
    attachment: TextAttachmentSchema,
  })
  .strict();
export type ForkCarry = z.infer<typeof ForkCarrySchema>;

const CarryFileSchema = z.record(z.string(), ForkCarrySchema);
type CarryFile = z.infer<typeof CarryFileSchema>;

export class ForkCarryStore {
  private readonly cache = new Map<string, CarryFile>();

  constructor(private readonly logger: Logger) {}

  /** Reads a chat's file once at scan; a damaged file is reported and treated as empty. */
  async load(chatId: string, directory: string): Promise<void> {
    const file = path.join(directory, CARRY_FILE);
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const parsed = CarryFileSchema.safeParse(safeJson(raw));
    if (parsed.success) this.cache.set(chatId, parsed.data);
    else this.logger.warn({ file }, "chat.fork_carry.invalid");
  }

  get(chatId: string, botId: string): ForkCarry | null {
    return this.cache.get(chatId)?.[botId] ?? null;
  }

  /** Sets or removes one Bot's carry; the caller holds the chat's write queue. */
  async set(chatId: string, directory: string, botId: string, carry: ForkCarry | null) {
    const { [botId]: _previous, ...rest } = this.cache.get(chatId) ?? {};
    const next: CarryFile = carry ? { ...rest, [botId]: carry } : rest;
    const file = path.join(directory, CARRY_FILE);
    if (Object.keys(next).length === 0) await fs.rm(file, { force: true });
    else await writeDurableJson(file, next);
    this.cache.set(chatId, next);
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
