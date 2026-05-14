import type { LoadedConfig } from "../../config/core/load-config.ts";
import type { ChannelBootstrapBotInput } from "../../config/channels/channel-bootstrap.ts";
import type { ClisbotConfig } from "../../config/core/schema.ts";
import type { ChannelHealthRecord, RuntimeChannelConnection } from "../../control/runtime/runtime-health-store.ts";
import { isSharedGroupsWildcardRouteId } from "../../config/channels/group-routes.ts";
import type { ChannelId } from "./channel-surface-contract.ts";
import { describeEnvReference } from "../../config/env/env-references.ts";
import type { ChannelBootstrapTokenField } from "./channel-plugin.ts";

export type ChannelStartupAvailability = Record<ChannelId, boolean>;

export type ChannelStartupDescriptor = {
  channel: ChannelId;
  statusLabel: string;
  getDefaultAvailability(env: NodeJS.ProcessEnv): boolean;
  getBootstrapAvailability(
    bots: readonly ChannelBootstrapBotInput[],
    env: NodeJS.ProcessEnv,
  ): boolean;
  renderBootstrapMissingLine(
    bots: readonly ChannelBootstrapBotInput[],
    env: NodeJS.ProcessEnv,
  ): string | null;
  renderMissingTokenStatusLine(env: NodeJS.ProcessEnv): string;
  isEnabled(config: ClisbotConfig): boolean;
  getDefaultBotId(config: ClisbotConfig): string;
  describeCredentialSource(
    config: ClisbotConfig,
    env: NodeJS.ProcessEnv,
  ): { detail: string };
  renderDisabledConfiguredWarning(configPath: string): string[];
  renderSetupHelpLines?(): string[];
};

export type ChannelActivityRecord = {
  updatedAt?: string;
  agentId?: string;
};

export type ChannelActivityDocument = {
  channels: Partial<Record<ChannelId, ChannelActivityRecord>>;
};

export type ChannelRuntimeHealthDocument = {
  channels: Partial<Record<ChannelId, ChannelHealthRecord>>;
};

export type ChannelRuntimeSummaryInput = {
  channel: ChannelId;
  enabled: boolean;
  connection: RuntimeChannelConnection;
  defaultAgentId: string;
  streaming: "off" | "latest" | "all";
  response: "all" | "final";
  responseMode: "capture-pane" | "message-tool";
  additionalMessageMode: "queue" | "steer";
  configuredSurfaceCount: number;
  directMessagesEnabled: boolean;
  directMessagesPolicy: string;
  sharedDefaultPolicy?: string;
  activity?: ChannelActivityRecord;
  health?: ChannelHealthRecord;
};

export type ChannelRuntimeSummaryBuilder = (params: {
  loadedConfig: LoadedConfig;
  runtimeRunning: boolean;
  activities: ChannelActivityDocument;
  runtimeHealth: ChannelRuntimeHealthDocument;
}) => ChannelRuntimeSummaryInput;

export type ChannelRuntimeSummaryDescriptor = {
  order?: number;
  buildInput: ChannelRuntimeSummaryBuilder;
};

export type ChannelOperatorInventory = {
  startup?: ChannelStartupDescriptor;
  runtimeSummary?: ChannelRuntimeSummaryDescriptor;
};

export function getBootstrapBotToken(
  bots: readonly ChannelBootstrapBotInput[],
  field: ChannelBootstrapTokenField,
) {
  return bots.find((bot) => bot[field] != null)?.[field];
}

export function hasLiteralBootstrapBotCredentials(
  bot: ChannelBootstrapBotInput,
  fields: readonly ChannelBootstrapTokenField[],
) {
  return fields.every((field) => bot[field]?.kind === "mem");
}

export function renderExplicitBootstrapFlags(flags: readonly string[]) {
  if (flags.length === 0) {
    return "explicit channel flags";
  }
  if (flags.length === 1) {
    return flags[0]!;
  }
  const [first, ...rest] = flags;
  return `${first} plus ${rest.join(" plus ")}`;
}

export function countConfiguredSurfaces<TGroupRoute>(
  groups: Record<string, TGroupRoute>,
  childSurfaceCounter?: (group: TGroupRoute) => number,
) {
  return Object.entries(groups).reduce((total, [groupId, group]) => {
    if (isSharedGroupsWildcardRouteId(groupId)) {
      return total;
    }
    return total + 1 + (childSurfaceCounter?.(group) ?? 0);
  }, 0);
}

export function countConfiguredBotGroupSurfaces<TBot extends { groups?: Record<string, TGroupRoute> }, TGroupRoute>(
  providerConfig: Record<string, TBot | unknown>,
  childSurfaceCounter?: (group: TGroupRoute) => number,
) {
  return Object.entries(providerConfig)
    .filter(([botId]) => botId !== "defaults")
    .reduce((total, [, bot]) => {
      const groups = typeof bot === "object" && bot !== null && "groups" in bot
        ? ((bot.groups as Record<string, TGroupRoute> | undefined) ?? {})
        : {};
      return total + countConfiguredSurfaces(groups, childSurfaceCounter);
    }, 0);
}

export function describeBootstrapToken(
  token: ReturnType<typeof getBootstrapBotToken>,
  fallbackEnvName: string,
  env: NodeJS.ProcessEnv,
) {
  if (token?.kind === "mem") {
    return {
      envName: "literal",
      hasValue: true,
    };
  }
  return describeEnvReference(
    token?.kind === "env" ? token.placeholder : fallbackEnvName,
    fallbackEnvName,
    env,
  );
}

export function deriveConfiguredChannelConnection(params: {
  enabled: boolean;
  runtimeRunning: boolean;
  recordedConnection?: RuntimeChannelConnection;
}) {
  if (!params.enabled) {
    return "disabled" as const;
  }
  if (params.recordedConnection === "failed") {
    return "failed" as const;
  }
  if (!params.runtimeRunning) {
    return "stopped" as const;
  }
  return params.recordedConnection ?? "active";
}
