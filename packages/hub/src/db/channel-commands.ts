import { and, asc, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type { ChannelAccountKey } from "./channel-access.js";
import type { DrizzleHandle } from "./runtime/index.js";

export interface ChannelCommandRecord {
  name: string;
  prompt: string;
  updatedBy: string;
  updatedAt: Date;
}

/** Atomic, account-scoped storage; dispatch owns the platform reserved vocabulary. */
export class ChannelCommandStore {
  constructor(private readonly commandDatabase: DrizzleHandle) {}

  async listCommands(key: ChannelAccountKey): Promise<ChannelCommandRecord[]> {
    return this.commandDatabase.select(commandColumns).from(schema.channelCommands)
      .where(and(...commandAccountWhere(key))).orderBy(asc(schema.channelCommands.name));
  }

  async findCommand(key: ChannelAccountKey, name: string): Promise<ChannelCommandRecord | undefined> {
    const [row] = await this.commandDatabase.select(commandColumns).from(schema.channelCommands)
      .where(and(...commandAccountWhere(key), eq(schema.channelCommands.name, name))).limit(1);
    return row;
  }

  async setCommand(key: ChannelAccountKey, input: {
    name: string; prompt: string; updatedBy: string;
  }): Promise<ChannelCommandRecord> {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(input.name)) throw new Error("Invalid command name");
    if (input.prompt.trim().length === 0) throw new Error("Command prompt must not be empty");
    const updatedAt = new Date();
    const [row] = await this.commandDatabase.insert(schema.channelCommands)
      .values({ ...key, ...input, updatedAt })
      .onConflictDoUpdate({
        target: [schema.channelCommands.organizationId, schema.channelCommands.channel,
          schema.channelCommands.accountId, schema.channelCommands.name],
        set: { prompt: input.prompt, updatedBy: input.updatedBy, updatedAt },
      }).returning(commandColumns);
    if (row === undefined) throw new Error("Channel command write returned no row");
    return row;
  }

  async removeCommand(key: ChannelAccountKey, name: string): Promise<boolean> {
    const rows = await this.commandDatabase.delete(schema.channelCommands)
      .where(and(...commandAccountWhere(key), eq(schema.channelCommands.name, name)))
      .returning({ name: schema.channelCommands.name });
    return rows.length > 0;
  }
}

const commandColumns = {
  name: schema.channelCommands.name,
  prompt: schema.channelCommands.prompt,
  updatedBy: schema.channelCommands.updatedBy,
  updatedAt: schema.channelCommands.updatedAt,
};

function commandAccountWhere(key: ChannelAccountKey) {
  return [eq(schema.channelCommands.organizationId, key.organizationId),
    eq(schema.channelCommands.channel, key.channel), eq(schema.channelCommands.accountId, key.accountId)];
}
