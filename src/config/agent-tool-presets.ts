export const SUPPORTED_AGENT_CLI_TOOLS = ["codex", "claude"] as const;
export type AgentCliToolId = (typeof SUPPORTED_AGENT_CLI_TOOLS)[number];

export const SUPPORTED_BOOTSTRAP_MODES = ["personal-assistant", "team-assistant"] as const;
export type AgentBootstrapMode = (typeof SUPPORTED_BOOTSTRAP_MODES)[number];

export type AgentToolTemplate = {
  command: string;
  startupOptions: string[];
  trustWorkspace: boolean;
  startupDelayMs: number;
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

export const DEFAULT_AGENT_TOOL_TEMPLATES: Record<AgentCliToolId, AgentToolTemplate> = {
  codex: {
    command: "codex",
    startupOptions: [
      "--dangerously-bypass-approvals-and-sandbox",
      "--no-alt-screen",
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
    startupDelayMs: 3000,
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
};

export type ResolvedRunnerTemplate = {
  command: string;
  args: string[];
  trustWorkspace: boolean;
  startupDelayMs: number;
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

  return null;
}
