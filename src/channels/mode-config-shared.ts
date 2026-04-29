import type { ClisbotConfig } from "../config/schema.ts";
import {
  createDirectMessageBehaviorOverride,
  resolveDirectMessageExactRoute,
  resolveDirectMessageWildcardRoute,
} from "../config/direct-message-routes.ts";
import type { ChannelIdentity } from "./channel-identity.ts";
import { resolveChannelIdentityBotId } from "./channel-identity.ts";
import {
  getSlackBotRecord,
  getTelegramBotRecord,
  resolveSlackBotId,
  resolveTelegramBotId,
} from "../config/channel-bots.ts";

export type ResponseMode = "capture-pane" | "message-tool";
export type AdditionalMessageMode = "queue" | "steer";
export type StreamingMode = "off" | "latest" | "all";
export type SurfaceModeChannel = "slack" | "telegram";
export type SurfaceModeField = "responseMode" | "additionalMessageMode" | "streaming";

export type ConfiguredSurfaceModeTarget = {
  channel: SurfaceModeChannel;
  botId?: string;
  target?: string;
};

type SurfaceModeValueMap = {
  responseMode: ResponseMode;
  additionalMessageMode: AdditionalMessageMode;
  streaming: StreamingMode;
};

type SurfaceModeSource = Partial<{
  [K in SurfaceModeField]: SurfaceModeValueMap[K];
}>;

type SurfaceModeTargetBinding<TField extends SurfaceModeField> = {
  get: () => SurfaceModeValueMap[TField] | undefined;
  set: (value: SurfaceModeValueMap[TField]) => void;
  label: string;
};

function createTelegramRouteOverride() {
  return {
    enabled: true,
    allowUsers: [] as string[],
    blockUsers: [] as string[],
  };
}

function getOrCreateTelegramGroupRoute(
  bot: NonNullable<ReturnType<typeof getTelegramBotRecord>>,
  chatId: string,
) {
  const existingGroup = bot.groups[chatId];
  if (existingGroup) {
    return existingGroup;
  }
  const createdGroup = {
    ...createTelegramRouteOverride(),
    topics: {} as Record<string, ReturnType<typeof createTelegramRouteOverride>>,
  };
  bot.groups[chatId] = createdGroup;
  return createdGroup;
}

function getOrCreateTelegramTopicRoute(
  bot: NonNullable<ReturnType<typeof getTelegramBotRecord>>,
  chatId: string,
  topicId: string,
) {
  const group = getOrCreateTelegramGroupRoute(bot, chatId);
  const existingTopic = group.topics[topicId];
  if (existingTopic) {
    return existingTopic;
  }
  const createdTopic = createTelegramRouteOverride();
  (group.topics as Record<string, ReturnType<typeof createTelegramRouteOverride>>)[topicId] =
    createdTopic;
  return createdTopic;
}

function getModeValue<TField extends SurfaceModeField>(
  source: (SurfaceModeSource & Record<string, unknown>) | undefined,
  field: TField,
) {
  return source?.[field] as SurfaceModeValueMap[TField] | undefined;
}

function setModeValue<TField extends SurfaceModeField>(
  source: SurfaceModeSource & Record<string, unknown>,
  field: TField,
  value: SurfaceModeValueMap[TField],
) {
  source[field] = value;
}

function renderFieldLabel(field: SurfaceModeField) {
  if (field === "responseMode") {
    return "response mode";
  }
  if (field === "additionalMessageMode") {
    return "additional message mode";
  }
  return "streaming";
}

function resolveDirectMessageModeTarget<TField extends SurfaceModeField>(params: {
  field: TField;
  botLabel: string;
  targetId: string;
  routes: Record<string, SurfaceModeSource & Record<string, unknown>>;
}) {
  const normalizedTargetId = params.targetId.trim();
  if (!normalizedTargetId) {
    throw new Error(
      `${params.botLabel} ${renderFieldLabel(params.field)} target must use dm:<id|*>.`,
    );
  }

  const routeKey = normalizedTargetId === "*" ? "*" : normalizedTargetId;
  const exactRoute = resolveDirectMessageExactRoute(params.routes, normalizedTargetId);
  const wildcardRoute = resolveDirectMessageWildcardRoute(params.routes);

  return {
    get: () =>
      getModeValue(exactRoute, params.field) ??
      getModeValue(wildcardRoute, params.field),
    set: (value: SurfaceModeValueMap[TField]) => {
      const route =
        params.routes[routeKey] ??
        (params.routes[routeKey] = createDirectMessageBehaviorOverride(wildcardRoute));
      setModeValue(route, params.field, value);
    },
    label: `${params.botLabel} ${routeKey}`,
  } satisfies SurfaceModeTargetBinding<TField>;
}

function resolveSlackConfigTarget<TField extends SurfaceModeField>(
  config: ClisbotConfig,
  field: TField,
  params: ConfiguredSurfaceModeTarget,
): SurfaceModeTargetBinding<TField> {
  const botId = resolveSlackBotId(config.bots.slack, params.botId);
  const bot = getSlackBotRecord(config.bots.slack, botId);
  if (!bot) {
    throw new Error(`Unknown Slack bot: ${botId}`);
  }

  if (!params.target) {
    return {
      get: () => getModeValue(bot, field),
      set: (value) => {
        setModeValue(bot, field, value);
      },
      label: `slack bot ${botId}`,
    };
  }

  const [kind, targetId] = params.target.split(":", 2);
  if (!targetId?.trim()) {
    throw new Error(
      `Slack ${renderFieldLabel(field)} target must use group:<id> or dm:<id>.`,
    );
  }

  if (kind === "dm") {
    const binding = resolveDirectMessageModeTarget({
      field,
      botLabel: "slack",
      targetId,
      routes: bot.directMessages,
    });
    return {
      ...binding,
      get: () => binding.get() ?? getModeValue(bot, field),
    };
  }

  if (kind === "channel" || kind === "group") {
    const routeKey = targetId.trim();
    const route = bot.groups[routeKey];
    if (!route) {
      throw new Error(`Route not configured yet: slack group:${routeKey}. Add the route first.`);
    }
    return {
      get: () => getModeValue(route, field) ?? getModeValue(bot, field),
      set: (value) => {
        setModeValue(route, field, value);
      },
      label: `slack group:${routeKey}`,
    };
  }

  throw new Error(
    `Slack ${renderFieldLabel(field)} target must use group:<id> or dm:<id>.`,
  );
}

function resolveTelegramConfigTarget<TField extends SurfaceModeField>(
  config: ClisbotConfig,
  field: TField,
  params: ConfiguredSurfaceModeTarget,
): SurfaceModeTargetBinding<TField> {
  const botId = resolveTelegramBotId(config.bots.telegram, params.botId);
  const bot = getTelegramBotRecord(config.bots.telegram, botId);
  if (!bot) {
    throw new Error(`Unknown Telegram bot: ${botId}`);
  }

  if (!params.target) {
    return {
      get: () => getModeValue(bot, field),
      set: (value) => {
        setModeValue(bot, field, value);
      },
      label: `telegram bot ${botId}`,
    };
  }

  const [kind, routeId, topicId] = params.target.split(":", 3);
  if (kind === "dm") {
    const targetId = routeId?.trim();
    if (!targetId) {
      throw new Error(`Telegram ${renderFieldLabel(field)} target must use dm:<id|*>.`);
    }
    const binding = resolveDirectMessageModeTarget({
      field,
      botLabel: "telegram",
      targetId,
      routes: bot.directMessages,
    });
    return {
      ...binding,
      get: () => binding.get() ?? getModeValue(bot, field),
    };
  }

  if (kind === "group") {
    const chatId = routeId?.trim();
    if (!chatId) {
      throw new Error(`Telegram ${renderFieldLabel(field)} target must use group:<chatId>.`);
    }
    const route = bot.groups[chatId];
    if (!route) {
      throw new Error(`Route not configured yet: telegram group:${chatId}. Add the route first.`);
    }
    return {
      get: () => getModeValue(route, field) ?? getModeValue(bot, field),
      set: (value) => {
        setModeValue(route, field, value);
      },
      label: `telegram group:${chatId}`,
    };
  }

  if (kind === "topic") {
    const chatId = routeId?.trim();
    const nextTopicId = topicId?.trim();
    if (!chatId || !nextTopicId) {
      throw new Error(
        `Telegram ${renderFieldLabel(field)} target must use topic:<chatId>:<topicId>.`,
      );
    }
    const group = bot.groups[chatId];
    const topic = group?.topics?.[nextTopicId];
    if (!group) {
      throw new Error(
        `Route not configured yet: telegram topic:${chatId}:${nextTopicId}. Add the route first.`,
      );
    }
    return {
      get: () =>
        getModeValue(topic, field) ??
        getModeValue(group, field) ??
        getModeValue(bot, field),
      set: (value) => {
        const nextTopic = getOrCreateTelegramTopicRoute(bot, chatId, nextTopicId);
        setModeValue(nextTopic, field, value);
      },
      label: `telegram topic:${chatId}:${nextTopicId}`,
    };
  }

  throw new Error(
    `Telegram ${renderFieldLabel(field)} target must use dm:<id|*>, group:<chatId>, or topic:<chatId>:<topicId>.`,
  );
}

export function resolveConfiguredSurfaceModeTarget<TField extends SurfaceModeField>(
  config: ClisbotConfig,
  field: TField,
  params: ConfiguredSurfaceModeTarget,
) {
  if (params.channel === "slack") {
    return resolveSlackConfigTarget(config, field, params);
  }

  return resolveTelegramConfigTarget(config, field, params);
}

export function buildConfiguredTargetFromIdentity(identity: ChannelIdentity) {
  if (identity.platform === "slack") {
    const target =
      identity.conversationKind === "dm"
      ? `dm:${identity.senderId ?? identity.channelId ?? "*"}`
        : `group:${identity.channelId ?? ""}`;

    return {
      channel: "slack" as const,
      botId: resolveChannelIdentityBotId(identity),
      target,
    };
  }

  const target =
    identity.conversationKind === "dm"
      ? `dm:${identity.senderId ?? identity.chatId ?? "*"}`
      : identity.conversationKind === "topic"
        ? `topic:${identity.chatId ?? ""}:${identity.topicId ?? ""}`
        : `group:${identity.chatId ?? ""}`;

  return {
    channel: "telegram" as const,
    botId: resolveChannelIdentityBotId(identity),
    target,
  };
}
