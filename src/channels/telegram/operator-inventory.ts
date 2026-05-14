import {
  resolveTelegramBotConfig,
  resolveTelegramDirectMessageConfig,
} from "./config.ts";
import { describeChannelCredentialSource } from "../../config/channels/channel-credentials.ts";
import { resolveSharedGroupsWildcardRoute } from "../../config/channels/group-routes.ts";
import { renderCliCommand } from "../../control/commands/cli-name.ts";
import type { ChannelOperatorInventory } from "../integration/operator-inventory.ts";
import {
  countConfiguredBotGroupSurfaces,
  describeBootstrapToken,
  deriveConfiguredChannelConnection,
  getBootstrapBotToken,
  renderExplicitBootstrapFlags,
} from "../integration/operator-inventory.ts";

const TELEGRAM_TOKEN_DOC_URL = "https://core.telegram.org/bots#6-botfather";

export const telegramChannelOperatorInventory: ChannelOperatorInventory = {
  startup: {
    channel: "telegram",
    statusLabel: "Telegram bot",
    getDefaultAvailability: (env) => Boolean(env.TELEGRAM_BOT_TOKEN?.trim()),
    getBootstrapAvailability: (bots, env) => {
      const bot = describeBootstrapToken(
        getBootstrapBotToken(bots, "botToken"),
        "TELEGRAM_BOT_TOKEN",
        env,
      );
      return Boolean(bot.hasValue);
    },
    renderBootstrapMissingLine: (bots, env) => {
      const bot = describeBootstrapToken(
        getBootstrapBotToken(bots, "botToken"),
        "TELEGRAM_BOT_TOKEN",
        env,
      );
      return bot.hasValue
        ? null
        : `Telegram channel: token not found (${bot.envName}), pass ${
          renderExplicitBootstrapFlags(["--telegram-bot-token"])
        } explicitly for Telegram bootstrap.`;
    },
    renderMissingTokenStatusLine: (env) => {
      const bot = describeBootstrapToken(
        undefined,
        "TELEGRAM_BOT_TOKEN",
        env,
      );
      return `Telegram token ref: ${bot.envName} (${bot.hasValue ? "set" : "missing"})`;
    },
    isEnabled: (config) => config.bots.telegram.defaults.enabled,
    getDefaultBotId: (config) => config.bots.telegram.defaults.defaultBotId || "default",
    describeCredentialSource: (config, env) =>
      describeChannelCredentialSource({
        config,
        channel: "telegram",
        env,
      }),
    renderDisabledConfiguredWarning: (configPath) => [
      "warning default Telegram token is available in TELEGRAM_BOT_TOKEN, but bots.telegram.defaults.enabled is false in the existing config.",
      `Run ${renderCliCommand("bots enable --channel telegram --bot default", { inline: true })} to enable Telegram quickly, or update ${configPath} manually.`,
    ],
    renderSetupHelpLines: () => [`Telegram docs: ${TELEGRAM_TOKEN_DOC_URL}`],
  },
  runtimeSummary: {
    order: 10,
    buildInput: ({ loadedConfig, runtimeRunning, activities, runtimeHealth }) => {
      const enabled = loadedConfig.raw.bots.telegram.defaults.enabled;
      const defaultBot = resolveTelegramBotConfig(
        loadedConfig.raw.bots.telegram,
        loadedConfig.raw.bots.telegram.defaults.defaultBotId,
      );
      const defaultDmConfig = resolveTelegramDirectMessageConfig(defaultBot);
      return {
        channel: "telegram",
        enabled,
        connection: deriveConfiguredChannelConnection({
          enabled,
          runtimeRunning,
          recordedConnection: runtimeHealth.channels.telegram?.connection,
        }),
        defaultAgentId:
          defaultBot.agentId ?? loadedConfig.raw.agents.defaults.defaultAgentId,
        streaming: defaultBot.streaming,
        response: defaultBot.response,
        responseMode: defaultBot.responseMode,
        additionalMessageMode: defaultBot.additionalMessageMode,
        configuredSurfaceCount: countConfiguredBotGroupSurfaces(
          loadedConfig.raw.bots.telegram,
          (group: { topics?: Record<string, unknown> }) => Object.keys(group.topics ?? {}).length,
        ),
        directMessagesEnabled: defaultDmConfig?.enabled !== false,
        directMessagesPolicy: defaultDmConfig?.policy ?? "disabled",
        sharedDefaultPolicy: resolveSharedGroupsWildcardRoute(defaultBot.groups)?.policy,
        activity: activities.channels.telegram,
        health: runtimeHealth.channels.telegram,
      };
    },
  },
};
