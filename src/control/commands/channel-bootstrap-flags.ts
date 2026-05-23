import type {
  AgentBootstrapMode,
  AgentCliToolId,
} from "../../config/runtime/agent-tool-presets.ts";
import { parseTokenInput, type ParsedTokenInput } from "../../config/channels/channel-credentials.ts";
import type { ChannelBootstrapBotInput } from "../../config/channels/channel-bootstrap.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import type { ChannelBootstrapTokenField } from "../../channels/integration/channel-plugin.ts";
import {
  hasLiteralBootstrapBotCredentials,
} from "../../channels/integration/operator-inventory.ts";
import {
  listChannelPlugins,
  parseRegisteredChannelOrThrow,
} from "../../channels/catalog/registry.ts";

export type ParsedBootstrapBotMap = Record<ChannelId, ChannelBootstrapBotInput[]>;

export type ParsedBootstrapFlags = {
  cliTool?: AgentCliToolId;
  bootstrap?: AgentBootstrapMode;
  persist: boolean;
  bots: ParsedBootstrapBotMap;
  sawCredentialFlags: boolean;
  sawChannels: Record<ChannelId, boolean>;
  literalWarnings: string[];
};

function isLiteralToken(token?: ParsedTokenInput) {
  return token?.kind === "mem";
}

export function parseBotType(rawValue: string) {
  const value = rawValue.trim().toLowerCase();
  if (value === "personal") {
    return "personal-assistant" satisfies AgentBootstrapMode;
  }
  if (value === "team") {
    return "team-assistant" satisfies AgentBootstrapMode;
  }
  throw new Error(`Invalid bot type: ${rawValue}. Expected personal or team.`);
}

function parseOptionValue(args: string[], name: string, index: number) {
  const value = args[index + 1]?.trim();
  if (!value) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function getOrCreateBootstrapBot(
  bots: ChannelBootstrapBotInput[],
  botId: string,
) {
  let bot = bots.find((entry) => entry.botId === botId);
  if (!bot) {
    bot = { botId };
    bots.push(bot);
  }
  return bot;
}

function ensureUniqueBot(bots: Array<{ botId: string }>, botId: string, flagName: string) {
  if (bots.some((entry) => entry.botId === botId)) {
    throw new Error(`Duplicate ${flagName} ${botId}`);
  }
}

function renderRequiredBootstrapTokens(fields: readonly ChannelBootstrapTokenField[]) {
  if (fields.length === 2 && fields.includes("appToken") && fields.includes("botToken")) {
    return "both app token and bot token";
  }
  if (fields.length === 1 && fields[0] === "botToken") {
    return "a bot token";
  }
  if (fields.length === 1 && fields[0] === "appToken") {
    return "an app token";
  }
  return fields.join(" and ");
}

function renderMixedBootstrapSources(fields: readonly ChannelBootstrapTokenField[]) {
  if (fields.length === 2 && fields.includes("appToken") && fields.includes("botToken")) {
    return "both app and bot tokens";
  }
  return fields.join(" and ");
}

function hasQrBootstrap(plugin: ReturnType<typeof listChannelPlugins>[number]) {
  return plugin.id === "zalo-personal";
}

function validateBootstrapBot(params: {
  label: string;
  bot: ChannelBootstrapBotInput;
  requiredFields: readonly ChannelBootstrapTokenField[];
}) {
  const missingFields = params.requiredFields.filter((field) => !params.bot[field]);
  if (missingFields.length > 0) {
    throw new Error(
      `${params.label} bot ${params.bot.botId} requires ${renderRequiredBootstrapTokens(params.requiredFields)}`,
    );
  }
  const tokenKinds = params.requiredFields
    .map((field) => params.bot[field]?.kind)
    .filter((kind): kind is ParsedTokenInput["kind"] => Boolean(kind));
  if (tokenKinds.length > 1 && tokenKinds.some((kind) => kind !== tokenKinds[0])) {
    throw new Error(
      `${params.label} bot ${params.bot.botId} must use one credential source kind for ${renderMixedBootstrapSources(params.requiredFields)}`,
    );
  }
}

type ChannelBootstrapState = {
  bots: ChannelBootstrapBotInput[];
  label: string;
  requiredFields: readonly ChannelBootstrapTokenField[];
  getCurrentBotId: () => string | undefined;
  setCurrentBotId: (botId: string) => void;
  markSeen: () => void;
};

function createEmptyParsedBootstrapBotMap(): ParsedBootstrapBotMap {
  return Object.fromEntries(
    listChannelPlugins().map((plugin) => [plugin.id, []]),
  ) as unknown as ParsedBootstrapBotMap;
}

function createEmptyChannelSeenMap() {
  return Object.fromEntries(
    listChannelPlugins().map((plugin) => [plugin.id, false]),
  ) as Record<ChannelId, boolean>;
}

export function parseBootstrapFlags(args: string[]): ParsedBootstrapFlags {
  const bots = createEmptyParsedBootstrapBotMap();
  const currentBotIds = new Map<ChannelId, string | undefined>();
  let cliTool: AgentCliToolId | undefined;
  let bootstrap: AgentBootstrapMode | undefined;
  let persist = false;
  let sawCredentialFlags = false;
  let currentGenericChannel: ChannelId | undefined;
  const sawChannels = createEmptyChannelSeenMap();
  const channelStates = Object.fromEntries(
    listChannelPlugins().map((plugin) => [
      plugin.id,
      {
        bots: bots[plugin.id],
        label: plugin.displayName ?? plugin.id,
        requiredFields: plugin.bootstrapCli?.tokenFlags.map((tokenFlag) => tokenFlag.field) ?? [],
        getCurrentBotId: () => currentBotIds.get(plugin.id),
        setCurrentBotId: (botId: string) => {
          currentBotIds.set(plugin.id, botId);
        },
        markSeen: () => {
          sawChannels[plugin.id] = true;
        },
      } satisfies ChannelBootstrapState,
    ]),
  ) as unknown as Record<ChannelId, ChannelBootstrapState>;

  const accountFlags = listChannelPlugins()
    .flatMap((plugin) => plugin.bootstrapCli?.accountFlag
      ? [{
        channel: plugin.id,
        flag: plugin.bootstrapCli.accountFlag,
      }]
      : []);
  const tokenFlags = listChannelPlugins()
    .flatMap((plugin) =>
      (plugin.bootstrapCli?.tokenFlags ?? []).map((tokenFlag) => ({
        channel: plugin.id,
        flag: tokenFlag.flag,
        field: tokenFlag.field,
      })));

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cli") {
      cliTool = parseOptionValue(args, arg, index) as AgentCliToolId;
      index += 1;
      continue;
    }
    if (arg === "--bot-type") {
      bootstrap = parseBotType(parseOptionValue(args, arg, index));
      index += 1;
      continue;
    }
    if (arg === "--persist") {
      persist = true;
      continue;
    }
    if (arg === "--confirm") {
      continue;
    }
    if (arg === "--channel") {
      const channel = parseRegisteredChannelOrThrow(parseOptionValue(args, arg, index));
      const plugin = listChannelPlugins().find((entry) => entry.id === channel);
      if (!plugin?.bootstrapCli || !hasQrBootstrap(plugin)) {
        throw new Error(`--channel ${channel} is not a QR bootstrap channel.`);
      }
      currentGenericChannel = channel;
      channelStates[channel].markSeen();
      getOrCreateBootstrapBot(
        channelStates[channel].bots,
        channelStates[channel].getCurrentBotId() ?? "default",
      );
      sawCredentialFlags = true;
      index += 1;
      continue;
    }
    if (arg === "--bot") {
      if (!currentGenericChannel) {
        throw new Error("--bot requires --channel for start/init bootstrap.");
      }
      const botId = parseOptionValue(args, arg, index);
      const state = channelStates[currentGenericChannel];
      const qrPath = state.bots[0]?.qrPath;
      state.bots.splice(0, state.bots.length);
      state.setCurrentBotId(botId);
      getOrCreateBootstrapBot(state.bots, botId).qrPath = qrPath;
      state.markSeen();
      index += 1;
      continue;
    }
    if (arg === "--qr-path") {
      if (!currentGenericChannel) {
        throw new Error("--qr-path requires --channel for start/init bootstrap.");
      }
      const plugin = listChannelPlugins().find((entry) => entry.id === currentGenericChannel);
      if (!plugin || !hasQrBootstrap(plugin)) {
        throw new Error(`--qr-path is not supported for ${currentGenericChannel}.`);
      }
      const state = channelStates[currentGenericChannel];
      const bot = getOrCreateBootstrapBot(state.bots, state.getCurrentBotId() ?? "default");
      bot.qrPath = parseOptionValue(args, arg, index);
      sawCredentialFlags = true;
      state.markSeen();
      index += 1;
      continue;
    }
    const accountEntry = accountFlags.find((entry) => entry.flag === arg);
    if (accountEntry) {
      const state = channelStates[accountEntry.channel];
      const botId = parseOptionValue(args, arg, index);
      ensureUniqueBot(state.bots, botId, arg);
      state.setCurrentBotId(botId);
      getOrCreateBootstrapBot(state.bots, botId);
      state.markSeen();
      index += 1;
      continue;
    }
    const tokenEntry = tokenFlags.find((entry) => entry.flag === arg);
    if (tokenEntry) {
      const state = channelStates[tokenEntry.channel];
      const token = parseTokenInput(parseOptionValue(args, arg, index));
      const bot = getOrCreateBootstrapBot(state.bots, state.getCurrentBotId() ?? "default");
      bot[tokenEntry.field] = token;
      sawCredentialFlags = true;
      state.markSeen();
      index += 1;
      continue;
    }

    throw new Error(`Unknown option for start/init: ${arg}`);
  }

  for (const state of Object.values(channelStates)) {
    for (const bot of state.bots) {
      validateBootstrapBot({
        label: state.label,
        bot,
        requiredFields: state.requiredFields,
      });
    }
  }

  return {
    cliTool,
    bootstrap,
    persist,
    bots,
    sawCredentialFlags,
    sawChannels,
    literalWarnings: [],
  };
}

export function hasLiteralBootstrapCredentials(flags: ParsedBootstrapFlags) {
  return listChannelPlugins().some((plugin) => {
    const requiredFields = plugin.bootstrapCli?.tokenFlags.map((tokenFlag) => tokenFlag.field) ?? [];
    return flags.bots[plugin.id].some((bot) =>
      requiredFields.some((field) => isLiteralToken(bot[field])) &&
      requiredFields.every((field) => bot[field]),
    );
  });
}

export function collectLiteralBootstrapBotIds(flags: ParsedBootstrapFlags) {
  const activeBotIds = Object.fromEntries(
    listChannelPlugins().map((plugin) => [plugin.id, new Set<string>()]),
  ) as Record<ChannelId, Set<string>>;

  for (const plugin of listChannelPlugins()) {
    const requiredFields = plugin.bootstrapCli?.tokenFlags.map((tokenFlag) => tokenFlag.field) ?? [];
    for (const bot of flags.bots[plugin.id]) {
      if (requiredFields.length === 0) {
        continue;
      }
      if (!requiredFields.every((field) => bot[field])) {
        continue;
      }
      if (hasLiteralBootstrapBotCredentials(bot, requiredFields)) {
        activeBotIds[plugin.id].add(bot.botId);
      }
    }
  }

  return activeBotIds;
}
