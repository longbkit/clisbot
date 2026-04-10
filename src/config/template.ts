import { normalizeEnvReference } from "../shared/env-references.ts";

type DefaultChannelBootstrapOptions = {
  slackEnabled?: boolean;
  telegramEnabled?: boolean;
  slackAppTokenRef?: string;
  slackBotTokenRef?: string;
  telegramBotTokenRef?: string;
};

function renderEnvReference(
  name: string,
  _enabled: boolean,
  override?: string,
) {
  const normalizedOverride = normalizeEnvReference(override);
  if (normalizedOverride) {
    return normalizedOverride;
  }

  return "${" + name + "}";
}

export function renderDefaultConfigTemplate(options: DefaultChannelBootstrapOptions = {}) {
  const slackEnabled = options.slackEnabled === true;
  const telegramEnabled = options.telegramEnabled === true;

  return JSON.stringify(
    {
      meta: {
        schemaVersion: 1,
        lastTouchedAt: new Date().toISOString(),
      },
      tmux: {
        socketPath: "~/.clisbot/state/clisbot.sock",
      },
      session: {
        mainKey: "main",
        dmScope: "main",
        identityLinks: {},
        storePath: "~/.clisbot/state/sessions.json",
      },
      agents: {
        defaults: {
          workspace: "~/.clisbot/workspaces/{agentId}",
          runner: {
            command: "codex",
            args: [
              "--dangerously-bypass-approvals-and-sandbox",
              "--no-alt-screen",
              "-C",
              "{workspace}",
            ],
            trustWorkspace: true,
            startupDelayMs: 3000,
            promptSubmitDelayMs: 150,
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern:
                  "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b",
                timeoutMs: 5000,
                pollIntervalMs: 250,
              },
              resume: {
                mode: "command",
                args: [
                  "resume",
                  "{sessionId}",
                  "--dangerously-bypass-approvals-and-sandbox",
                  "--no-alt-screen",
                  "-C",
                  "{workspace}",
                ],
              },
            },
          },
          stream: {
            captureLines: 160,
            updateIntervalMs: 2000,
            idleTimeoutMs: 6000,
            noOutputTimeoutMs: 20000,
            maxRuntimeMin: 15,
            maxMessageChars: 3500,
          },
          session: {
            createIfMissing: true,
            staleAfterMinutes: 60,
            name: "{sessionKey}",
          },
        },
        list: [],
      },
      bindings: [],
      control: {
        configReload: {
          watch: true,
          watchDebounceMs: 250,
        },
      },
      channels: {
        slack: {
          enabled: slackEnabled,
          mode: "socket",
          appToken: renderEnvReference(
            "SLACK_APP_TOKEN",
            slackEnabled,
            options.slackAppTokenRef,
          ),
          botToken: renderEnvReference(
            "SLACK_BOT_TOKEN",
            slackEnabled,
            options.slackBotTokenRef,
          ),
          defaultAccount: "default",
          accounts: {
            default: {
              appToken: renderEnvReference(
                "SLACK_APP_TOKEN",
                slackEnabled,
                options.slackAppTokenRef,
              ),
              botToken: renderEnvReference(
                "SLACK_BOT_TOKEN",
                slackEnabled,
                options.slackBotTokenRef,
              ),
            },
          },
          agentPrompt: {
            enabled: true,
            maxProgressMessages: 3,
            requireFinalResponse: true,
          },
          ackReaction: "",
          typingReaction: "",
          processingStatus: {
            enabled: true,
            status: "Working...",
            loadingMessages: [],
          },
          allowBots: false,
          replyToMode: "thread",
          channelPolicy: "allowlist",
          groupPolicy: "allowlist",
          defaultAgentId: "default",
          privilegeCommands: {
            enabled: false,
            allowUsers: [],
          },
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "all",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          followUp: {
            mode: "auto",
            participationTtlMin: 5,
          },
          channels: {},
          groups: {},
          directMessages: {
            enabled: true,
            policy: "pairing",
            allowFrom: [],
            requireMention: false,
            agentId: "default",
            privilegeCommands: {
              enabled: false,
              allowUsers: [],
            },
          },
        },
        telegram: {
          enabled: telegramEnabled,
          mode: "polling",
          botToken: renderEnvReference(
            "TELEGRAM_BOT_TOKEN",
            telegramEnabled,
            options.telegramBotTokenRef,
          ),
          defaultAccount: "default",
          accounts: {
            default: {
              botToken: renderEnvReference(
                "TELEGRAM_BOT_TOKEN",
                telegramEnabled,
                options.telegramBotTokenRef,
              ),
            },
          },
          agentPrompt: {
            enabled: true,
            maxProgressMessages: 3,
            requireFinalResponse: true,
          },
          allowBots: false,
          groupPolicy: "allowlist",
          defaultAgentId: "default",
          privilegeCommands: {
            enabled: false,
            allowUsers: [],
          },
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "all",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          followUp: {
            mode: "auto",
            participationTtlMin: 5,
          },
          polling: {
            timeoutSeconds: 20,
            retryDelayMs: 1000,
          },
          groups: {},
          directMessages: {
            enabled: true,
            policy: "pairing",
            allowFrom: [],
            requireMention: false,
            allowBots: false,
            agentId: "default",
            privilegeCommands: {
              enabled: false,
              allowUsers: [],
            },
          },
        },
      },
    },
    null,
    2,
  );
}
