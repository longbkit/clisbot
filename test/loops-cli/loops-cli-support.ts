import { clisbotConfigSchema } from "../../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/template.ts";

export function buildConfig(params: {
  socketPath: string;
  storePath: string;
  workspaceTemplate: string;
}) {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.meta.schemaVersion = "0.1.51";
  config.app.session.storePath = params.storePath;
  config.agents.defaults.workspace = params.workspaceTemplate;
  config.agents.defaults.runner.defaults.tmux.socketPath = params.socketPath;
  config.agents.defaults.runner.defaults.trustWorkspace = false;
  config.agents.defaults.runner.defaults.startupDelayMs = 1;
  config.agents.defaults.runner.defaults.promptSubmitDelayMs = 1;
  config.agents.defaults.runner.defaults.stream.captureLines = 80;
  config.agents.defaults.runner.defaults.stream.updateIntervalMs = 1000;
  config.agents.defaults.runner.defaults.stream.idleTimeoutMs = 60_000;
  config.agents.defaults.runner.defaults.stream.noOutputTimeoutMs = 60_000;
  config.agents.defaults.runner.defaults.stream.maxRuntimeSec = 900;
  config.agents.defaults.runner.defaults.stream.maxRuntimeMin = undefined;
  config.agents.defaults.runner.defaults.stream.maxMessageChars = 4000;
  config.agents.defaults.runner.codex.sessionId = {
    create: {
      mode: "runner",
      args: [],
    },
    capture: {
      mode: "status-command",
      statusCommand: "/status",
      pattern: "session id:\\s*(.+)",
      timeoutMs: 10,
      pollIntervalMs: 1,
    },
    resume: {
      mode: "command",
      args: ["resume", "{sessionId}"],
    },
  };
  config.agents.list = [{ id: "default" }];
  config.app.control.configReload.watch = false;
  config.app.control.sessionCleanup.enabled = false;
  config.bots.slack.defaults.enabled = false;
  config.bots.telegram.defaults.enabled = false;
  return config;
}

export function enableSlackChannelRoute(
  config: ReturnType<typeof buildConfig>,
  channelId: string,
) {
  config.bots.slack.defaults.enabled = true;
  config.bots.slack.default.groups[channelId] = {
    enabled: true,
    policy: "open",
    requireMention: true,
    allowBots: false,
    allowUsers: [],
    blockUsers: [],
  };
  return config;
}

export function enableSlackDirectMessages(config: ReturnType<typeof buildConfig>) {
  config.bots.slack.defaults.enabled = true;
  config.bots.slack.default.directMessages["dm:*"] = {
    enabled: true,
    policy: "open",
    requireMention: false,
    allowBots: false,
    allowUsers: [],
    blockUsers: [],
  };
  return config;
}

export function enableTelegramTopicRoute(
  config: ReturnType<typeof buildConfig>,
  chatId: string,
  topicId: string,
) {
  config.bots.telegram.defaults.enabled = true;
  config.bots.telegram.default.groups[chatId] = {
    enabled: true,
    policy: "open",
    requireMention: true,
    allowBots: false,
    allowUsers: [],
    blockUsers: [],
    topics: {
      [topicId]: {
        enabled: true,
        policy: "open",
        requireMention: true,
        allowBots: false,
        allowUsers: [],
        blockUsers: [],
      },
    },
  };
  return config;
}

export function enableZaloBotDirectMessages(config: ReturnType<typeof buildConfig>) {
  config.bots.zaloBot.defaults.enabled = true;
  config.bots.zaloBot.default.directMessages["*"] = {
    enabled: true,
    policy: "open",
    requireMention: false,
    allowBots: false,
    allowUsers: [],
    blockUsers: [],
  };
  return config;
}
