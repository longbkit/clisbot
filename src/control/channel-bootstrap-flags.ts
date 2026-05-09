import type {
  AgentBootstrapMode,
  AgentCliToolId,
} from "../config/agent-tool-presets.ts";
import { parseTokenInput, type ParsedTokenInput } from "../config/channel-credentials.ts";

export type ParsedSlackBotFlags = {
  botId: string;
  appToken?: ParsedTokenInput;
  botToken?: ParsedTokenInput;
};

export type ParsedTelegramBotFlags = {
  botId: string;
  botToken?: ParsedTokenInput;
};

export type ParsedZaloBotFlags = {
  botId: string;
  botToken?: ParsedTokenInput;
};

export type ParsedBootstrapFlags = {
  cliTool?: AgentCliToolId;
  bootstrap?: AgentBootstrapMode;
  persist: boolean;
  slackBots: ParsedSlackBotFlags[];
  telegramBots: ParsedTelegramBotFlags[];
  zaloBotBots: ParsedZaloBotFlags[];
  sawCredentialFlags: boolean;
  sawSlackFlags: boolean;
  sawTelegramFlags: boolean;
  sawZaloBotFlags: boolean;
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

function getOrCreateSlackBot(
  bots: ParsedSlackBotFlags[],
  botId: string,
) {
  let bot = bots.find((entry) => entry.botId === botId);
  if (!bot) {
    bot = { botId };
    bots.push(bot);
  }
  return bot;
}

function getOrCreateTelegramBot(
  bots: ParsedTelegramBotFlags[],
  botId: string,
) {
  let bot = bots.find((entry) => entry.botId === botId);
  if (!bot) {
    bot = { botId };
    bots.push(bot);
  }
  return bot;
}

function getOrCreateZaloBot(
  bots: ParsedZaloBotFlags[],
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

function validateSlackBot(bot: ParsedSlackBotFlags) {
  if (!bot.appToken || !bot.botToken) {
    throw new Error(`Slack bot ${bot.botId} requires both app token and bot token`);
  }
  if (bot.appToken.kind !== bot.botToken.kind) {
    throw new Error(
      `Slack bot ${bot.botId} must use one credential source kind for both app and bot tokens`,
    );
  }
}

function validateTelegramBot(bot: ParsedTelegramBotFlags) {
  if (!bot.botToken) {
    throw new Error(`Telegram bot ${bot.botId} requires a bot token`);
  }
}

function validateZaloBot(bot: ParsedZaloBotFlags) {
  if (!bot.botToken) {
    throw new Error(`Zalo Bot ${bot.botId} requires a bot token`);
  }
}

export function parseBootstrapFlags(args: string[]): ParsedBootstrapFlags {
  const slackBots: ParsedSlackBotFlags[] = [];
  const telegramBots: ParsedTelegramBotFlags[] = [];
  const zaloBotBots: ParsedZaloBotFlags[] = [];
  let currentSlackBotId: string | undefined;
  let currentTelegramBotId: string | undefined;
  let currentZaloBotId: string | undefined;
  let cliTool: AgentCliToolId | undefined;
  let bootstrap: AgentBootstrapMode | undefined;
  let persist = false;
  let sawCredentialFlags = false;
  let sawSlackFlags = false;
  let sawTelegramFlags = false;
  let sawZaloBotFlags = false;

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
    if (arg === "--slack-account") {
      const botId = parseOptionValue(args, arg, index);
      ensureUniqueBot(slackBots, botId, "--slack-account");
      currentSlackBotId = botId;
      getOrCreateSlackBot(slackBots, botId);
      sawSlackFlags = true;
      index += 1;
      continue;
    }
    if (arg === "--telegram-account") {
      const botId = parseOptionValue(args, arg, index);
      ensureUniqueBot(telegramBots, botId, "--telegram-account");
      currentTelegramBotId = botId;
      getOrCreateTelegramBot(telegramBots, botId);
      sawTelegramFlags = true;
      index += 1;
      continue;
    }
    if (arg === "--zalo-bot-account") {
      const botId = parseOptionValue(args, arg, index);
      ensureUniqueBot(zaloBotBots, botId, "--zalo-bot-account");
      currentZaloBotId = botId;
      getOrCreateZaloBot(zaloBotBots, botId);
      sawZaloBotFlags = true;
      index += 1;
      continue;
    }
    if (arg === "--slack-app-token") {
      const token = parseTokenInput(parseOptionValue(args, arg, index));
      const bot = getOrCreateSlackBot(slackBots, currentSlackBotId ?? "default");
      bot.appToken = token;
      sawCredentialFlags = true;
      sawSlackFlags = true;
      index += 1;
      continue;
    }
    if (arg === "--slack-bot-token") {
      const token = parseTokenInput(parseOptionValue(args, arg, index));
      const bot = getOrCreateSlackBot(slackBots, currentSlackBotId ?? "default");
      bot.botToken = token;
      sawCredentialFlags = true;
      sawSlackFlags = true;
      index += 1;
      continue;
    }
    if (arg === "--telegram-bot-token") {
      const token = parseTokenInput(parseOptionValue(args, arg, index));
      const bot = getOrCreateTelegramBot(
        telegramBots,
        currentTelegramBotId ?? "default",
      );
      bot.botToken = token;
      sawCredentialFlags = true;
      sawTelegramFlags = true;
      index += 1;
      continue;
    }
    if (arg === "--zalo-bot-token") {
      const token = parseTokenInput(parseOptionValue(args, arg, index));
      const bot = getOrCreateZaloBot(
        zaloBotBots,
        currentZaloBotId ?? "default",
      );
      bot.botToken = token;
      sawCredentialFlags = true;
      sawZaloBotFlags = true;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option for start/init: ${arg}`);
  }

  for (const bot of slackBots) {
    validateSlackBot(bot);
  }
  for (const bot of telegramBots) {
    validateTelegramBot(bot);
  }
  for (const bot of zaloBotBots) {
    validateZaloBot(bot);
  }

  return {
    cliTool,
    bootstrap,
    persist,
    slackBots,
    telegramBots,
    zaloBotBots,
    sawCredentialFlags,
    sawSlackFlags,
    sawTelegramFlags,
    sawZaloBotFlags,
    literalWarnings: [],
  };
}

export function hasLiteralBootstrapCredentials(flags: ParsedBootstrapFlags) {
  return (
    flags.slackBots.some(
      (bot) => isLiteralToken(bot.appToken) || isLiteralToken(bot.botToken),
    ) ||
    flags.telegramBots.some((bot) => isLiteralToken(bot.botToken)) ||
    flags.zaloBotBots.some((bot) => isLiteralToken(bot.botToken))
  );
}
