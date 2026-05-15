import { resolveZaloBotConfig } from "./config.ts";
import { describeChannelCredentialSource } from "../../config/channels/channel-credentials.ts";
import { renderCliCommand } from "../../control/commands/cli-name.ts";
import type { ChannelOperatorInventory } from "../integration/operator-inventory.ts";
import {
  countConfiguredBotDirectMessageSurfaces,
  describeBootstrapToken,
  deriveConfiguredChannelConnection,
  getBootstrapBotToken,
  renderExplicitBootstrapFlags,
  resolveRuntimeSummaryDefaultBot,
  resolveRuntimeSummaryDirectMessageConfig,
} from "../integration/operator-inventory.ts";

export const zaloBotChannelOperatorInventory: ChannelOperatorInventory = {
  startup: {
    channel: "zalo-bot",
    statusLabel: "Zalo Bot",
    getDefaultAvailability: (env) => Boolean(env.ZALO_BOT_TOKEN?.trim()),
    getBootstrapAvailability: (bots, env) => {
      const bot = describeBootstrapToken(
        getBootstrapBotToken(bots, "botToken"),
        "ZALO_BOT_TOKEN",
        env,
      );
      return Boolean(bot.hasValue);
    },
    renderBootstrapMissingLine: (bots, env) => {
      const bot = describeBootstrapToken(
        getBootstrapBotToken(bots, "botToken"),
        "ZALO_BOT_TOKEN",
        env,
      );
      return bot.hasValue
        ? null
        : `Zalo Bot channel: token not found (${bot.envName}), pass ${
          renderExplicitBootstrapFlags(["--zalo-bot-token"])
        } explicitly for Zalo Bot bootstrap.`;
    },
    renderMissingTokenStatusLine: (env) => {
      const bot = describeBootstrapToken(undefined, "ZALO_BOT_TOKEN", env);
      return `Zalo Bot token ref: ${bot.envName} (${bot.hasValue ? "set" : "missing"})`;
    },
    isEnabled: (config) => config.bots.zaloBot.defaults.enabled,
    getDefaultBotId: (config) => config.bots.zaloBot.defaults.defaultBotId || "default",
    describeCredentialSource: (config, env) =>
      describeChannelCredentialSource({
        config,
        channel: "zalo-bot",
        env,
      }),
    renderDisabledConfiguredWarning: (configPath) => [
      "warning default Zalo Bot token is available in ZALO_BOT_TOKEN, but bots.zaloBot.defaults.enabled is false in the existing config.",
      `Run ${renderCliCommand("bots enable --channel zalo-bot --bot default", { inline: true })} to enable Zalo Bot quickly, or update ${configPath} manually.`,
    ],
  },
  runtimeSummary: {
    order: 30,
    buildInput: ({ loadedConfig, runtimeRunning, activities, runtimeHealth }) => {
      const enabled = loadedConfig.raw.bots.zaloBot.defaults.enabled;
      const defaultBot = resolveRuntimeSummaryDefaultBot({
        providerConfig: loadedConfig.raw.bots.zaloBot,
        resolveBotConfig: (botId) => resolveZaloBotConfig(loadedConfig.raw.bots.zaloBot, botId),
      });
      const defaultDmConfig = resolveRuntimeSummaryDirectMessageConfig(defaultBot);
      return {
        channel: "zalo-bot",
        enabled,
        connection: deriveConfiguredChannelConnection({
          enabled,
          runtimeRunning,
          recordedConnection: runtimeHealth.channels["zalo-bot"]?.connection,
        }),
        defaultAgentId:
          defaultBot.agentId ?? loadedConfig.raw.agents.defaults.defaultAgentId,
        streaming: defaultBot.streaming,
        response: defaultBot.response,
        responseMode: defaultBot.responseMode,
        additionalMessageMode: defaultBot.additionalMessageMode,
        configuredSurfaceCount: countConfiguredBotDirectMessageSurfaces(loadedConfig.raw.bots.zaloBot),
        directMessagesEnabled: defaultDmConfig?.enabled !== false,
        directMessagesPolicy: defaultDmConfig?.policy ?? "disabled",
        activity: activities.channels["zalo-bot"],
        health: runtimeHealth.channels["zalo-bot"],
      };
    },
  },
};
