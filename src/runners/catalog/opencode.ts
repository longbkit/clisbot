import {
  INTERACTIVE_CLI_STARTUP_DELAY_MS,
  OPENCODE_SESSION_ID_PATTERN,
  type CliProviderDefinition,
} from "./provider.ts";

export const opencodeProvider: CliProviderDefinition = {
  id: "opencode",
  label: "OpenCode",
  newSessionCommand: "/new",
  tmux: {
    command: "opencode",
    startupOptions: ["--auto"],
    trustWorkspace: true,
    startupDelayMs: INTERACTIVE_CLI_STARTUP_DELAY_MS,
    startupRetryCount: 2,
    startupRetryDelayMs: 1000,
    startupReadyPattern: "Ask anything",
    promptSubmitDelayMs: 150,
    sessionId: {
      create: {
        mode: "runner",
        args: [],
      },
      capture: {
        // opencode's TUI exposes no status command that prints the session
        // id, so the tmux backend cannot auto-capture it. Resume continuity
        // over tmux therefore depends on an externally known session id.
        mode: "off",
        statusCommand: "/status",
        pattern: OPENCODE_SESSION_ID_PATTERN,
        timeoutMs: 5000,
        pollIntervalMs: 250,
      },
      resume: {
        mode: "command",
        args: ["--session", "{sessionId}", "--auto"],
      },
    },
  },
  acp: {
    launch: {
      command: "opencode",
      args: ["acp"],
    },
    adapterPin: "native (ships with the installed opencode CLI)",
    authMethods: [
      {
        id: "opencode-login",
        kind: "subscription",
        note: "Uses the existing opencode login state; run `opencode auth login` in a terminal once before routing through clisbot.",
      },
    ],
    // opencode advertises session/load and session/resume; leave the auth
    // method unset so opencode reuses its own stored credentials instead of
    // forcing an interactive login through the adapter.
    expectations: {
      loadSession: true,
    },
    costNote:
      "opencode-login reuses your existing opencode subscription/API credentials; no extra cost versus the tmux path.",
    maturity: "validated",
  },
  notes: [
    "opencode is ACP-native; the ACP backend is the recommended path and passed the full smoke (initialize, session/new, session/prompt, session/load) on 2026-08-19.",
    "The tmux backend can drive the opencode TUI for live chat, but cannot auto-capture the opencode session id, so tmux conversations do not resume across runner restarts. Prefer ACP for continuity.",
  ],
};
