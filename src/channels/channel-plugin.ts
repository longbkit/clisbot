import type { AgentService, AgentSessionTarget } from "../agents/agent-service.ts";
import type { LoadedConfig } from "../config/load-config.ts";
import type { ProcessedEventsStore } from "./processed-events-store.ts";
import type { ActivityStore } from "../control/activity-store.ts";
import type { ParsedMessageCommand } from "./message-command.ts";
import type {
  RuntimeChannel,
  RuntimeChannelConnection,
} from "../control/runtime-health-store.ts";
import type { RuntimeHealthStore } from "../control/runtime-health-store.ts";

export type ChannelRuntimeService = {
  start(): Promise<void>;
  stop(): Promise<void>;
  getRuntimeIdentity?(): ChannelRuntimeIdentity | null;
};

export type ChannelRuntimeIdentity = {
  accountId: string;
  label?: string;
  appLabel?: string;
  tokenHint?: string;
};

export type ChannelRuntimeContext = {
  loadedConfig: LoadedConfig;
  agentService: AgentService;
  processedEventsStore: ProcessedEventsStore;
  activityStore: ActivityStore;
  reportLifecycle: (event: ChannelRuntimeLifecycleEvent) => Promise<void>;
};

export type ChannelRuntimeLifecycleEvent = {
  connection: Extract<RuntimeChannelConnection, "active" | "failed">;
  summary?: string;
  detail?: string;
  actions?: string[];
};

export type ChannelRuntimeAccount = {
  accountId: string;
  config: unknown;
};

export type ChannelRuntimeEntry = {
  channel: RuntimeChannel;
  accountId: string;
  service: ChannelRuntimeService;
};

export type ChannelPlugin = {
  id: RuntimeChannel;
  isEnabled(loadedConfig: LoadedConfig): boolean;
  listAccounts(loadedConfig: LoadedConfig): ChannelRuntimeAccount[];
  createRuntimeService(
    context: ChannelRuntimeContext,
    account: ChannelRuntimeAccount,
  ): ChannelRuntimeService;
  renderHealthSummary(state: "starting" | "disabled" | "stopped"): string;
  renderActiveHealthSummary(serviceCount: number): string;
  markStartupFailure(store: RuntimeHealthStore, error: unknown): Promise<void>;
  runMessageCommand(
    loadedConfig: LoadedConfig,
    command: ParsedMessageCommand,
  ): Promise<{
    accountId: string;
    result: unknown;
  }>;
  resolveMessageReplyTarget(params: {
    loadedConfig: LoadedConfig;
    command: ParsedMessageCommand;
    accountId: string;
  }): AgentSessionTarget | null;
};
