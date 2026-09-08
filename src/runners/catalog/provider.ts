// CLI provider catalog types. One provider definition captures everything
// clisbot needs to run that CLI on each supported backend: the tmux
// interactive template, the ACP adapter preset, per-provider quirks, and the
// capability expectations that feed the provider-by-backend matrix.
//
// Adding a provider = one definition file in this directory plus a registry
// entry in index.ts. Nothing outside src/runners/catalog should need to
// change for a standard onboarding.

export const SUPPORTED_AGENT_CLI_TOOLS = ["codex", "claude", "gemini", "opencode"] as const;
export type AgentCliToolId = (typeof SUPPORTED_AGENT_CLI_TOOLS)[number];

export const INTERACTIVE_CLI_STARTUP_DELAY_MS = 120_000;

export const RUNNER_SESSION_ID_PATTERN =
  "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b";

// opencode session ids are `ses_` plus a 22-character base62-like token, not
// a UUID. Used for tmux capture/resume patterns only; the ACP backend reads
// the id directly from `session/new`.
export const OPENCODE_SESSION_ID_PATTERN = "ses_[A-Za-z0-9]+";

/** tmux interactive launch template for one provider. */
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

export type ProviderAcpAuthMethod = {
  /** Method id the agent advertises at initialize (e.g. "chat-gpt"). */
  id: string;
  kind: "subscription" | "api-key" | "gateway";
  note?: string;
};

export type ProviderAcpMaturity = "validated" | "experimental" | "not-recommended";

/** ACP adapter preset for one provider. */
export type ProviderAcpPreset = {
  launch: {
    command: string;
    args: string[];
  };
  /** Exact adapter version the launch args pin; bumps follow bump-plus-smoke. */
  adapterPin: string;
  authMethods: ProviderAcpAuthMethod[];
  /**
   * Auth method clisbot authenticates with by default. Leave unset when the
   * safe default depends on the machine (e.g. codex gateway vs subscription).
   */
  defaultAuthMethodId?: string;
  expectations: {
    /** Whether the agent is expected to support session/load resume. */
    loadSession: boolean;
  };
  costNote?: string;
  maturity: ProviderAcpMaturity;
};

export type CliProviderDefinition = {
  id: AgentCliToolId;
  label: string;
  /** Native command that rotates to a fresh conversation inside a live CLI. */
  newSessionCommand: string;
  tmux: AgentToolTemplate;
  acp?: ProviderAcpPreset;
  notes?: string[];
};
