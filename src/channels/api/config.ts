import type { ChannelProviderConfig } from "../../config/channels/channel-config-shapes.ts";
import {
  requireChannelProviderBotRecord,
  listEnabledChannelProviderBotIds,
  mergeStandardChannelGroupRoutes,
  resolveChannelProviderBotConfig,
  resolveChannelProviderBotId,
  resolveChannelDirectMessageConfig,
  type ResolvedChannelBotConfig,
} from "../../config/channels/channel-bot-resolution.ts";

export type ApiAuthConfig =
  | {
      mode: "hmac";
      secretEnv: string;
      timestampHeader?: string;
      signatureHeader: string;
      signaturePrefix?: string;
      signingBase?: string;
      toleranceSecondsEnv?: string;
      toleranceSecondsDefault?: number;
    }
  | {
      mode: "bearer";
      tokenEnv: string;
      header?: string;
      scheme?: string;
    }
  | {
      mode: "none";
    };

export type ApiFilterConfig =
  | { all: ApiFilterConfig[] }
  | { any: ApiFilterConfig[] }
  | { not: ApiFilterConfig }
  | {
      path: string;
      equals?: unknown;
      notEquals?: unknown;
      exists?: boolean;
      in?: unknown[];
      anyIn?: unknown[];
    };

export type ApiMapProjection = {
  from: string;
  map: Record<string, ApiMapValue>;
};

export type ApiMapValue =
  | string
  | number
  | boolean
  | null
  | ApiMapProjection
  | ApiMapValue[]
  | { [key: string]: ApiMapValue };

export type ApiIngressConfig = {
  successStatusCode: 200 | 202;
  auth: ApiAuthConfig;
  filter?: ApiFilterConfig;
  map: Record<string, ApiMapValue>;
};

export type ApiActionConfig = {
  method: "POST" | "PUT" | "PATCH";
  url: string;
  headers?: Record<string, ApiMapValue>;
  body?: ApiMapValue;
  rendering?: {
    native?: "text" | "markdown";
  };
  retry?: {
    mode?: "none";
  };
};

export type ApiResolvedBotConfig = ResolvedChannelBotConfig & {
  ingress: ApiIngressConfig;
  actions?: {
    "message.send"?: ApiActionConfig;
  };
};

export type ApiProviderConfig = ChannelProviderConfig & {
  defaults: ChannelProviderConfig["defaults"] & {
    listener: {
      host: string;
      port: number;
    };
  };
};

export function resolveApiProviderConfig(config: ChannelProviderConfig) {
  return config as ApiProviderConfig;
}

export function listApiBotIds(config: ChannelProviderConfig) {
  return listEnabledChannelProviderBotIds(config);
}

export function resolveApiBotId(config: ChannelProviderConfig, botId?: string | null) {
  return resolveChannelProviderBotId(config, botId);
}

export function resolveApiBotConfig(
  config: ChannelProviderConfig,
  botId?: string | null,
): ApiResolvedBotConfig {
  const resolved = resolveChannelProviderBotConfig({
    config,
    providerLabel: "API",
    botId,
    mergeGroups: mergeStandardChannelGroupRoutes,
  });
  const botConfig = requireChannelProviderBotRecord({
    config,
    botId: resolved.id,
    providerLabel: "API",
  }) as unknown as {
    ingress: ApiIngressConfig;
    actions?: ApiResolvedBotConfig["actions"];
  };
  return {
    ...resolved,
    ingress: botConfig.ingress,
    actions: botConfig.actions ?? {},
  } as ApiResolvedBotConfig;
}

export function resolveApiDirectMessageConfig(
  config: ApiResolvedBotConfig,
  surfaceId?: string | number | null,
) {
  return resolveChannelDirectMessageConfig(config, surfaceId);
}
