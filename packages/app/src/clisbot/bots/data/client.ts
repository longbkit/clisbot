import type { BotPayload, ChatPayload, ChatTranscriptPage } from "./contracts";

/** Read adapter for protocol records projected into the feature views. */
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
  clientGeneration?: number;
  connectionEpoch?: number;
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
