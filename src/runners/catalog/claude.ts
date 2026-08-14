import {
  INTERACTIVE_CLI_STARTUP_DELAY_MS,
  RUNNER_SESSION_ID_PATTERN,
  type CliProviderDefinition,
} from "./provider.ts";

export const claudeProvider: CliProviderDefinition = {
  id: "claude",
  label: "Claude Code",
  newSessionCommand: "/new",
  tmux: {
    command: "claude",
    startupOptions: ["--dangerously-skip-permissions"],
    trustWorkspace: true,
    startupDelayMs: INTERACTIVE_CLI_STARTUP_DELAY_MS,
    startupRetryCount: 2,
    startupRetryDelayMs: 1000,
    promptSubmitDelayMs: 150,
    sessionId: {
      create: {
        mode: "explicit",
        args: ["--session-id", "{sessionId}"],
      },
      capture: {
        mode: "off",
        statusCommand: "/status",
        pattern: RUNNER_SESSION_ID_PATTERN,
        timeoutMs: 5000,
        pollIntervalMs: 250,
      },
      resume: {
        mode: "command",
        args: [
          "--resume",
          "{sessionId}",
          "--dangerously-skip-permissions",
        ],
      },
    },
  },
  acp: {
    launch: {
      command: "bunx",
      args: ["@agentclientprotocol/claude-agent-acp@0.66.0"],
    },
    adapterPin: "@agentclientprotocol/claude-agent-acp@0.66.0",
    authMethods: [
      {
        id: "claude-login",
        kind: "subscription",
        note: "Uses the existing Claude Code login state.",
      },
    ],
    expectations: {
      loadSession: true,
    },
    costNote:
      "claude-agent-acp is built on the Claude Agent SDK: when Anthropic's paused billing split takes effect, this path draws from the metered programmatic budget instead of the subscription. tmux stays the subscription-cost path.",
    maturity: "not-recommended",
  },
  notes: [
    "tmux is the deliberate default for Claude until the Anthropic billing split is settled; the ACP preset exists for users who accept Agent SDK metering.",
    "The ACP preset has not been smoke-validated yet; validate the advertised auth method ids before first use.",
  ],
};
