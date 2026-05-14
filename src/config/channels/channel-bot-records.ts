import type { ChannelBotRecord, ChannelProviderConfig } from "./channel-config-shapes.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeBotId(botId?: string | null) {
  const trimmed = botId?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveProvidedBotId(params: {
  botId?: string | null;
  accountId?: string | null;
}) {
  return normalizeBotId(params.botId ?? params.accountId);
}

export function getChannelProviderBotRecords(
  config: ChannelProviderConfig,
): Record<string, ChannelBotRecord | undefined> {
  const { defaults, ...bots } = config;
  return bots as Record<string, ChannelBotRecord | undefined>;
}

export function countStandardChannelBotRoutes(bot: ChannelBotRecord) {
  return Object.keys(bot.groups ?? {}).length + Object.keys(bot.directMessages ?? {}).length;
}

export function getConfiguredDefaultBotId(params: {
  defaultAccount?: string;
  defaultBotId?: string;
  accounts?: unknown;
  bots?: Record<string, unknown>;
}) {
  const explicit =
    normalizeBotId(params.defaultBotId) ??
    normalizeBotId(params.defaultAccount);
  if (explicit) {
    return explicit;
  }

  const bots = params.bots ??
    (isRecord(params.accounts) ? (params.accounts as Record<string, unknown>) : {});

  if ("default" in bots) {
    return "default";
  }

  const firstBotId = Object.keys(bots)[0];
  return normalizeBotId(firstBotId) ?? "default";
}

export function listEnabledBotIds<T extends { enabled?: boolean }>(
  bots: Record<string, T | undefined>,
) {
  return Object.entries(bots)
    .filter(([, bot]) => bot?.enabled !== false)
    .map(([botId]) => botId);
}
