import type { ClisbotConfig } from "../config/schema.ts";
import type { ChannelInteractionIdentity } from "./interaction-processing.ts";
import { renderTelegramRouteChoiceMessage } from "./telegram/route-guidance.ts";

export type ResponseMode = "capture-pane" | "message-tool";
export type AdditionalMessageMode = "queue" | "steer";
export type SurfaceModeChannel = "slack" | "telegram";
export type SurfaceModeField = "responseMode" | "additionalMessageMode";

export type ConfiguredSurfaceModeTarget = {
  channel: SurfaceModeChannel;
  target?: string;
  topic?: string;
};

type SurfaceModeValueMap = {
  responseMode: ResponseMode;
  additionalMessageMode: AdditionalMessageMode;
};

type SurfaceModeTargetBinding<TField extends SurfaceModeField> = {
  get: () => SurfaceModeValueMap[TField] | undefined;
  set: (value: SurfaceModeValueMap[TField]) => void;
  label: string;
};

function getModeValue<TField extends SurfaceModeField>(
  source: Partial<Record<SurfaceModeField, ResponseMode | AdditionalMessageMode>>,
  field: TField,
) {
  return source[field] as SurfaceModeValueMap[TField] | undefined;
}

function setModeValue<TField extends SurfaceModeField>(
  source: Partial<Record<SurfaceModeField, ResponseMode | AdditionalMessageMode>>,
  field: TField,
  value: SurfaceModeValueMap[TField],
) {
  source[field] = value;
}

function resolveSlackConfigTarget<TField extends SurfaceModeField>(
  config: ClisbotConfig,
  field: TField,
  params: {
    target?: string;
    conversationKind?: ChannelInteractionIdentity["conversationKind"];
  },
): SurfaceModeTargetBinding<TField> {
  if (!params.target) {
    return {
      get: () => getModeValue(config.channels.slack, field),
      set: (value) => {
        setModeValue(config.channels.slack, field, value);
      },
      label: "slack",
    };
  }

  const [kind, rawId] = params.target.split(":", 2);
  const targetId = rawId?.trim();

  if (!targetId) {
    throw new Error(`Slack ${renderFieldLabel(field)} target must use channel:<id>, group:<id>, or dm:<id>.`);
  }

  if (kind === "dm" || params.conversationKind === "dm") {
    return {
      get: () =>
        getModeValue(config.channels.slack.directMessages, field) ??
        getModeValue(config.channels.slack, field),
      set: (value) => {
        setModeValue(config.channels.slack.directMessages, field, value);
      },
      label: `slack dm ${targetId}`,
    };
  }

  if (kind === "channel") {
    const route = config.channels.slack.channels[targetId];
    if (!route) {
      throw new Error(`Route not configured yet: slack channel ${targetId}. Add the route first.`);
    }
    return {
      get: () => getModeValue(route, field) ?? getModeValue(config.channels.slack, field),
      set: (value) => {
        setModeValue(route, field, value);
      },
      label: `slack channel ${targetId}`,
    };
  }

  if (kind === "group") {
    const route = config.channels.slack.groups[targetId];
    if (!route) {
      throw new Error(`Route not configured yet: slack group ${targetId}. Add the route first.`);
    }
    return {
      get: () => getModeValue(route, field) ?? getModeValue(config.channels.slack, field),
      set: (value) => {
        setModeValue(route, field, value);
      },
      label: `slack group ${targetId}`,
    };
  }

  throw new Error(`Slack ${renderFieldLabel(field)} target must use channel:<id>, group:<id>, or dm:<id>.`);
}

function resolveTelegramConfigTarget<TField extends SurfaceModeField>(
  config: ClisbotConfig,
  field: TField,
  params: {
    target?: string;
    topic?: string;
    conversationKind?: ChannelInteractionIdentity["conversationKind"];
  },
): SurfaceModeTargetBinding<TField> {
  if (!params.target) {
    return {
      get: () => getModeValue(config.channels.telegram, field),
      set: (value) => {
        setModeValue(config.channels.telegram, field, value);
      },
      label: "telegram",
    };
  }

  const chatId = params.target.trim();
  if (!chatId) {
    throw new Error(`Telegram ${renderFieldLabel(field)} target must be a numeric chat id.`);
  }

  const topicId = params.topic?.trim();
  const isDirectMessage = !chatId.startsWith("-") || params.conversationKind === "dm";
  if (isDirectMessage) {
    if (topicId) {
      throw new Error("Telegram direct-message targets do not support --topic.");
    }
    return {
      get: () =>
        getModeValue(config.channels.telegram.directMessages, field) ??
        getModeValue(config.channels.telegram, field),
      set: (value) => {
        setModeValue(config.channels.telegram.directMessages, field, value);
      },
      label: `telegram dm ${chatId}`,
    };
  }

  const group = config.channels.telegram.groups[chatId];
  if (!group) {
    throw new Error(renderTelegramRouteChoiceMessage({ chatId }));
  }

  if (topicId) {
    const topic = group.topics?.[topicId];
    if (!topic) {
      throw new Error(renderTelegramRouteChoiceMessage({ chatId, topicId }));
    }
    return {
      get: () =>
        getModeValue(topic, field) ??
        getModeValue(group, field) ??
        getModeValue(config.channels.telegram, field),
      set: (value) => {
        setModeValue(topic, field, value);
      },
      label: `telegram topic ${chatId}/${topicId}`,
    };
  }

  return {
    get: () => getModeValue(group, field) ?? getModeValue(config.channels.telegram, field),
    set: (value) => {
      setModeValue(group, field, value);
    },
    label: `telegram group ${chatId}`,
  };
}

export function resolveConfiguredSurfaceModeTarget<TField extends SurfaceModeField>(
  config: ClisbotConfig,
  field: TField,
  params: ConfiguredSurfaceModeTarget & {
    conversationKind?: ChannelInteractionIdentity["conversationKind"];
  },
) {
  if (params.channel === "slack") {
    return resolveSlackConfigTarget(config, field, {
      target: params.target,
      conversationKind: params.conversationKind,
    });
  }

  return resolveTelegramConfigTarget(config, field, {
    target: params.target,
    topic: params.topic,
    conversationKind: params.conversationKind,
  });
}

export function buildConfiguredTargetFromIdentity(identity: ChannelInteractionIdentity) {
  return {
    channel: identity.platform,
    target:
      identity.platform === "slack"
        ? identity.conversationKind === "dm"
          ? `dm:${identity.channelId ?? ""}`
          : `${identity.conversationKind === "group" ? "group" : "channel"}:${identity.channelId ?? ""}`
        : identity.chatId,
    topic: identity.topicId,
    conversationKind: identity.conversationKind,
  } satisfies ConfiguredSurfaceModeTarget & {
    conversationKind: ChannelInteractionIdentity["conversationKind"];
  };
}

function renderFieldLabel(field: SurfaceModeField) {
  return field === "responseMode" ? "response-mode" : "additional-message-mode";
}
