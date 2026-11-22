// What a provider switch promised to carry (`session-fork.ts`), kept beside `chat.json` in
// `fork-carry.json` rather than inside it: an older daemon reads `chat.json` with a strict schema
// and would drop the whole chat for an unknown field, while it never opens this file. Downgraded,
// the chat still loads; only the not yet delivered carry is left behind.
//
// Each carry is keyed by the session that owes it (`agentId`, never reused) and counts only while
// `chat.json` binds the Bot to that session. A switch adds the new session's carry before the
// record write and removes the old one after it, so a failed write or a stop in between leaves
// the old binding with its carry; `/new` unbinds the session, so its carry never comes back. A
// file that cannot be read or parsed counts as empty: the carry is dropped, never misattributed.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import { TextAttachmentSchema } from "@clisbot/protocol/agent-attachments";
import { writeDurableJson } from "../agent/session-storage/durable-file.js";

const CARRY_FILE = "fork-carry.json";

export const ForkCarrySchema = z
  .object({
    botId: z.string(),
    /** The session whose conversation `attachment` is; sending it needs access to it. */
    sourceAgentId: z.string(),
    /** The session the switch left; a repeated confirmation names it. Null when there was none. */
    previousAgentId: z.string().nullable(),
    /** The session that owes it: the one the switch started, and the file's key. */
    agentId: z.string(),
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
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.logger.warn({ file, err: error }, "chat.fork_carry.unreadable");
      return;
    }
    const parsed = CarryFileSchema.safeParse(safeJson(raw));
    if (parsed.success) this.cache.set(chatId, parsed.data);
    else this.logger.warn({ file }, "chat.fork_carry.invalid");
  }

  /** The carry `agentId` owes in this chat to `botId`, if the file holds one for exactly them. */
  get(chatId: string, botId: string, agentId: string): ForkCarry | null {
    const carry = this.cache.get(chatId)?.[agentId];
    return carry && carry.agentId === agentId && carry.botId === botId ? carry : null;
  }

  /**
   * Adds or removes carries by owing session; `keep` names the sessions still bound, and every
   * other entry goes, so the file never outgrows the chat's Bots. The caller holds the chat's
   * write queue.
   */
  async update(
    chatId: string,
    directory: string,
    change: { add?: ForkCarry; remove?: string; keep: ReadonlySet<string> },
  ) {
    const next: CarryFile = {};
    for (const [key, carry] of Object.entries(this.cache.get(chatId) ?? {}))
      if (key !== change.remove && change.keep.has(key)) next[key] = carry;
    if (change.add) next[change.add.agentId] = change.add;
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
