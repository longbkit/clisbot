import {
  INTERACTIVE_CLI_STARTUP_DELAY_MS,
  RUNNER_SESSION_ID_PATTERN,
  type CliProviderDefinition,
} from "./provider.ts";

export const codexProvider: CliProviderDefinition = {
  id: "codex",
  label: "Codex CLI",
  newSessionCommand: "/new",
  tmux: {
    command: "codex",
    startupOptions: [
      "--dangerously-bypass-approvals-and-sandbox",
      "--no-alt-screen",
    ],
    trustWorkspace: true,
    startupDelayMs: INTERACTIVE_CLI_STARTUP_DELAY_MS,
    startupRetryCount: 2,
    startupRetryDelayMs: 1000,
    startupReadyPattern: "(?:^|\\s)›\\s",
    promptSubmitDelayMs: 150,
    sessionId: {
      create: {
        mode: "runner",
        args: [],
      },
      capture: {
        mode: "status-command",
        statusCommand: "/status",
        pattern: RUNNER_SESSION_ID_PATTERN,
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
  acp: {
    launch: {
      command: "bunx",
      args: ["@agentclientprotocol/codex-acp@1.0.2"],
    },
    adapterPin: "@agentclientprotocol/codex-acp@1.0.2",
    authMethods: [
      {
        id: "chat-gpt",
        kind: "subscription",
        note: "Uses the existing ChatGPT login; opens a browser OAuth flow when the machine is not logged in yet.",
      },
      {
        id: "api-key",
        kind: "api-key",
        note: "Reads OPENAI_API_KEY from the adapter environment (set runner.env.OPENAI_API_KEY).",
      },
      {
        id: "gateway",
        kind: "gateway",
        note: "Custom gateway providers configured in ~/.codex/config.toml also need OPENAI_API_KEY in runner.env.",
      },
    ],
    // No default: chat-gpt hangs on browser OAuth for gateway/api-key
    // machines, so the operator opts in per install.
    expectations: {
      loadSession: true,
    },
    costNote:
      "ChatGPT subscription auth carries no extra cost versus the tmux path.",
    maturity: "validated",
  },
  notes: [
    "Primary provider; the ACP preset passed the real-adapter smoke (prompt, streaming, cancel, session/load resume) on 2026-07-02.",
  ],
};
