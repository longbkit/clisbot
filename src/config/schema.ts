import { z } from "zod";
import { getDefaultSessionIdPattern } from "../agents/session-identity.ts";
import { isValidLoopTimezone } from "../agents/loop-command.ts";
import {
  SUPPORTED_AGENT_CLI_TOOLS,
  SUPPORTED_BOOTSTRAP_MODES,
} from "./agent-tool-presets.ts";

const defaultRunnerSessionIdConfig = {
  create: {
    mode: "runner" as const,
    args: [],
  },
  capture: {
    mode: "status-command" as const,
    statusCommand: "/status",
    pattern: getDefaultSessionIdPattern(),
    timeoutMs: 5000,
    pollIntervalMs: 250,
  },
  resume: {
    mode: "command" as const,
    args: [
      "resume",
      "{sessionId}",
      "--dangerously-bypass-approvals-and-sandbox",
      "--no-alt-screen",
      "-C",
      "{workspace}",
    ],
  },
};

const runnerSessionIdCreateSchema = z.object({
  mode: z.enum(["runner", "explicit"]).default("runner"),
  args: z.array(z.string()).default([]),
});

const runnerSessionIdCaptureSchema = z.object({
  mode: z.enum(["off", "status-command"]).default("off"),
  statusCommand: z.string().min(1).default("/status"),
  pattern: z.string().min(1).default(getDefaultSessionIdPattern()),
  timeoutMs: z.number().int().positive().default(5000),
  pollIntervalMs: z.number().int().positive().default(250),
});

const runnerSessionIdResumeSchema = z.object({
  mode: z.enum(["off", "command"]).default("off"),
  command: z.string().min(1).optional(),
  args: z
    .array(z.string())
    .default([
      "resume",
      "{sessionId}",
      "--dangerously-bypass-approvals-and-sandbox",
      "--no-alt-screen",
      "-C",
      "{workspace}",
    ]),
});

const runnerSessionIdObjectSchema = z.object({
  create: runnerSessionIdCreateSchema.default(
    defaultRunnerSessionIdConfig.create,
  ),
  capture: runnerSessionIdCaptureSchema.default(
    defaultRunnerSessionIdConfig.capture,
  ),
  resume: runnerSessionIdResumeSchema.default(
    defaultRunnerSessionIdConfig.resume,
  ),
});

const runnerSessionIdSchema = runnerSessionIdObjectSchema.default(
  defaultRunnerSessionIdConfig,
);

const runnerStartupBlockerSchema = z.object({
  pattern: z.string().min(1),
  message: z.string().min(1),
});

const runnerSchema = z.object({
  command: z.string().min(1),
  args: z
    .array(z.string())
    .default([
      "--dangerously-bypass-approvals-and-sandbox",
      "--no-alt-screen",
      "-C",
      "{workspace}",
    ]),
  trustWorkspace: z.boolean().default(true),
  startupDelayMs: z.number().int().positive().default(3000),
  startupReadyPattern: z.string().min(1).optional(),
  startupBlockers: z.array(runnerStartupBlockerSchema).optional(),
  promptSubmitDelayMs: z.number().int().min(0).default(150),
  sessionId: runnerSessionIdSchema.default(defaultRunnerSessionIdConfig),
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

const sessionSchema = z.object({
  createIfMissing: z.boolean().default(true),
  staleAfterMinutes: z.number().int().min(0).default(60),
  name: z.string().default("{sessionKey}"),
});

const sessionDmScopeSchema = z.enum([
  "main",
  "per-peer",
  "per-channel-peer",
  "per-account-channel-peer",
]);

const sessionConfigSchema = z.object({
  mainKey: z.string().min(1).default("main"),
  dmScope: sessionDmScopeSchema.default("main"),
  identityLinks: z.record(z.string(), z.array(z.string())).default({}),
  storePath: z.string().default("~/.clisbot/state/sessions.json"),
});

const runnerOverrideSchema = z.object({
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  trustWorkspace: z.boolean().optional(),
  startupDelayMs: z.number().int().positive().optional(),
  startupReadyPattern: z.string().min(1).optional(),
  startupBlockers: z.array(runnerStartupBlockerSchema).optional(),
  promptSubmitDelayMs: z.number().int().min(0).optional(),
  sessionId: runnerSessionIdObjectSchema
    .partial()
    .extend({
      create: runnerSessionIdCreateSchema.partial().optional(),
      capture: runnerSessionIdCaptureSchema.partial().optional(),
      resume: runnerSessionIdResumeSchema.partial().optional(),
    })
    .optional(),
});

const agentBootstrapSchema = z.object({
  mode: z.enum(SUPPORTED_BOOTSTRAP_MODES).default("personal-assistant"),
});

const agentOverrideSchema = z.object({
  workspace: z.string().optional(),
  responseMode: z.enum(["capture-pane", "message-tool"]).optional(),
  additionalMessageMode: z.enum(["queue", "steer"]).optional(),
  runner: runnerOverrideSchema.optional(),
  stream: streamSchema.partial().optional(),
  session: sessionSchema.partial().optional(),
});

const agentEntrySchema = agentOverrideSchema.extend({
  id: z.string().min(1),
  default: z.boolean().optional(),
  name: z.string().optional(),
  cliTool: z.enum(SUPPORTED_AGENT_CLI_TOOLS).optional(),
  startupOptions: z.array(z.string()).optional(),
  bootstrap: agentBootstrapSchema.optional(),
});

const agentDefaultsSchema = z.object({
  workspace: z.string().default("~/.clisbot/workspaces/{agentId}"),
  runner: runnerSchema.default({
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
    sessionId: defaultRunnerSessionIdConfig,
  }),
  stream: streamSchema.default({
    captureLines: 160,
    updateIntervalMs: 2000,
    idleTimeoutMs: 6000,
    noOutputTimeoutMs: 20000,
    maxRuntimeMin: 15,
    maxMessageChars: 3500,
  }),
  session: sessionSchema.default({
    createIfMissing: true,
    staleAfterMinutes: 60,
    name: "{sessionKey}",
  }),
});

const slackStreamingSchema = z.enum(["off", "latest", "all"]);
const slackResponseSchema = z.enum(["all", "final"]);
const slackConversationPolicySchema = z.enum(["allowlist", "open", "disabled"]);
const directMessagePolicySchema = z.enum(["open", "pairing", "allowlist", "disabled"]);
const slackFollowUpModeSchema = z.enum(["auto", "mention-only", "paused"]);
const slackFollowUpSchema = z.object({
  mode: slackFollowUpModeSchema.default("auto"),
  participationTtlSec: z.number().int().positive().optional(),
  participationTtlMin: z.number().int().positive().optional(),
});
const slackProcessingStatusSchema = z.object({
  enabled: z.boolean().default(true),
  status: z.string().min(1).default("Working..."),
  loadingMessages: z.array(z.string().min(1)).default([]),
});
const slackFollowUpOverrideSchema = z.object({
  mode: slackFollowUpModeSchema.optional(),
  participationTtlSec: z.number().int().positive().optional(),
  participationTtlMin: z.number().int().positive().optional(),
});

const privilegeCommandsSchema = z.object({
  enabled: z.boolean().default(false),
  allowUsers: z.array(z.string().min(1)).default([]),
});

const commandPrefixesSchema = z.object({
  slash: z.array(z.string().min(1)).default(["::", "\\"]),
  bash: z.array(z.string().min(1)).default(["!"]),
});

const commandPrefixesOverrideSchema = z.object({
  slash: z.array(z.string().min(1)).optional(),
  bash: z.array(z.string().min(1)).optional(),
});

const channelAgentPromptSchema = z.object({
  enabled: z.boolean().default(true),
  maxProgressMessages: z.number().int().min(0).default(3),
  requireFinalResponse: z.boolean().default(true),
});

const channelResponseModeSchema = z.enum(["capture-pane", "message-tool"]);
const channelAdditionalMessageModeSchema = z.enum(["queue", "steer"]);
const channelVerboseSchema = z.enum(["off", "minimal"]);
const timezoneSchema = z.string().refine(isValidLoopTimezone, {
  message: "Expected a valid IANA timezone such as Asia/Ho_Chi_Minh",
});

const slackRouteSchema = z.object({
  requireMention: z.boolean().default(true),
  allowBots: z.boolean().default(false),
  agentId: z.string().optional(),
  privilegeCommands: privilegeCommandsSchema.partial().optional(),
  commandPrefixes: commandPrefixesOverrideSchema.optional(),
  streaming: slackStreamingSchema.optional(),
  response: slackResponseSchema.optional(),
  responseMode: channelResponseModeSchema.optional(),
  additionalMessageMode: channelAdditionalMessageModeSchema.optional(),
  verbose: channelVerboseSchema.optional(),
  followUp: slackFollowUpOverrideSchema.optional(),
  timezone: timezoneSchema.optional(),
});

const telegramTopicRouteSchema = z.object({
  requireMention: z.boolean().optional(),
  allowBots: z.boolean().optional(),
  agentId: z.string().optional(),
  privilegeCommands: privilegeCommandsSchema.partial().optional(),
  commandPrefixes: commandPrefixesOverrideSchema.optional(),
  streaming: slackStreamingSchema.optional(),
  response: slackResponseSchema.optional(),
  responseMode: channelResponseModeSchema.optional(),
  additionalMessageMode: channelAdditionalMessageModeSchema.optional(),
  verbose: channelVerboseSchema.optional(),
  followUp: slackFollowUpOverrideSchema.optional(),
  timezone: timezoneSchema.optional(),
});

const telegramGroupRouteSchema = z.object({
  requireMention: z.boolean().default(true),
  allowBots: z.boolean().default(false),
  agentId: z.string().optional(),
  privilegeCommands: privilegeCommandsSchema.partial().optional(),
  commandPrefixes: commandPrefixesOverrideSchema.optional(),
  streaming: slackStreamingSchema.optional(),
  response: slackResponseSchema.optional(),
  responseMode: channelResponseModeSchema.optional(),
  additionalMessageMode: channelAdditionalMessageModeSchema.optional(),
  verbose: channelVerboseSchema.optional(),
  followUp: slackFollowUpOverrideSchema.optional(),
  timezone: timezoneSchema.optional(),
  topics: z.record(z.string(), telegramTopicRouteSchema).default({}),
});

const telegramDirectMessagesSchema = z.object({
  enabled: z.boolean().default(true),
  policy: directMessagePolicySchema.default("pairing"),
  allowFrom: z.array(z.string()).default([]),
  requireMention: z.boolean().default(false),
  allowBots: z.boolean().default(false),
  agentId: z.string().optional(),
  privilegeCommands: privilegeCommandsSchema.partial().optional(),
  commandPrefixes: commandPrefixesOverrideSchema.optional(),
  streaming: slackStreamingSchema.optional(),
  response: slackResponseSchema.optional(),
  responseMode: channelResponseModeSchema.optional(),
  additionalMessageMode: channelAdditionalMessageModeSchema.optional(),
  verbose: channelVerboseSchema.optional(),
  followUp: slackFollowUpOverrideSchema.optional(),
  timezone: timezoneSchema.optional(),
});

const telegramPollingSchema = z.object({
  timeoutSeconds: z.number().int().positive().default(20),
  retryDelayMs: z.number().int().positive().default(1000),
});

const telegramAccountSchema = z.object({
  enabled: z.boolean().optional(),
  credentialType: z.enum(["mem", "tokenFile"]).optional(),
  botToken: z.string().default(""),
  tokenFile: z.string().optional(),
});

const telegramSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.literal("polling").default("polling"),
  botToken: z.string().default(""),
  defaultAccount: z.string().min(1).default("default"),
  accounts: z.record(z.string(), telegramAccountSchema).default({}),
  agentPrompt: channelAgentPromptSchema.default({
    enabled: true,
    maxProgressMessages: 3,
    requireFinalResponse: true,
  }),
  allowBots: z.boolean().default(false),
  groupPolicy: slackConversationPolicySchema.default("allowlist"),
  defaultAgentId: z.string().default("default"),
  privilegeCommands: privilegeCommandsSchema.default({
    enabled: false,
    allowUsers: [],
  }),
  commandPrefixes: commandPrefixesSchema.default({
    slash: ["::", "\\"],
    bash: ["!"],
  }),
  streaming: slackStreamingSchema.default("all"),
  response: slackResponseSchema.default("final"),
  responseMode: channelResponseModeSchema.default("message-tool"),
  additionalMessageMode: channelAdditionalMessageModeSchema.default("steer"),
  verbose: channelVerboseSchema.default("minimal"),
  followUp: slackFollowUpSchema.default({
    mode: "auto",
    participationTtlMin: 5,
  }),
  timezone: timezoneSchema.optional(),
  polling: telegramPollingSchema.default({
    timeoutSeconds: 20,
    retryDelayMs: 1000,
  }),
  groups: z.record(z.string(), telegramGroupRouteSchema).default({}),
  directMessages: telegramDirectMessagesSchema.default({
    enabled: true,
    policy: "pairing",
    allowFrom: [],
    requireMention: false,
    allowBots: false,
  }),
});

const directMessagesSchema = z.object({
  enabled: z.boolean().default(true),
  policy: directMessagePolicySchema.default("pairing"),
  allowFrom: z.array(z.string()).default([]),
  requireMention: z.boolean().default(false),
  agentId: z.string().optional(),
  privilegeCommands: privilegeCommandsSchema.partial().optional(),
  commandPrefixes: commandPrefixesOverrideSchema.optional(),
  streaming: slackStreamingSchema.optional(),
  response: slackResponseSchema.optional(),
  responseMode: channelResponseModeSchema.optional(),
  additionalMessageMode: channelAdditionalMessageModeSchema.optional(),
  verbose: channelVerboseSchema.optional(),
  followUp: slackFollowUpOverrideSchema.optional(),
  timezone: timezoneSchema.optional(),
});

const slackSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.literal("socket").default("socket"),
  appToken: z.string().default(""),
  botToken: z.string().default(""),
  defaultAccount: z.string().min(1).default("default"),
  accounts: z.record(z.string(), z.object({
    enabled: z.boolean().optional(),
    credentialType: z.enum(["mem", "tokenFile"]).optional(),
    appToken: z.string().default(""),
    botToken: z.string().default(""),
    appTokenFile: z.string().optional(),
    botTokenFile: z.string().optional(),
  })).default({}),
  agentPrompt: channelAgentPromptSchema.default({
    enabled: true,
    maxProgressMessages: 3,
    requireFinalResponse: true,
  }),
  ackReaction: z.string().default(""),
  typingReaction: z.string().default(""),
  processingStatus: slackProcessingStatusSchema.default({
    enabled: true,
    status: "Working...",
    loadingMessages: [],
  }),
  allowBots: z.boolean().default(false),
  replyToMode: z.enum(["thread", "all"]).default("thread"),
  channelPolicy: slackConversationPolicySchema.default("allowlist"),
  groupPolicy: slackConversationPolicySchema.default("allowlist"),
  defaultAgentId: z.string().default("default"),
  privilegeCommands: privilegeCommandsSchema.default({
    enabled: false,
    allowUsers: [],
  }),
  commandPrefixes: commandPrefixesSchema.default({
    slash: ["::", "\\"],
    bash: ["!"],
  }),
  streaming: slackStreamingSchema.default("all"),
  response: slackResponseSchema.default("final"),
  responseMode: channelResponseModeSchema.default("message-tool"),
  additionalMessageMode: channelAdditionalMessageModeSchema.default("steer"),
  verbose: channelVerboseSchema.default("minimal"),
  followUp: slackFollowUpSchema.default({
    mode: "auto",
    participationTtlMin: 5,
  }),
  timezone: timezoneSchema.optional(),
  channels: z.record(z.string(), slackRouteSchema).default({}),
  groups: z.record(z.string(), slackRouteSchema).default({}),
  directMessages: directMessagesSchema.default({
    enabled: true,
    policy: "pairing",
    allowFrom: [],
    requireMention: false,
  }),
});

const controlConfigReloadSchema = z.object({
  watch: z.boolean().default(false),
  watchDebounceMs: z.number().int().min(0).default(250),
});

const controlSessionCleanupSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().int().positive().default(5),
});

const controlLoopSchema = z.object({
  maxRunsPerLoop: z.number().int().positive().default(20),
  maxActiveLoops: z.number().int().positive().default(10),
  defaultTimezone: timezoneSchema.optional(),
  defaultIntervalMinutes: z.number().int().positive().optional(),
  maxTimes: z.number().int().positive().optional(),
});

const controlSchema = z.object({
  configReload: controlConfigReloadSchema.default({
    watch: false,
    watchDebounceMs: 250,
  }),
  sessionCleanup: controlSessionCleanupSchema.default({
    enabled: true,
    intervalMinutes: 5,
  }),
  loop: controlLoopSchema.default({
    maxRunsPerLoop: 20,
    maxActiveLoops: 10,
  }),
});

export const clisbotConfigSchema = z.object({
  meta: z
    .object({
      schemaVersion: z.number().int().positive().default(1),
      lastTouchedAt: z.string().optional(),
    })
    .default({
      schemaVersion: 1,
    }),
  tmux: z.object({
    socketPath: z.string().default("~/.clisbot/state/clisbot.sock"),
  }),
  session: sessionConfigSchema.default({
    mainKey: "main",
    dmScope: "main",
    identityLinks: {},
    storePath: "~/.clisbot/state/sessions.json",
  }),
  agents: z.object({
    defaults: agentDefaultsSchema,
    list: z.array(agentEntrySchema).default([
      {
        id: "default",
      },
    ]),
  }),
  bindings: z
    .array(
      z.object({
        match: z.object({
          channel: z.enum(["slack", "telegram"]),
          accountId: z.string().min(1).optional(),
        }),
        agentId: z.string().min(1),
      }),
    )
    .default([]),
  control: controlSchema.default({
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
  }),
  channels: z.object({
    slack: slackSchema,
    telegram: telegramSchema.default({
      enabled: false,
      mode: "polling",
      botToken: "${TELEGRAM_BOT_TOKEN}",
      defaultAccount: "default",
      accounts: {
        default: {
          botToken: "${TELEGRAM_BOT_TOKEN}",
        },
      },
      allowBots: false,
      groupPolicy: "allowlist",
      defaultAgentId: "default",
      commandPrefixes: {
        slash: ["::", "\\"],
        bash: ["!"],
      },
      streaming: "all",
      response: "final",
      responseMode: "message-tool",
      additionalMessageMode: "steer",
      verbose: "minimal",
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
      },
    }),
  }),
});

export type ClisbotConfig = z.infer<typeof clisbotConfigSchema>;
export type AgentOverride = z.infer<typeof agentOverrideSchema>;
export type AgentEntry = z.infer<typeof agentEntrySchema>;
