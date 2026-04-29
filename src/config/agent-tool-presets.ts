export const SUPPORTED_AGENT_CLI_TOOLS = ["codex", "claude", "gemini"] as const;
export type AgentCliToolId = (typeof SUPPORTED_AGENT_CLI_TOOLS)[number];

export const SUPPORTED_BOOTSTRAP_MODES = ["personal-assistant", "team-assistant"] as const;
export type AgentBootstrapMode = (typeof SUPPORTED_BOOTSTRAP_MODES)[number];

export type AgentToolTemplate = {
  command: string;
  startupOptions: string[];
  trustWorkspace: boolean;
  startupDelayMs: number;
  startupRetryCount: number;
  startupRetryDelayMs: number;
  startupReadyPattern?: string;
  startupBlockers?: Array<{
    pattern: string;
    message: string;
  }>;
  promptSubmitDelayMs: number;
  sessionId: {
    create: {
      mode: "runner" | "explicit";
      args: string[];
    };
    capture: {
      mode: "off" | "status-command";
      statusCommand: string;
      pattern: string;
      timeoutMs: number;
      pollIntervalMs: number;
    };
    resume: {
      mode: "off" | "command";
      command?: string;
      args: string[];
    };
  };
};

const SESSION_ID_PATTERN =
  "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b";
export const INTERACTIVE_CLI_STARTUP_DELAY_MS = 15_000;

export const DEFAULT_AGENT_TOOL_TEMPLATES: Record<AgentCliToolId, AgentToolTemplate> = {
  codex: {
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
        pattern: SESSION_ID_PATTERN,
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
        pattern: SESSION_ID_PATTERN,
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
  gemini: {
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
        pattern: SESSION_ID_PATTERN,
        timeoutMs: 8_000,
        pollIntervalMs: 250,
      },
      resume: {
        mode: "command",
        args: ["--resume", "{sessionId}", "--approval-mode=yolo", "--sandbox=false"],
      },
    },
  },
};

export type ResolvedRunnerTemplate = {
  command: string;
  args: string[];
  trustWorkspace: boolean;
  startupDelayMs: number;
  startupRetryCount: number;
  startupRetryDelayMs: number;
  startupReadyPattern?: string;
  startupBlockers?: AgentToolTemplate["startupBlockers"];
  promptSubmitDelayMs: number;
  sessionId: AgentToolTemplate["sessionId"];
};

export function buildRunnerFromToolTemplate(
  toolId: AgentCliToolId,
  template: AgentToolTemplate,
  startupOptions: string[] | undefined,
): ResolvedRunnerTemplate {
  const options = startupOptions?.length ? startupOptions : template.startupOptions;

  if (toolId === "codex") {
    return {
      command: template.command,
      args: [...options, "-C", "{workspace}"],
      trustWorkspace: template.trustWorkspace,
      startupDelayMs: template.startupDelayMs,
      startupRetryCount: template.startupRetryCount,
      startupRetryDelayMs: template.startupRetryDelayMs,
      startupReadyPattern: template.startupReadyPattern,
      startupBlockers: template.startupBlockers?.map((entry) => ({ ...entry })),
      promptSubmitDelayMs: template.promptSubmitDelayMs,
      sessionId: {
        ...template.sessionId,
        create: {
          ...template.sessionId.create,
          args: [...template.sessionId.create.args],
        },
        capture: {
          ...template.sessionId.capture,
        },
        resume: {
          ...template.sessionId.resume,
          args: ["resume", "{sessionId}", ...options, "-C", "{workspace}"],
        },
      },
    };
  }

  return {
    command: template.command,
    args: [...options],
    trustWorkspace: template.trustWorkspace,
    startupDelayMs: template.startupDelayMs,
    startupRetryCount: template.startupRetryCount,
    startupRetryDelayMs: template.startupRetryDelayMs,
    startupReadyPattern: template.startupReadyPattern,
    startupBlockers: template.startupBlockers?.map((entry) => ({ ...entry })),
    promptSubmitDelayMs: template.promptSubmitDelayMs,
    sessionId: {
      ...template.sessionId,
      create: {
        ...template.sessionId.create,
        args: [...template.sessionId.create.args],
      },
      capture: {
        ...template.sessionId.capture,
      },
      resume: {
        ...template.sessionId.resume,
        args: ["--resume", "{sessionId}", ...options],
      },
    },
  };
}

export function inferAgentCliToolId(command: string | undefined): AgentCliToolId | null {
  const trimmed = command?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed === "codex") {
    return "codex";
  }

  if (trimmed === "claude") {
    return "claude";
  }

  if (trimmed === "gemini") {
    return "gemini";
  }

  return null;
}
