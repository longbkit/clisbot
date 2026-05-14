import type { AgentService, AgentSessionTarget } from "../../agents/runtime/agent-service.ts";
import type { LoadedConfig } from "../../config/core/load-config.ts";
import type { ProcessedEventsStore } from "../message/processed-events-store.ts";
import type { ActivityStore } from "../../control/runtime/activity-store.ts";
import type { ChannelIdentity } from "../surface/channel-identity.ts";
import type {
  ChannelId,
  ChannelInteractionRenderer,
} from "./channel-surface-contract.ts";
import type { SurfacePromptContext } from "../surface/surface-prompt-context.ts";
import type {
  MessageAction,
  MessageChannel,
  MessageChildSurfaceKind,
  MessageChildSurfaceSelector,
  MessageInputFormat,
  MessageRenderMode,
  MessageSurfaceKind,
  ResolvedMessageSurface,
  ParsedCustomMessageCommand,
  ParsedMessageCommand,
} from "../message/message-command.ts";
import type { SurfaceRoute } from "../config/route-policy.ts";
import type {
  RuntimeChannelConnection,
} from "../../control/runtime/runtime-health-store.ts";
import type { ChannelOperatorInventory } from "./operator-inventory.ts";
import type { SurfaceNotificationsConfig } from "../config/surface-notifications.ts";

export type ChannelRuntimeService = {
  start(): Promise<void>;
  stop(): Promise<void>;
  getRuntimeIdentity?(): ChannelRuntimeIdentity | null;
};

export type ChannelRuntimeIdentity = {
  botId: string;
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
  ownerAlertAfterMs?: number;
  ownerAlertRepeatMs?: number;
};

export type ChannelRuntimeBot = {
  botId: string;
  config: unknown;
};

export type ChannelRuntimeEntry = {
  channel: ChannelId;
  botId: string;
  service: ChannelRuntimeService;
};

export type ChannelPluginCapabilities = {
  surfaceKinds: readonly MessageSurfaceKind[];
  messageActions: readonly MessageAction[];
  supportsMessageCustomSubtree: boolean;
};

export type ChannelControlSurfaceContext = {
  channel: ChannelId;
  botId: string;
  target: string;
  childSurface?: MessageChildSurfaceSelector;
  surface: ResolvedMessageSurface;
  sessionTarget: AgentSessionTarget;
  identity: ChannelIdentity;
  route: SurfaceRoute;
  promptConfig: {
    enabled: boolean;
    maxProgressMessages: number;
    requireFinalResponse: boolean;
  };
  buildLoopPromptText: (
    text: string,
    options?: {
      maxProgressMessagesOverride?: number;
    },
  ) => string;
};

export type ChannelBoundSurfaceRuntimeContext = {
  identity: ChannelIdentity;
  promptConfig: ChannelControlSurfaceContext["promptConfig"];
  responseMode: "capture-pane" | "message-tool";
  streaming: "off" | "latest" | "all";
  surfaceNotifications: SurfaceNotificationsConfig;
};

export type ProvisionedLoopChildSurface = {
  childSurface: MessageChildSurfaceSelector;
  deliveryTarget?: string;
};

export type ChannelOperatorGuidance = {
  dmFirstLine: string;
  pairingCodeLine?: string;
  onboardingLine?: string;
  setupMissingLine: string;
  addRouteLines: string[];
  overrideLine: string;
};

export type ChannelMessageHelp = {
  targetLines: string[];
  renderLines?: string[];
  lengthGuidanceLines?: string[];
  exampleLines: string[];
};

export type ChannelRouteHelp = {
  addSyntaxLines: string[];
  exampleLines: string[];
};

export type ChannelControlHelp = {
  message?: ChannelMessageHelp;
  routes?: ChannelRouteHelp;
};

export type ChannelChildSurfaceCli = {
  kind: MessageChildSurfaceKind;
  primaryFlag: string;
  aliasFlags?: readonly string[];
};

export type ChannelAgentReplyRendering = {
  inputFormat: MessageInputFormat;
  renderMode: MessageRenderMode;
  styleHint: string;
  resolveTarget(identity: ChannelIdentity): string | null;
  resolveChildSurface?(identity: ChannelIdentity): {
    flag: string;
    value: string;
  } | null;
};

export type ChannelLoopCliAddressingState = {
  channel?: MessageChannel;
  target?: string;
  childSurface?: MessageChildSurfaceSelector;
  botId?: string;
  provisionChildSurface: boolean;
};

export type ChannelLoopCliExtension = {
  stripExpressionArgs?(args: string[]): string[];
  resolveAddressing?(params: {
    intent: "help" | "create" | "list" | "status" | "cancel";
    args: string[];
    addressing: ChannelLoopCliAddressingState;
  }): ChannelLoopCliAddressingState;
  renderScopedCommandArgs?(params: {
    addressing: ChannelLoopCliAddressingState;
  }): string[];
};

export type ChannelBootstrapTokenField = "appToken" | "botToken";

export type ChannelBootstrapCli = {
  accountFlag?: string;
  tokenFlags: readonly {
    flag: string;
    field: ChannelBootstrapTokenField;
  }[];
  usageLine: string;
  renderExampleCommands?(commandName: "init" | "start"): string[];
};

export type ChannelPlugin = {
  id: ChannelId;
  displayName?: string;
  operatorInventory?: ChannelOperatorInventory;
  interactionRenderer?: ChannelInteractionRenderer;
  senderPrincipalExample?: string;
  buildDefaultDirectMessageTarget?(providerUserId: string): string;
  childSurfaceCli?: ChannelChildSurfaceCli;
  agentReply?: ChannelAgentReplyRendering;
  capabilities: ChannelPluginCapabilities;
  loopCli?: ChannelLoopCliExtension;
  bootstrapCli?: ChannelBootstrapCli;
  isEnabled(loadedConfig: LoadedConfig): boolean;
  listBots(loadedConfig: LoadedConfig): ChannelRuntimeBot[];
  createRuntimeService(
    context: ChannelRuntimeContext,
    bot: ChannelRuntimeBot,
  ): ChannelRuntimeService;
  describeStartupFailure?(error: unknown): {
    summary: string;
    detail?: string;
    actions: string[];
  };
  renderHealthSummary(state: "starting" | "disabled" | "stopped"): string;
  renderActiveHealthSummary(serviceCount: number): string;
  buildPromptSurface?(identity: ChannelIdentity): SurfacePromptContext["surface"];
  runMessageCommand(
    loadedConfig: LoadedConfig,
    command: ParsedMessageCommand,
    surface: ResolvedMessageSurface | null,
  ): Promise<{
    botId: string;
    result: unknown;
  }>;
  runCustomMessageCommand?(
    loadedConfig: LoadedConfig,
    command: ParsedCustomMessageCommand,
  ): Promise<unknown>;
  resolveMessageSurface(command: ParsedMessageCommand): ResolvedMessageSurface | null;
  resolveControlSurfaceContext?(params: {
    loadedConfig: LoadedConfig;
    target: string;
    childSurface?: MessageChildSurfaceSelector;
    botId?: string;
  }): ChannelControlSurfaceContext | null;
  resolveBoundSurfaceRuntimeContext?(params: {
    loadedConfig: LoadedConfig;
    identity: ChannelIdentity;
  }): ChannelBoundSurfaceRuntimeContext | null;
  renderLoopHelpLines?(params: {
    command: "overview" | "create";
  }): string[];
  renderControlTargetingHelpLines?(): string[];
  renderLoopExampleLines?(params: {
    command: "overview" | "create";
  }): string[];
  renderQueueExampleLines?(): string[];
  controlHelp?: ChannelControlHelp;
  operatorGuidance?: ChannelOperatorGuidance;
  provisionLoopChildSurface?(params: {
    loadedConfig: LoadedConfig;
    target: string;
    botId?: string;
    initialText: string;
  }): Promise<ProvisionedLoopChildSurface>;
  resolveMessageReplyTarget(params: {
    loadedConfig: LoadedConfig;
    command: ParsedMessageCommand;
    surface: ResolvedMessageSurface | null;
    botId: string;
  }): AgentSessionTarget | null;
};
