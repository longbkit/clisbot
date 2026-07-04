import {
  INTERACTIVE_CLI_STARTUP_DELAY_MS,
  RUNNER_SESSION_ID_PATTERN,
  type CliProviderDefinition,
} from "./provider.ts";

export const geminiProvider: CliProviderDefinition = {
  id: "gemini",
  label: "Gemini CLI",
  newSessionCommand: "/clear",
  tmux: {
    command: "gemini",
    startupOptions: ["--approval-mode=yolo", "--sandbox=false"],
    trustWorkspace: true,
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
        pattern: RUNNER_SESSION_ID_PATTERN,
        timeoutMs: 8_000,
        pollIntervalMs: 250,
      },
      resume: {
        mode: "command",
        args: ["--resume", "{sessionId}", "--approval-mode=yolo", "--sandbox=false"],
      },
    },
  },
  acp: {
    launch: {
      command: "gemini",
      args: ["--experimental-acp"],
    },
    adapterPin: "native (ships with the installed gemini CLI)",
    authMethods: [
      {
        id: "oauth-personal",
        kind: "subscription",
        note: "Uses the existing Gemini CLI login; complete OAuth in a terminal once before routing through clisbot.",
      },
      {
        id: "gemini-api-key",
        kind: "api-key",
        note: "Set runner.env.GEMINI_API_KEY for headless auth.",
      },
    ],
    expectations: {
      loadSession: false,
    },
    maturity: "experimental",
  },
  notes: [
    "Gemini speaks ACP natively behind --experimental-acp; capability coverage varies by CLI version, so run the smoke matrix per installed version.",
    "The ACP preset has not been smoke-validated yet; verify the advertised auth method ids and loadSession support on the installed version before first use.",
  ],
};
