import { resolveSlackBotConfig } from "./config.ts";
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
  resolveRuntimeSummaryDefaultBot,
  resolveRuntimeSummaryDirectMessageConfig,
} from "../integration/operator-inventory.ts";

const SLACK_TOKEN_DOC_URL = "https://api.slack.com/apps";

export const slackChannelOperatorInventory: ChannelOperatorInventory = {
  startup: {
    channel: "slack",
    statusLabel: "Slack bot",
    getDefaultAvailability: (env) =>
      Boolean(env.SLACK_APP_TOKEN?.trim() && env.SLACK_BOT_TOKEN?.trim()),
    getBootstrapAvailability: (bots, env) => {
      const app = describeBootstrapToken(
        getBootstrapBotToken(bots, "appToken"),
        "SLACK_APP_TOKEN",
        env,
      );
      const bot = describeBootstrapToken(
        getBootstrapBotToken(bots, "botToken"),
        "SLACK_BOT_TOKEN",
        env,
      );
      return Boolean(app.hasValue && bot.hasValue);
    },
    renderBootstrapMissingLine: (bots, env) => {
      const app = describeBootstrapToken(
        getBootstrapBotToken(bots, "appToken"),
        "SLACK_APP_TOKEN",
        env,
      );
      const bot = describeBootstrapToken(
        getBootstrapBotToken(bots, "botToken"),
        "SLACK_BOT_TOKEN",
        env,
      );
      return app.hasValue && bot.hasValue
        ? null
        : `Slack channel: token not found (app=${app.envName}, bot=${bot.envName}), pass ${
          renderExplicitBootstrapFlags(["--slack-app-token", "--slack-bot-token"])
        } for Slack bootstrap.`;
    },
    renderMissingTokenStatusLine: (env) => {
      const app = describeBootstrapToken(undefined, "SLACK_APP_TOKEN", env);
      const bot = describeBootstrapToken(undefined, "SLACK_BOT_TOKEN", env);
      return `Slack token refs: app=${app.envName} (${app.hasValue ? "set" : "missing"}), bot=${bot.envName} (${bot.hasValue ? "set" : "missing"})`;
    },
    isEnabled: (config) => config.bots.slack.defaults.enabled,
    getDefaultBotId: (config) => config.bots.slack.defaults.defaultBotId || "default",
    describeCredentialSource: (config, env) =>
      describeChannelCredentialSource({
        config,
        channel: "slack",
        env,
      }),
    renderDisabledConfiguredWarning: (configPath) => [
      "warning default Slack tokens are available in SLACK_APP_TOKEN and SLACK_BOT_TOKEN, but bots.slack.defaults.enabled is false in the existing config.",
      `Run ${renderCliCommand("bots enable --channel slack --bot default", { inline: true })} to enable Slack quickly, or update ${configPath} manually.`,
    ],
    renderSetupHelpLines: () => [`Slack docs: ${SLACK_TOKEN_DOC_URL}`],
  },
  runtimeSummary: {
    order: 20,
    buildInput: ({ loadedConfig, runtimeRunning, activities, runtimeHealth }) => {
      const enabled = loadedConfig.raw.bots.slack.defaults.enabled;
      const defaultBot = resolveRuntimeSummaryDefaultBot({
        providerConfig: loadedConfig.raw.bots.slack,
        resolveBotConfig: (botId) => resolveSlackBotConfig(loadedConfig.raw.bots.slack, botId),
      });
      const defaultDmConfig = resolveRuntimeSummaryDirectMessageConfig(defaultBot);
      return {
        channel: "slack",
        enabled,
        connection: deriveConfiguredChannelConnection({
          enabled,
          runtimeRunning,
          recordedConnection: runtimeHealth.channels.slack?.connection,
        }),
        defaultAgentId:
          defaultBot.agentId ?? loadedConfig.raw.agents.defaults.defaultAgentId,
        streaming: defaultBot.streaming,
        response: defaultBot.response,
        responseMode: defaultBot.responseMode,
        additionalMessageMode: defaultBot.additionalMessageMode,
        configuredSurfaceCount: countConfiguredBotGroupSurfaces(loadedConfig.raw.bots.slack),
        directMessagesEnabled: defaultDmConfig?.enabled !== false,
        directMessagesPolicy: defaultDmConfig?.policy ?? "disabled",
        sharedDefaultPolicy: resolveSharedGroupsWildcardRoute(defaultBot.groups)?.policy,
        activity: activities.channels.slack,
        health: runtimeHealth.channels.slack,
      };
    },
  },
};
