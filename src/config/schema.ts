import { z } from "zod";
import { isValidLoopTimezone } from "../agents/loop-command.ts";
import {
  INTERACTIVE_CLI_STARTUP_DELAY_MS,
  SUPPORTED_AGENT_CLI_TOOLS,
  SUPPORTED_BOOTSTRAP_MODES,
} from "./agent-tool-presets.ts";
import {
  agentAuthOverrideSchema,
  agentAuthSchema,
  appAuthSchema,
  defaultAgentAuthConfig,
  defaultAppAuthConfig,
} from "./auth-schema.ts";
import { CURRENT_SCHEMA_VERSION } from "./config-migration.ts";
import { getDefaultRuntimeMonitorRestartBackoff } from "./runtime-monitor-backoff.ts";

const defaultSessionIdPattern =
  "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b";
const codexStartupReadyPattern = "(?:^|\\s)›\\s";

const runnerSessionIdCreateSchema = z.object({
  mode: z.enum(["runner", "explicit"]).default("runner"),
  args: z.array(z.string()).default([]),
});

const runnerSessionIdCaptureSchema = z.object({
  mode: z.enum(["off", "status-command"]).default("off"),
  statusCommand: z.string().min(1).default("/status"),
  pattern: z.string().min(1).default(defaultSessionIdPattern),
  timeoutMs: z.number().int().positive().default(5000),
  pollIntervalMs: z.number().int().positive().default(250),
});

const runnerSessionIdResumeSchema = z.object({
  mode: z.enum(["off", "command"]).default("off"),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).default([]),
});

const runnerSessionIdSchema = z.object({
  create: runnerSessionIdCreateSchema.default({
    mode: "runner",
    args: [],
  }),
  capture: runnerSessionIdCaptureSchema.default({
    mode: "status-command",
    statusCommand: "/status",
    pattern: defaultSessionIdPattern,
    timeoutMs: 5000,
    pollIntervalMs: 250,
  }),
  resume: runnerSessionIdResumeSchema.default({
    mode: "command",
    args: [],
  }),
});

const runnerStartupBlockerSchema = z.object({
  pattern: z.string().min(1),
  message: z.string().min(1),
});

const runnerLaunchSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  startupDelayMs: z.number().int().positive().optional(),
  startupRetryCount: z.number().int().min(0).optional(),
  startupRetryDelayMs: z.number().int().min(0).optional(),
  startupReadyPattern: z.string().min(1).optional(),
  startupBlockers: z.array(runnerStartupBlockerSchema).optional(),
  promptSubmitDelayMs: z.number().int().min(0).optional(),
  sessionId: runnerSessionIdSchema.optional(),
});

const streamSchema = z.object({
  captureLines: z.number().int().positive().default(160),
  updateIntervalMs: z.number().int().positive().default(2000),
  idleTimeoutMs: z.number().int().positive().default(6000),
  noOutputTimeoutMs: z.number().int().positive().default(20000),
  maxRuntimeSec: z.number().int().positive().optional(),
  maxRuntimeMin: z.number().int().positive().optional(),
  maxMessageChars: z.number().int().positive().default(3500),
});

const streamOverrideSchema = streamSchema.partial();

const sessionRuntimeSchema = z.object({
  createIfMissing: z.boolean().default(true),
  staleAfterMinutes: z.number().int().min(0).default(60),
  name: z.string().default("{sessionKey}"),
});

const sessionRuntimeOverrideSchema = sessionRuntimeSchema.partial();

const runnerDefaultsSchema = z.object({
  tmux: z.object({
    socketPath: z.string().default("~/.clisbot/state/clisbot.sock"),
  }).default({
    socketPath: "~/.clisbot/state/clisbot.sock",
  }),
  trustWorkspace: z.boolean().default(true),
  startupDelayMs: z.number().int().positive().default(3000),
  startupRetryCount: z.number().int().min(0).default(2),
  startupRetryDelayMs: z.number().int().min(0).default(1000),
  promptSubmitDelayMs: z.number().int().min(0).default(150),
  stream: streamSchema.default({
    captureLines: 160,
    updateIntervalMs: 2000,
    idleTimeoutMs: 6000,
    noOutputTimeoutMs: 20000,
    maxRuntimeMin: 30,
    maxMessageChars: 3500,
  }),
  session: sessionRuntimeSchema.default({
    createIfMissing: true,
    staleAfterMinutes: 60,
    name: "{sessionKey}",
  }),
});

const runnerDefaultsOverrideSchema = z.object({
  tmux: z.object({
    socketPath: z.string().optional(),
  }).optional(),
  trustWorkspace: z.boolean().optional(),
  startupDelayMs: z.number().int().positive().optional(),
  startupRetryCount: z.number().int().min(0).optional(),
  startupRetryDelayMs: z.number().int().min(0).optional(),
  promptSubmitDelayMs: z.number().int().min(0).optional(),
  stream: streamOverrideSchema.optional(),
  session: sessionRuntimeOverrideSchema.optional(),
});

const runnerFamilySchema = runnerLaunchSchema;

const runnerFamilyOverrideSchema = z.object({
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  startupDelayMs: z.number().int().positive().optional(),
  startupRetryCount: z.number().int().min(0).optional(),
  startupRetryDelayMs: z.number().int().min(0).optional(),
  startupReadyPattern: z.string().min(1).optional(),
  startupBlockers: z.array(runnerStartupBlockerSchema).optional(),
  promptSubmitDelayMs: z.number().int().min(0).optional(),
  sessionId: z.object({
    create: runnerSessionIdCreateSchema.partial().optional(),
    capture: runnerSessionIdCaptureSchema.partial().optional(),
    resume: runnerSessionIdResumeSchema.partial().optional(),
  }).optional(),
});

const sessionDmScopeSchema = z.enum([
  "main",
  "per-peer",
  "per-channel-peer",
  "per-account-channel-peer",
]);

const appSessionSchema = z.object({
  mainKey: z.string().min(1).default("main"),
  identityLinks: z.record(z.string(), z.array(z.string())).default({}),
  storePath: z.string().default("~/.clisbot/state/sessions.json"),
});

const commandPrefixesSchema = z.object({
  slash: z.array(z.string().min(1)).default(["::", "\\"]),
  bash: z.array(z.string().min(1)).default(["!"]),
});

const commandPrefixesOverrideSchema = z.object({
  slash: z.array(z.string().min(1)).optional(),
  bash: z.array(z.string().min(1)).optional(),
});

const streamingSchema = z.enum(["off", "latest", "all"]);
const responseSchema = z.enum(["all", "final"]);
const responseModeSchema = z.enum(["capture-pane", "message-tool"]);
const additionalMessageModeSchema = z.enum(["queue", "steer"]);
const verboseSchema = z.enum(["off", "minimal"]);
const notificationModeSchema = z.enum(["none", "brief", "full"]);
const conversationPolicySchema = z.enum(["open", "allowlist", "disabled"]);
const dmPolicySchema = z.enum(["open", "pairing", "allowlist", "disabled"]);
const followUpModeSchema = z.enum(["auto", "mention-only", "paused"]);
const timezoneSchema = z.string().refine(isValidLoopTimezone, {
  message: "Expected a valid IANA timezone such as Asia/Ho_Chi_Minh",
});

const surfaceNotificationsSchema = z.object({
  queueStart: notificationModeSchema.default("brief"),
  loopStart: notificationModeSchema.default("brief"),
});

const surfaceNotificationsOverrideSchema = z.object({
  queueStart: notificationModeSchema.optional(),
  loopStart: notificationModeSchema.optional(),
});

const followUpSchema = z.object({
  mode: followUpModeSchema.default("auto"),
  participationTtlSec: z.number().int().positive().optional(),
  participationTtlMin: z.number().int().positive().optional(),
});

const followUpOverrideSchema = z.object({
  mode: followUpModeSchema.optional(),
  participationTtlSec: z.number().int().positive().optional(),
  participationTtlMin: z.number().int().positive().optional(),
});

const botRouteSchema = z.object({
  enabled: z.boolean().default(true),
  requireMention: z.boolean().optional(),
  policy: z.enum(["open", "pairing", "allowlist", "disabled"]).optional(),
  allowUsers: z.array(z.string()).default([]),
  blockUsers: z.array(z.string()).default([]),
  allowBots: z.boolean().optional(),
  agentId: z.string().optional(),
  commandPrefixes: commandPrefixesOverrideSchema.optional(),
  streaming: streamingSchema.optional(),
  response: responseSchema.optional(),
  responseMode: responseModeSchema.optional(),
  additionalMessageMode: additionalMessageModeSchema.optional(),
  surfaceNotifications: surfaceNotificationsOverrideSchema.optional(),
  verbose: verboseSchema.optional(),
  followUp: followUpOverrideSchema.optional(),
  timezone: timezoneSchema.optional(),
});

const telegramTopicRouteSchema = botRouteSchema;

const telegramGroupRouteSchema = botRouteSchema.extend({
  topics: z.record(z.string(), telegramTopicRouteSchema).default({}),
});

const slackProcessingStatusSchema = z.object({
  enabled: z.boolean().default(true),
  status: z.string().min(1).default("Working..."),
  loadingMessages: z.array(z.string().min(1)).default([]),
});

const agentPromptSchema = z.object({
  enabled: z.boolean().default(true),
  maxProgressMessages: z.number().int().min(0).default(3),
  requireFinalResponse: z.boolean().default(true),
});

const credentialTypeSchema = z.enum(["mem", "tokenFile"]);

const slackBotSchema = z.object({
  enabled: z.boolean().default(true),
  name: z.string().optional(),
  agentId: z.string().optional(),
  credentialType: credentialTypeSchema.optional(),
  appToken: z.string().optional(),
  botToken: z.string().optional(),
  appTokenFile: z.string().optional(),
  botTokenFile: z.string().optional(),
  allowBots: z.boolean().optional(),
  dmPolicy: dmPolicySchema.optional(),
  channelPolicy: conversationPolicySchema.optional(),
  groupPolicy: conversationPolicySchema.optional(),
  agentPrompt: agentPromptSchema.optional(),
  ackReaction: z.string().optional(),
  typingReaction: z.string().optional(),
  replyToMode: z.enum(["thread", "all"]).optional(),
  processingStatus: slackProcessingStatusSchema.optional(),
  commandPrefixes: commandPrefixesOverrideSchema.optional(),
  streaming: streamingSchema.optional(),
  response: responseSchema.optional(),
  responseMode: responseModeSchema.optional(),
  additionalMessageMode: additionalMessageModeSchema.optional(),
  surfaceNotifications: surfaceNotificationsOverrideSchema.optional(),
  verbose: verboseSchema.optional(),
  followUp: followUpOverrideSchema.optional(),
  timezone: timezoneSchema.optional(),
  directMessages: z.record(z.string(), botRouteSchema).default({}),
  groups: z.record(z.string(), botRouteSchema).default({}),
});

const slackProviderDefaultsSchema = z.object({
  enabled: z.boolean().default(false),
  defaultBotId: z.string().min(1).default("default"),
  mode: z.literal("socket").default("socket"),
  allowBots: z.boolean().default(false),
  dmPolicy: dmPolicySchema.default("pairing"),
  channelPolicy: conversationPolicySchema.default("allowlist"),
  groupPolicy: conversationPolicySchema.default("allowlist"),
  agentPrompt: agentPromptSchema.default({
    enabled: true,
    maxProgressMessages: 3,
    requireFinalResponse: true,
  }),
  ackReaction: z.string().default(""),
  typingReaction: z.string().default(""),
  replyToMode: z.enum(["thread", "all"]).default("thread"),
  processingStatus: slackProcessingStatusSchema.default({
    enabled: true,
    status: "Working...",
    loadingMessages: [],
  }),
  commandPrefixes: commandPrefixesSchema.default({
    slash: ["::", "\\"],
    bash: ["!"],
  }),
  streaming: streamingSchema.default("off"),
  response: responseSchema.default("final"),
  responseMode: responseModeSchema.default("message-tool"),
  additionalMessageMode: additionalMessageModeSchema.default("steer"),
  surfaceNotifications: surfaceNotificationsSchema.optional(),
  verbose: verboseSchema.default("minimal"),
  followUp: followUpSchema.default({
    mode: "auto",
    participationTtlMin: 5,
  }),
  timezone: timezoneSchema.optional(),
  directMessages: z.record(z.string(), botRouteSchema).default({}),
  groups: z.record(z.string(), botRouteSchema).default({}),
});

const telegramBotSchema = z.object({
  enabled: z.boolean().default(true),
  name: z.string().optional(),
  agentId: z.string().optional(),
  credentialType: credentialTypeSchema.optional(),
  botToken: z.string().optional(),
  tokenFile: z.string().optional(),
  allowBots: z.boolean().optional(),
  dmPolicy: dmPolicySchema.optional(),
  groupPolicy: conversationPolicySchema.optional(),
  agentPrompt: agentPromptSchema.optional(),
  commandPrefixes: commandPrefixesOverrideSchema.optional(),
  streaming: streamingSchema.optional(),
  response: responseSchema.optional(),
  responseMode: responseModeSchema.optional(),
  additionalMessageMode: additionalMessageModeSchema.optional(),
  surfaceNotifications: surfaceNotificationsOverrideSchema.optional(),
  verbose: verboseSchema.optional(),
  followUp: followUpOverrideSchema.optional(),
  timezone: timezoneSchema.optional(),
  directMessages: z.record(z.string(), botRouteSchema).default({}),
  groups: z.record(z.string(), telegramGroupRouteSchema).default({}),
  polling: z.object({
    timeoutSeconds: z.number().int().positive().default(20),
    retryDelayMs: z.number().int().positive().default(1000),
  }).optional(),
});

const telegramProviderDefaultsSchema = z.object({
  enabled: z.boolean().default(false),
  defaultBotId: z.string().min(1).default("default"),
  mode: z.literal("polling").default("polling"),
  allowBots: z.boolean().default(false),
  dmPolicy: dmPolicySchema.default("pairing"),
  groupPolicy: conversationPolicySchema.default("allowlist"),
  agentPrompt: agentPromptSchema.default({
    enabled: true,
    maxProgressMessages: 3,
    requireFinalResponse: true,
  }),
  commandPrefixes: commandPrefixesSchema.default({
    slash: ["::", "\\"],
    bash: ["!"],
  }),
  streaming: streamingSchema.default("off"),
  response: responseSchema.default("final"),
  responseMode: responseModeSchema.default("message-tool"),
  additionalMessageMode: additionalMessageModeSchema.default("steer"),
  surfaceNotifications: surfaceNotificationsSchema.optional(),
  verbose: verboseSchema.default("minimal"),
  followUp: followUpSchema.default({
    mode: "auto",
    participationTtlMin: 5,
  }),
  timezone: timezoneSchema.optional(),
  directMessages: z.record(z.string(), botRouteSchema).default({}),
  groups: z.record(z.string(), telegramGroupRouteSchema).default({}),
  polling: z.object({
    timeoutSeconds: z.number().int().positive().default(20),
    retryDelayMs: z.number().int().positive().default(1000),
  }).default({
    timeoutSeconds: 20,
    retryDelayMs: 1000,
  }),
});

const botsDefaultsSchema = z.object({
  allowBots: z.boolean().default(false),
  requireMention: z.boolean().default(true),
  dmScope: sessionDmScopeSchema.default("per-channel-peer"),
  groupPolicy: conversationPolicySchema.default("allowlist"),
  commandPrefixes: commandPrefixesSchema.default({
    slash: ["::", "\\"],
    bash: ["!"],
  }),
  streaming: streamingSchema.default("off"),
  response: responseSchema.default("final"),
  responseMode: responseModeSchema.default("message-tool"),
  additionalMessageMode: additionalMessageModeSchema.default("steer"),
  surfaceNotifications: surfaceNotificationsSchema.optional(),
  verbose: verboseSchema.default("minimal"),
  followUp: followUpSchema.default({
    mode: "auto",
    participationTtlMin: 5,
  }),
  timezone: timezoneSchema.optional(),
});

const slackBotsSchema = z.object({
  defaults: slackProviderDefaultsSchema.default({
    enabled: false,
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
    commandPrefixes: {
      slash: ["::", "\\"],
      bash: ["!"],
    },
    streaming: "off",
    response: "final",
    responseMode: "message-tool",
    additionalMessageMode: "steer",
    verbose: "minimal",
    followUp: {
      mode: "auto",
      participationTtlMin: 5,
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
  }),
}).catchall(slackBotSchema);

const telegramBotsSchema = z.object({
  defaults: telegramProviderDefaultsSchema.default({
    enabled: false,
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
    commandPrefixes: {
      slash: ["::", "\\"],
      bash: ["!"],
    },
    streaming: "off",
    response: "final",
    responseMode: "message-tool",
    additionalMessageMode: "steer",
    verbose: "minimal",
    followUp: {
      mode: "auto",
      participationTtlMin: 5,
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
    polling: {
      timeoutSeconds: 20,
      retryDelayMs: 1000,
    },
  }),
}).catchall(telegramBotSchema);

const appControlConfigReloadSchema = z.object({
  watch: z.boolean().default(false),
  watchDebounceMs: z.number().int().min(0).default(250),
});

const appControlSessionCleanupSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().int().positive().default(5),
});

const appControlLoopSchema = z.object({
  maxRunsPerLoop: z.number().int().positive().default(20),
  maxActiveLoops: z.number().int().positive().default(10),
  defaultTimezone: timezoneSchema.optional(),
  defaultIntervalMinutes: z.number().int().positive().optional(),
  maxTimes: z.number().int().positive().optional(),
});

const defaultRuntimeMonitorRestartBackoff = getDefaultRuntimeMonitorRestartBackoff();

const appControlRuntimeMonitorSchema = z.object({
  restartBackoff: z.object({
    fastRetry: z.object({
      delaySeconds: z.number().int().positive().default(10),
      maxRestarts: z.number().int().min(0).default(3),
    }).default({
      delaySeconds: 10,
      maxRestarts: 3,
    }),
    stages: z.array(z.object({
      delayMinutes: z.number().int().positive().default(15),
      maxRestarts: z.number().int().positive().default(4),
    })).min(1).default(defaultRuntimeMonitorRestartBackoff.stages),
  }).default(defaultRuntimeMonitorRestartBackoff),
  ownerAlerts: z.object({
    enabled: z.boolean().default(true),
    minIntervalMinutes: z.number().int().positive().default(30),
  }).default({
    enabled: true,
    minIntervalMinutes: 30,
  }),
});

const agentBootstrapSchema = z.object({
  botType: z.enum(SUPPORTED_BOOTSTRAP_MODES).default("personal-assistant"),
});

const agentRunnerOverrideSchema = z.object({
  defaults: runnerDefaultsOverrideSchema.optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  startupDelayMs: z.number().int().positive().optional(),
  startupRetryCount: z.number().int().min(0).optional(),
  startupRetryDelayMs: z.number().int().min(0).optional(),
  startupReadyPattern: z.string().min(1).optional(),
  startupBlockers: z.array(runnerStartupBlockerSchema).optional(),
  promptSubmitDelayMs: z.number().int().min(0).optional(),
  sessionId: z.object({
    create: runnerSessionIdCreateSchema.partial().optional(),
    capture: runnerSessionIdCaptureSchema.partial().optional(),
    resume: runnerSessionIdResumeSchema.partial().optional(),
  }).optional(),
});

const agentOverrideSchema = z.object({
  workspace: z.string().optional(),
  timezone: timezoneSchema.optional(),
  responseMode: responseModeSchema.optional(),
  additionalMessageMode: additionalMessageModeSchema.optional(),
  auth: agentAuthOverrideSchema.optional(),
  runner: agentRunnerOverrideSchema.optional(),
});

const agentEntrySchema = agentOverrideSchema.extend({
  id: z.string().min(1),
  default: z.boolean().optional(),
  name: z.string().optional(),
  cli: z.enum(SUPPORTED_AGENT_CLI_TOOLS).optional(),
  bootstrap: agentBootstrapSchema.optional(),
});

const agentsDefaultsSchema = z.object({
  defaultAgentId: z.string().min(1).default("default"),
  workspace: z.string().default("~/.clisbot/workspaces/{agentId}"),
  cli: z.enum(SUPPORTED_AGENT_CLI_TOOLS).default("codex"),
  bootstrap: agentBootstrapSchema.default({
    botType: "personal-assistant",
  }),
  runner: z.object({
    defaults: runnerDefaultsSchema.default({
      tmux: {
        socketPath: "~/.clisbot/state/clisbot.sock",
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
    }),
    codex: runnerFamilySchema.default({
      command: "codex",
      args: [
        "--dangerously-bypass-approvals-and-sandbox",
        "--no-alt-screen",
        "-C",
        "{workspace}",
      ],
      startupDelayMs: INTERACTIVE_CLI_STARTUP_DELAY_MS,
      startupReadyPattern: codexStartupReadyPattern,
      sessionId: {
        create: {
          mode: "runner",
          args: [],
        },
        capture: {
          mode: "status-command",
          statusCommand: "/status",
          pattern: defaultSessionIdPattern,
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
    }),
    claude: runnerFamilySchema.default({
      command: "claude",
      args: ["--dangerously-skip-permissions"],
      startupDelayMs: INTERACTIVE_CLI_STARTUP_DELAY_MS,
      sessionId: {
        create: {
          mode: "explicit",
          args: ["--session-id", "{sessionId}"],
        },
        capture: {
          mode: "off",
          statusCommand: "/status",
          pattern: defaultSessionIdPattern,
          timeoutMs: 5000,
          pollIntervalMs: 250,
        },
        resume: {
          mode: "command",
          args: ["--resume", "{sessionId}", "--dangerously-skip-permissions"],
        },
      },
    }),
    gemini: runnerFamilySchema.default({
      command: "gemini",
      args: ["--approval-mode=yolo", "--sandbox=false"],
      startupDelayMs: INTERACTIVE_CLI_STARTUP_DELAY_MS,
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
          pattern: defaultSessionIdPattern,
          timeoutMs: 8000,
          pollIntervalMs: 250,
        },
        resume: {
          mode: "command",
          args: ["--resume", "{sessionId}", "--approval-mode=yolo", "--sandbox=false"],
        },
      },
    }),
  }),
  auth: agentAuthSchema.default(defaultAgentAuthConfig),
});

export const clisbotConfigSchema = z.object({
  meta: z.object({
    schemaVersion: z.string().min(1).default(CURRENT_SCHEMA_VERSION),
    lastTouchedAt: z.string().optional(),
  }).default({
    schemaVersion: CURRENT_SCHEMA_VERSION,
  }),
  app: z.object({
    timezone: timezoneSchema.optional(),
    session: appSessionSchema.default({
      mainKey: "main",
      identityLinks: {},
      storePath: "~/.clisbot/state/sessions.json",
    }),
    auth: appAuthSchema.default(defaultAppAuthConfig),
    control: z.object({
      configReload: appControlConfigReloadSchema.default({
        watch: false,
        watchDebounceMs: 250,
      }),
      sessionCleanup: appControlSessionCleanupSchema.default({
        enabled: true,
        intervalMinutes: 5,
      }),
      loop: appControlLoopSchema.default({
        maxRunsPerLoop: 20,
        maxActiveLoops: 10,
      }),
      runtimeMonitor: appControlRuntimeMonitorSchema.default({
        restartBackoff: defaultRuntimeMonitorRestartBackoff,
        ownerAlerts: {
          enabled: true,
          minIntervalMinutes: 30,
        },
      }),
    }).default({
      configReload: {
        watch: false,
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
        restartBackoff: defaultRuntimeMonitorRestartBackoff,
        ownerAlerts: {
          enabled: true,
          minIntervalMinutes: 30,
        },
      },
    }),
  }).default({
    session: {
      mainKey: "main",
      identityLinks: {},
      storePath: "~/.clisbot/state/sessions.json",
    },
    auth: defaultAppAuthConfig,
    control: {
      configReload: {
        watch: false,
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
        restartBackoff: defaultRuntimeMonitorRestartBackoff,
        ownerAlerts: {
          enabled: true,
          minIntervalMinutes: 30,
        },
      },
    },
  }),
  bots: z.object({
    defaults: botsDefaultsSchema.default({
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
      verbose: "minimal",
      followUp: {
        mode: "auto",
        participationTtlMin: 5,
      },
    }),
    slack: z.object({
      defaults: slackProviderDefaultsSchema.default({
        enabled: false,
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
        commandPrefixes: {
          slash: ["::", "\\"],
          bash: ["!"],
        },
        streaming: "off",
        response: "final",
        responseMode: "message-tool",
        additionalMessageMode: "steer",
        verbose: "minimal",
        followUp: {
          mode: "auto",
          participationTtlMin: 5,
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
      }),
    }).catchall(slackBotSchema).default({
      defaults: {
        enabled: false,
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
        commandPrefixes: {
          slash: ["::", "\\"],
          bash: ["!"],
        },
        streaming: "off",
        response: "final",
        responseMode: "message-tool",
        additionalMessageMode: "steer",
        verbose: "minimal",
        followUp: {
          mode: "auto",
          participationTtlMin: 5,
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
      },
    } as any),
    telegram: z.object({
      defaults: telegramProviderDefaultsSchema.default({
        enabled: false,
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
        commandPrefixes: {
          slash: ["::", "\\"],
          bash: ["!"],
        },
        streaming: "off",
        response: "final",
        responseMode: "message-tool",
        additionalMessageMode: "steer",
        verbose: "minimal",
        followUp: {
          mode: "auto",
          participationTtlMin: 5,
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
        polling: {
          timeoutSeconds: 20,
          retryDelayMs: 1000,
        },
      }),
    }).catchall(telegramBotSchema).default({
      defaults: {
        enabled: false,
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
        commandPrefixes: {
          slash: ["::", "\\"],
          bash: ["!"],
        },
        streaming: "off",
        response: "final",
        responseMode: "message-tool",
        additionalMessageMode: "steer",
        verbose: "minimal",
        followUp: {
          mode: "auto",
          participationTtlMin: 5,
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
        polling: {
          timeoutSeconds: 20,
          retryDelayMs: 1000,
        },
      },
    } as any),
  }),
  agents: z.object({
    defaults: agentsDefaultsSchema.default({
      defaultAgentId: "default",
      workspace: "~/.clisbot/workspaces/{agentId}",
      cli: "codex",
      bootstrap: {
        botType: "personal-assistant",
      },
      runner: {
        defaults: {
          tmux: {
            socketPath: "~/.clisbot/state/clisbot.sock",
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
          startupDelayMs: INTERACTIVE_CLI_STARTUP_DELAY_MS,
          startupReadyPattern: codexStartupReadyPattern,
          sessionId: {
            create: {
              mode: "runner",
              args: [],
            },
            capture: {
              mode: "status-command",
              statusCommand: "/status",
              pattern: defaultSessionIdPattern,
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
          startupDelayMs: INTERACTIVE_CLI_STARTUP_DELAY_MS,
          sessionId: {
            create: {
              mode: "explicit",
              args: ["--session-id", "{sessionId}"],
            },
            capture: {
              mode: "off",
              statusCommand: "/status",
              pattern: defaultSessionIdPattern,
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
          startupDelayMs: INTERACTIVE_CLI_STARTUP_DELAY_MS,
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
              pattern: defaultSessionIdPattern,
              timeoutMs: 8000,
              pollIntervalMs: 250,
            },
            resume: {
              mode: "command",
              args: ["--resume", "{sessionId}", "--approval-mode=yolo", "--sandbox=false"],
            },
          },
        },
      },
      auth: defaultAgentAuthConfig,
    }),
    list: z.array(agentEntrySchema).default([]),
  }).default({
    defaults: {
      defaultAgentId: "default",
      workspace: "~/.clisbot/workspaces/{agentId}",
      cli: "codex",
      bootstrap: {
        botType: "personal-assistant",
      },
      runner: {
        defaults: {
          tmux: {
            socketPath: "~/.clisbot/state/clisbot.sock",
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
          startupDelayMs: INTERACTIVE_CLI_STARTUP_DELAY_MS,
          startupReadyPattern: codexStartupReadyPattern,
          sessionId: {
            create: {
              mode: "runner",
              args: [],
            },
            capture: {
              mode: "status-command",
              statusCommand: "/status",
              pattern: defaultSessionIdPattern,
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
          startupDelayMs: INTERACTIVE_CLI_STARTUP_DELAY_MS,
          sessionId: {
            create: {
              mode: "explicit",
              args: ["--session-id", "{sessionId}"],
            },
            capture: {
              mode: "off",
              statusCommand: "/status",
              pattern: defaultSessionIdPattern,
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
          startupDelayMs: INTERACTIVE_CLI_STARTUP_DELAY_MS,
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
              pattern: defaultSessionIdPattern,
              timeoutMs: 8000,
              pollIntervalMs: 250,
            },
            resume: {
              mode: "command",
              args: ["--resume", "{sessionId}", "--approval-mode=yolo", "--sandbox=false"],
            },
          },
        },
      },
      auth: defaultAgentAuthConfig,
    },
    list: [],
  }),
});

export type ClisbotConfig = z.infer<typeof clisbotConfigSchema>;
export type AgentOverride = z.infer<typeof agentOverrideSchema>;
export type AgentEntry = z.infer<typeof agentEntrySchema>;
export type AppSessionConfig = z.infer<typeof appSessionSchema>;
export type RunnerDefaultsConfig = z.infer<typeof runnerDefaultsSchema>;
export type RunnerLaunchConfig = z.infer<typeof runnerLaunchSchema>;
export type StreamConfig = z.infer<typeof streamSchema>;
export type SessionRuntimeConfig = z.infer<typeof sessionRuntimeSchema>;
export type CommandPrefixesConfig = z.infer<typeof commandPrefixesSchema>;
export type SurfaceNotificationsConfig = z.infer<typeof surfaceNotificationsSchema>;
export type FollowUpConfig = z.infer<typeof followUpSchema>;
export type BotRouteConfig = z.infer<typeof botRouteSchema>;
export type SlackBotConfig = z.infer<typeof slackBotSchema>;
export type SlackProviderDefaultsConfig = z.infer<typeof slackProviderDefaultsSchema>;
export type TelegramBotConfig = z.infer<typeof telegramBotSchema>;
export type TelegramProviderDefaultsConfig = z.infer<typeof telegramProviderDefaultsSchema>;
