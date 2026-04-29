import { normalizeEnvReference } from "../shared/env-references.ts";
import {
  APP_ADMIN_PERMISSIONS,
  DEFAULT_AGENT_ADMIN_PERMISSIONS,
  DEFAULT_AGENT_MEMBER_PERMISSIONS,
} from "../auth/defaults.ts";
import {
  collapseHomePath,
  getDefaultSessionStorePath,
  getDefaultTmuxSocketPath,
  getDefaultWorkspaceTemplate,
} from "../shared/paths.ts";
import { CURRENT_SCHEMA_VERSION } from "./config-migration.ts";

type DefaultChannelBootstrapOptions = {
  slackEnabled?: boolean;
  telegramEnabled?: boolean;
  slackAppTokenRef?: string;
  slackBotTokenRef?: string;
  telegramBotTokenRef?: string;
};

function renderEnvReference(name: string, override?: string) {
  return normalizeEnvReference(override) ?? `\${${name}}`;
}

export function renderDefaultConfigTemplate(options: DefaultChannelBootstrapOptions = {}) {
  const slackEnabled = options.slackEnabled === true;
  const telegramEnabled = options.telegramEnabled === true;
  const tmuxSocketPath = collapseHomePath(getDefaultTmuxSocketPath());
  const sessionStorePath = collapseHomePath(getDefaultSessionStorePath());
  const workspaceTemplate = collapseHomePath(getDefaultWorkspaceTemplate());
  const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return JSON.stringify(
    {
      meta: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        lastTouchedAt: new Date().toISOString(),
      },
      app: {
        timezone: defaultTimezone,
        session: {
          mainKey: "main",
          identityLinks: {},
          storePath: sessionStorePath,
        },
        auth: {
          ownerClaimWindowMinutes: 30,
          defaultRole: "member",
          roles: {
            owner: {
              allow: [...APP_ADMIN_PERMISSIONS],
              users: [],
            },
            admin: {
              allow: [...APP_ADMIN_PERMISSIONS],
              users: [],
            },
            member: {
              allow: [],
              users: [],
            },
          },
        },
        control: {
          configReload: {
            watch: true,
            watchDebounceMs: 250,
          },
          sessionCleanup: {
            enabled: true,
            intervalMinutes: 5,
          },
          loop: {
            maxRunsPerLoop: 20,
            maxActiveLoops: 10,
          },
          runtimeMonitor: {
            ownerAlerts: {
              enabled: true,
              minIntervalMinutes: 30,
            },
          },
        },
      },
      bots: {
        defaults: {
          allowBots: false,
          requireMention: true,
          dmScope: "per-channel-peer",
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "off",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          surfaceNotifications: {
            queueStart: "brief",
            loopStart: "brief",
          },
          verbose: "minimal",
          followUp: {
            mode: "auto",
            participationTtlMin: 5,
          },
        },
        slack: {
          defaults: {
            enabled: slackEnabled,
            defaultBotId: "default",
            mode: "socket",
            allowBots: false,
            dmPolicy: "pairing",
            channelPolicy: "allowlist",
            groupPolicy: "allowlist",
            agentPrompt: {
              enabled: true,
              maxProgressMessages: 3,
              requireFinalResponse: true,
            },
            ackReaction: "",
            typingReaction: "",
            replyToMode: "thread",
            processingStatus: {
              enabled: true,
              status: "Working...",
              loadingMessages: [],
            },
            directMessages: {
              "*": {
                enabled: true,
                requireMention: false,
                policy: "pairing",
                allowUsers: [],
                blockUsers: [],
                allowBots: false,
              },
            },
            groups: {
              "*": {
                enabled: true,
                requireMention: true,
                policy: "open",
                allowUsers: [],
                blockUsers: [],
                allowBots: false,
              },
            },
            commandPrefixes: {
              slash: ["::", "\\"],
              bash: ["!"],
            },
            streaming: "off",
            response: "final",
            responseMode: "message-tool",
            additionalMessageMode: "steer",
            surfaceNotifications: {
              queueStart: "brief",
              loopStart: "brief",
            },
            verbose: "minimal",
            followUp: {
              mode: "auto",
              participationTtlMin: 5,
            },
          },
          default: {
            enabled: slackEnabled,
            name: "default",
            appToken: renderEnvReference("SLACK_APP_TOKEN", options.slackAppTokenRef),
            botToken: renderEnvReference("SLACK_BOT_TOKEN", options.slackBotTokenRef),
            dmPolicy: "pairing",
            channelPolicy: "allowlist",
            groupPolicy: "allowlist",
            directMessages: {},
            groups: {},
          },
        },
        telegram: {
          defaults: {
            enabled: telegramEnabled,
            defaultBotId: "default",
            mode: "polling",
            allowBots: false,
            dmPolicy: "pairing",
            groupPolicy: "allowlist",
            agentPrompt: {
              enabled: true,
              maxProgressMessages: 3,
              requireFinalResponse: true,
            },
            directMessages: {
              "*": {
                enabled: true,
                requireMention: false,
                policy: "pairing",
                allowUsers: [],
                blockUsers: [],
                allowBots: false,
              },
            },
            groups: {
              "*": {
                enabled: true,
                requireMention: true,
                policy: "open",
                allowUsers: [],
                blockUsers: [],
                allowBots: false,
                topics: {},
              },
            },
            commandPrefixes: {
              slash: ["::", "\\"],
              bash: ["!"],
            },
            streaming: "off",
            response: "final",
            responseMode: "message-tool",
            additionalMessageMode: "steer",
            surfaceNotifications: {
              queueStart: "brief",
              loopStart: "brief",
            },
            verbose: "minimal",
            followUp: {
              mode: "auto",
              participationTtlMin: 5,
            },
            polling: {
              timeoutSeconds: 20,
              retryDelayMs: 1000,
            },
          },
          default: {
            enabled: telegramEnabled,
            name: "default",
            botToken: renderEnvReference("TELEGRAM_BOT_TOKEN", options.telegramBotTokenRef),
            dmPolicy: "pairing",
            groupPolicy: "allowlist",
            directMessages: {},
            groups: {},
          },
        },
      },
      agents: {
        defaults: {
          defaultAgentId: "default",
          workspace: workspaceTemplate,
          cli: "codex",
          bootstrap: {
            botType: "personal-assistant",
          },
          auth: {
            defaultRole: "member",
            roles: {
              admin: {
                allow: [...DEFAULT_AGENT_ADMIN_PERMISSIONS],
                users: [],
              },
              member: {
                allow: [...DEFAULT_AGENT_MEMBER_PERMISSIONS],
                users: [],
              },
            },
          },
          runner: {
            defaults: {
              tmux: {
                socketPath: tmuxSocketPath,
              },
              trustWorkspace: true,
              startupRetryCount: 2,
              startupRetryDelayMs: 1000,
              promptSubmitDelayMs: 150,
              stream: {
                captureLines: 160,
                updateIntervalMs: 2000,
                idleTimeoutMs: 6000,
                noOutputTimeoutMs: 20000,
                maxRuntimeMin: 30,
                maxMessageChars: 3500,
              },
              session: {
                createIfMissing: true,
                staleAfterMinutes: 60,
                name: "{sessionKey}",
              },
            },
            codex: {
              command: "codex",
              args: [
                "--dangerously-bypass-approvals-and-sandbox",
                "--no-alt-screen",
                "-C",
                "{workspace}",
              ],
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
            claude: {
              command: "claude",
              args: ["--dangerously-skip-permissions"],
              sessionId: {
                create: {
                  mode: "explicit",
                  args: ["--session-id", "{sessionId}"],
                },
                capture: {
                  mode: "off",
                  statusCommand: "/status",
                  pattern:
                    "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b",
                  timeoutMs: 5000,
                  pollIntervalMs: 250,
                },
                resume: {
                  mode: "command",
                  args: ["--resume", "{sessionId}", "--dangerously-skip-permissions"],
                },
              },
            },
            gemini: {
              command: "gemini",
              args: ["--approval-mode=yolo", "--sandbox=false"],
              sessionId: {
                create: {
                  mode: "runner",
                  args: [],
                },
                capture: {
                  mode: "status-command",
                  statusCommand: "/stats session",
                  pattern:
                    "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b",
                  timeoutMs: 8000,
                  pollIntervalMs: 250,
                },
                resume: {
                  mode: "command",
                  args: [
                    "--resume",
                    "{sessionId}",
                    "--approval-mode=yolo",
                    "--sandbox=false",
                  ],
                },
              },
            },
          },
        },
        list: [],
      },
    },
    null,
    2,
  ) + "\n";
}
