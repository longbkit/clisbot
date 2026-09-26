import type { BotPayload, ChatPayload, ChatTranscriptPage } from "./contracts";

/**
 * The daemon calls the bots feature reads. The next wave implements this with the
 * `DaemonClient` method block (`botList`, `chatList`, `chatTranscriptFetch`,
 * docs/features/bots-and-chats/plans/app.md §6); until then the hooks take it as an input so
 * they can be built and tested against a fake.
 */
export interface BotsClient {
  botList(): Promise<{ bots: BotPayload[]; error?: string }>;
  chatList(): Promise<{ chats: ChatPayload[]; error?: string }>;
  chatTranscriptFetch(input: {
    chatId: string;
    beforeSeq?: number;
    limit?: number;
  }): Promise<ChatTranscriptPage & { error?: string }>;
}

export interface BotsRuntimeSnapshot {
  connectionStatus: string;
}

/** Same shape as `ScheduleRuntime`: connectivity is read at fetch time, per host. */
export interface BotsRuntime {
  getClient(serverId: string): BotsClient | null;
  getSnapshot(serverId: string): BotsRuntimeSnapshot | null | undefined;
}

export interface BotsHostInput {
  serverId: string;
  serverName: string;
}
