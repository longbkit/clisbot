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
import { getDefaultRuntimeMonitorRestartBackoff } from "./runtime-monitor-backoff.ts";

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
  const defaultRuntimeMonitorRestartBackoff = getDefaultRuntimeMonitorRestartBackoff();

  return JSON.stringify(
    {
      meta: {
        schemaVersion: "0.1.42",
        lastTouchedAt: new Date().toISOString(),
      },
      app: {
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
            defaultTimezone,
          },
          runtimeMonitor: {
            restartBackoff: defaultRuntimeMonitorRestartBackoff,
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
          groupPolicy: "allowlist",
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
          timezone: defaultTimezone,
        },
        slack: {
          defaults: {
            enabled: slackEnabled,
            defaultBotId: "default",
            mode: "socket",
            allowBots: false,
            channelPolicy: "disabled",
            groupPolicy: "disabled",
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
              "dm:*": {
                enabled: true,
                requireMention: false,
                policy: "pairing",
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
            timezone: defaultTimezone,
          },
          default: {
            enabled: slackEnabled,
            name: "default",
            appToken: renderEnvReference("SLACK_APP_TOKEN", options.slackAppTokenRef),
            botToken: renderEnvReference("SLACK_BOT_TOKEN", options.slackBotTokenRef),
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
            groupPolicy: "disabled",
            agentPrompt: {
              enabled: true,
              maxProgressMessages: 3,
              requireFinalResponse: true,
            },
            directMessages: {
              "dm:*": {
                enabled: true,
                requireMention: false,
                policy: "pairing",
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
            timezone: defaultTimezone,
            polling: {
              timeoutSeconds: 20,
              retryDelayMs: 1000,
            },
          },
          default: {
            enabled: telegramEnabled,
            name: "default",
            botToken: renderEnvReference("TELEGRAM_BOT_TOKEN", options.telegramBotTokenRef),
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
              startupDelayMs: 3000,
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
              startupDelayMs: 15000,
              startupRetryCount: 2,
              startupRetryDelayMs: 1000,
              startupReadyPattern: "Type your message or @path/to/file",
              startupBlockers: [
                {
                  pattern:
                    "Please visit the following URL to authorize the application|Enter the authorization code:",
                  message:
                    "Gemini CLI is waiting for manual OAuth authorization. Authenticate Gemini once in a direct interactive terminal, or configure headless auth such as GEMINI_API_KEY or Vertex AI before routing Gemini through clisbot.",
                },
                {
                  pattern:
                    "How would you like to authenticate for this project\\?|Failed to sign in\\.|Manual authorization is required but the current session is non-interactive",
                  message:
                    "Gemini CLI is blocked in its authentication setup flow or sign-in recovery. Complete Gemini authentication directly first, or switch clisbot to a headless auth path such as GEMINI_API_KEY or Vertex AI before routing prompts.",
                },
              ],
              promptSubmitDelayMs: 200,
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
