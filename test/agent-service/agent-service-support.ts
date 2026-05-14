import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "../../src/agents/runtime/agent-service.ts";
import { recordSurfaceDirectoryIdentity } from "../../src/channels/surface/surface-directory.ts";
import { ClearedQueuedTaskError } from "../../src/agents/queue/job-queue.ts";
import { createStoredIntervalLoop } from "../../src/agents/loops/loop-definition.ts";
import { createStoredQueueItem } from "../../src/agents/queue/queue-state.ts";
import { resolveAgentTarget } from "../../src/agents/routing/resolved-target.ts";
import { AgentSessionState } from "../../src/agents/session/session-state.ts";
import { SessionStore } from "../../src/agents/session/session-store.ts";
import { RunnerService } from "../../src/agents/runtime/runner-service.ts";
import { MID_RUN_RECOVERY_CONTINUE_PROMPT } from "../../src/agents/session/run-recovery.ts";
import { loadConfig, resolveSessionStorePath } from "../../src/config/core/load-config.ts";
import { clisbotConfigSchema, type ClisbotConfig } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import type { TmuxClient } from "../../src/runners/tmux/client.ts";

export const RUNNER_GENERATED_ID = "11111111-1111-1111-1111-111111111111";
export const ROTATED_RUNNER_ID = "22222222-2222-2222-2222-222222222222";

type FakeStartupPromptVariant = "codex" | "claude" | "gemini" | "codex-update";

type FakeStartupPromptStep = {
  captureCount: number;
  variant: FakeStartupPromptVariant;
};

export type FakeSession = {
  command: string;
  pendingInput: string;
  sessionId: string;
  snapshot: string;
  cursorX: number;
  cursorY: number;
  historySize: number;
  longRunning: boolean;
  longRunningStep: number;
  startupPromptScript?: FakeStartupPromptStep[];
  trustPromptOnCapture?: number;
  trustPromptVariant?: FakeStartupPromptVariant;
  ignoreEnterCount?: number;
  noServerAfterTrustDismiss?: boolean;
  failWithNoServerOnNextCapture?: boolean;
  scriptedCaptureOutputs?: string[];
  waitForRecoveryContinue?: boolean;
  statusResponseMode?: "session-id" | "no-session-id" | "first-miss-then-session-id";
  dropPromptLiteralCount?: number;
};

export class FakeTmuxClient {
  readonly sessionCommands: string[] = [];
  readonly literalInputs: Array<{
    sessionName: string;
    text: string;
  }> = [];
  hasSessionCalls = 0;
  listSessionsCalls = 0;
  serverDefaultsEnsured = 0;
  private sessions = new Map<string, FakeSession>();
  private readonly invalidResumeSessionIds = new Set<string>();
  private readonly disappearingOnCaptureSessionIds = new Set<string>();
  private readonly noServerOnCaptureSessionIds = new Set<string>();
  private readonly duplicateOnNewSession = new Set<string>();
  private readonly resumeCaptureScripts = new Map<string, string[]>();
  private readonly queuedStartupPromptScripts: FakeStartupPromptStep[][] = [];
  private serverRunning = true;
  private nextTrustPromptCaptureCount: number | null = null;
  private nextTrustPromptVariant: FakeStartupPromptVariant = "codex";
  private nextNoServerAfterTrustDismiss = false;
  private readonly ignoreEnterCounts = new Map<string, number>();
  private nextStatusResponseMode:
    | "session-id"
    | "no-session-id"
    | "first-miss-then-session-id" = "session-id";
  private nextDropPromptLiteralCount = 0;
  private paneStateFailuresRemaining = 0;

  markInvalidResumeSessionId(sessionId: string) {
    this.invalidResumeSessionIds.add(sessionId);
  }

  markSessionIdDisappearOnCapture(sessionId: string) {
    this.disappearingOnCaptureSessionIds.add(sessionId);
  }

  markNoServerOnCapture(sessionId: string) {
    this.noServerOnCaptureSessionIds.add(sessionId);
  }

  markDuplicateOnNewSession(sessionName: string) {
    this.duplicateOnNewSession.add(sessionName);
  }

  setResumeCaptureScript(sessionId: string, outputs: string[]) {
    this.resumeCaptureScripts.set(sessionId, [...outputs]);
  }

  setServerRunning(value: boolean) {
    this.serverRunning = value;
  }

  setTrustPromptOnNextSessionCapture(
    captureCount: number,
    variant: FakeStartupPromptVariant = "codex",
  ) {
    this.nextTrustPromptCaptureCount = captureCount;
    this.nextTrustPromptVariant = variant;
  }

  queueStartupPromptScriptForNextSession(script: FakeStartupPromptStep[]) {
    this.queuedStartupPromptScripts.push(
      script.map((step) => ({
        captureCount: step.captureCount,
        variant: step.variant,
      })),
    );
  }

  setNoServerAfterTrustDismissOnNextSession() {
    this.nextNoServerAfterTrustDismiss = true;
  }

  ignoreNextEnter(sessionName: string) {
    this.ignoreNextEnters(sessionName, 1);
  }

  ignoreNextEnters(sessionName: string, count: number) {
    this.ignoreEnterCounts.set(sessionName, Math.max(0, count));
  }

  setStatusResponseModeOnNextSession(
    mode: "session-id" | "no-session-id" | "first-miss-then-session-id",
  ) {
    this.nextStatusResponseMode = mode;
  }

  setStatusResponseMode(
    sessionName: string,
    mode: "session-id" | "no-session-id" | "first-miss-then-session-id",
  ) {
    const session = this.sessions.get(sessionName);
    if (!session) {
      throw new Error(`Unknown fake tmux session: ${sessionName}`);
    }
    session.statusResponseMode = mode;
  }

  dropPromptLiteralOnNextSession(count: number) {
    this.nextDropPromptLiteralCount = count;
  }

  failNextPaneStateReads(count: number) {
    this.paneStateFailuresRemaining = Math.max(0, count);
  }

  async isServerRunning() {
    return this.serverRunning;
  }

  async ensureServerDefaults() {
    if (this.serverRunning) {
      this.serverDefaultsEnsured += 1;
    }
  }

  async hasSession(sessionName: string) {
    this.hasSessionCalls += 1;
    if (!this.serverRunning) {
      return false;
    }
    return this.sessions.has(sessionName);
  }

  async listSessions() {
    this.listSessionsCalls += 1;
    if (!this.serverRunning) {
      return [];
    }
    return [...this.sessions.keys()];
  }

  async newSession(params: {
    sessionName: string;
    cwd: string;
    command: string;
  }) {
    const sessionId = this.extractSessionId(params.command);
    const resumedWithScript = params.command.includes("resume ") && this.resumeCaptureScripts.has(sessionId);
    const scriptedCaptureOutputs = params.command.includes("resume ")
      ? [...(this.resumeCaptureScripts.get(sessionId) ?? [])]
      : undefined;
    const startupPromptScript = this.queuedStartupPromptScripts.shift()?.map((step) => ({
      captureCount: step.captureCount,
      variant: step.variant,
    }));
    const initialSnapshot = resumedWithScript
      ? `READY ${sessionId}\nRECOVER ${sessionId}\n› ready`
      : `READY ${sessionId}\n› ready`;
    this.sessionCommands.push(params.command);
    if (this.duplicateOnNewSession.has(params.sessionName)) {
      this.duplicateOnNewSession.delete(params.sessionName);
      this.sessions.set(params.sessionName, {
        command: params.command,
        pendingInput: "",
        sessionId,
        snapshot: initialSnapshot,
        cursorX: initialSnapshot.length,
        cursorY: 0,
        historySize: 0,
        longRunning: false,
        longRunningStep: 0,
        startupPromptScript,
        trustPromptOnCapture: this.nextTrustPromptCaptureCount ?? undefined,
        trustPromptVariant: this.nextTrustPromptVariant,
        ignoreEnterCount: this.ignoreEnterCounts.get(params.sessionName) ?? 0,
        noServerAfterTrustDismiss: this.nextNoServerAfterTrustDismiss,
        failWithNoServerOnNextCapture: false,
        scriptedCaptureOutputs,
        waitForRecoveryContinue: resumedWithScript,
        statusResponseMode: this.nextStatusResponseMode,
        dropPromptLiteralCount: this.nextDropPromptLiteralCount,
      });
      this.nextTrustPromptCaptureCount = null;
      this.nextTrustPromptVariant = "codex";
      this.nextNoServerAfterTrustDismiss = false;
      this.nextStatusResponseMode = "session-id";
      this.nextDropPromptLiteralCount = 0;
      throw new Error(`duplicate session: ${params.sessionName}`);
    }
    if (
      params.command.includes("resume ") &&
      this.invalidResumeSessionIds.has(sessionId)
    ) {
      this.writeExitRecord(params.command, params.sessionName, 1);
      this.nextDropPromptLiteralCount = 0;
      return;
    }
    this.sessions.set(params.sessionName, {
      command: params.command,
      pendingInput: "",
      sessionId,
      snapshot: initialSnapshot,
      cursorX: initialSnapshot.length,
      cursorY: 0,
      historySize: 0,
      longRunning: false,
      longRunningStep: 0,
      startupPromptScript,
      trustPromptOnCapture: this.nextTrustPromptCaptureCount ?? undefined,
      trustPromptVariant: this.nextTrustPromptVariant,
      ignoreEnterCount: this.ignoreEnterCounts.get(params.sessionName) ?? 0,
      noServerAfterTrustDismiss: this.nextNoServerAfterTrustDismiss,
      failWithNoServerOnNextCapture: false,
      scriptedCaptureOutputs,
      waitForRecoveryContinue: resumedWithScript,
      statusResponseMode: this.nextStatusResponseMode,
      dropPromptLiteralCount: this.nextDropPromptLiteralCount,
    });
    this.nextTrustPromptCaptureCount = null;
    this.nextTrustPromptVariant = "codex";
    this.nextNoServerAfterTrustDismiss = false;
    this.nextStatusResponseMode = "session-id";
    this.nextDropPromptLiteralCount = 0;
    this.ignoreEnterCounts.delete(params.sessionName);
    this.serverRunning = true;
  }

  async sendLiteral(sessionName: string, text: string) {
    const session = this.requireSession(sessionName);
    this.literalInputs.push({
      sessionName,
      text,
    });
    if (text !== "/status" && (session.dropPromptLiteralCount ?? 0) > 0) {
      session.dropPromptLiteralCount = Math.max(0, (session.dropPromptLiteralCount ?? 0) - 1);
      return;
    }
    session.pendingInput = text;
    session.snapshot = this.appendPendingPrompt(session.snapshot, text);
    session.cursorX += text.length;
  }

  async sendKey(sessionName: string, key: string) {
    if (key === "Escape") {
      const session = this.requireSession(sessionName);
      session.pendingInput = "";
      session.longRunning = false;
      session.snapshot = `${session.snapshot}\nINTERRUPTED`;
      session.cursorX = 0;
      session.cursorY += 1;
      session.historySize += 1;
      return;
    }
    if (key !== "Enter") {
      return;
    }
    const session = this.requireSession(sessionName);
    if (
      session.snapshot.includes("Do you trust the contents of this directory?") ||
      session.snapshot.includes("Press enter to continue") ||
      session.snapshot.includes("Enter to confirm · Esc to cancel") ||
      session.snapshot.includes("Do you trust the files in this folder?") ||
      session.snapshot.includes("Trust folder (default)")
    ) {
      session.snapshot = `READY ${session.sessionId}\n› ready`;
      session.cursorX = session.snapshot.length;
      session.cursorY = 0;
      if (session.noServerAfterTrustDismiss) {
        session.noServerAfterTrustDismiss = false;
        session.failWithNoServerOnNextCapture = true;
      }
      return;
    }
    if ((session.ignoreEnterCount ?? 0) > 0) {
      session.ignoreEnterCount = Math.max(0, (session.ignoreEnterCount ?? 0) - 1);
      return;
    }
    session.snapshot = this.stripPendingPrompt(session.snapshot, session.pendingInput);
    if (session.pendingInput === "/status") {
      session.snapshot =
        session.statusResponseMode === "no-session-id" ||
          session.statusResponseMode === "first-miss-then-session-id"
          ? `${session.snapshot}\nSTATUS pending`
          : `${session.snapshot}\nSTATUS session id: ${session.sessionId}`;
      if (session.statusResponseMode === "first-miss-then-session-id") {
        session.statusResponseMode = "session-id";
      }
    } else if (session.pendingInput === "/new" || session.pendingInput === "/clear") {
      session.sessionId = ROTATED_RUNNER_ID;
      session.snapshot = `${session.snapshot}\nNEW SESSION ${session.sessionId}`;
    } else if (session.pendingInput === "crash") {
      session.snapshot = `${session.snapshot}\nCRASH`;
      this.sessions.delete(sessionName);
      return;
    } else if (session.pendingInput === "ping") {
      session.snapshot = `${session.snapshot}\nPONG ${session.sessionId}`;
    } else if (session.pendingInput === "stream-forever") {
      session.longRunning = true;
      session.longRunningStep = 0;
      session.snapshot = `${session.snapshot}\nSTEP 0 ${session.sessionId}`;
    } else if (session.pendingInput === "recover-mid-run") {
      this.disappearingOnCaptureSessionIds.add(session.sessionId);
      session.snapshot = `${session.snapshot}\nRECOVER ${session.sessionId}`;
    } else if (session.pendingInput === MID_RUN_RECOVERY_CONTINUE_PROMPT) {
      session.waitForRecoveryContinue = false;
      session.snapshot = `${session.snapshot}\nCONTINUE ${session.sessionId}`;
    } else if (session.pendingInput) {
      session.snapshot = `${session.snapshot}\nECHO ${session.pendingInput}`;
    }
    session.pendingInput = "";
    session.cursorX = 0;
    session.cursorY += 1;
    session.historySize += 1;
  }

  async capturePane(sessionName: string, _lines: number) {
    const session = this.requireSession(sessionName);
    if (this.disappearingOnCaptureSessionIds.has(session.sessionId)) {
      this.disappearingOnCaptureSessionIds.delete(session.sessionId);
      this.sessions.delete(sessionName);
      throw new Error(`can't find session: ${sessionName}`);
    }
    if (this.noServerOnCaptureSessionIds.has(session.sessionId)) {
      this.noServerOnCaptureSessionIds.delete(session.sessionId);
      this.sessions.clear();
      this.serverRunning = false;
      throw new Error("no server running on /tmp/clisbot.sock");
    }
    if (session.failWithNoServerOnNextCapture) {
      session.failWithNoServerOnNextCapture = false;
      this.sessions.clear();
      this.serverRunning = false;
      throw new Error("no server running on /tmp/clisbot.sock");
    }
    if ((session.startupPromptScript?.length ?? 0) > 0) {
      const step = session.startupPromptScript?.[0];
      if (step) {
        if (step.captureCount <= 0) {
          session.snapshot = this.renderStartupPromptVariant(step.variant);
          session.startupPromptScript?.shift();
        } else {
          step.captureCount -= 1;
        }
      }
    }
    if (session.trustPromptOnCapture != null) {
      if (session.trustPromptOnCapture <= 0) {
        session.snapshot = this.renderStartupPromptVariant(session.trustPromptVariant ?? "codex");
        session.trustPromptOnCapture = undefined;
      } else {
        session.trustPromptOnCapture -= 1;
      }
    }
    if (session.longRunning) {
      session.longRunningStep += 1;
      session.snapshot = `${session.snapshot}\nSTEP ${session.longRunningStep} ${session.sessionId}`;
    }
    if (!session.waitForRecoveryContinue && (session.scriptedCaptureOutputs?.length ?? 0) > 0) {
      session.snapshot = `${session.snapshot}\n${session.scriptedCaptureOutputs?.shift()}`;
    }
    return session.snapshot;
  }

  async getPaneState(sessionName: string) {
    if (this.paneStateFailuresRemaining > 0) {
      this.paneStateFailuresRemaining -= 1;
      throw new Error(`tmux pane state unavailable for ${sessionName}:main: <empty>`);
    }
    const session = this.requireSession(sessionName);
    return {
      cursorX: session.cursorX,
      cursorY: session.cursorY,
      historySize: session.historySize,
    };
  }

  async killSession(sessionName: string) {
    this.sessions.delete(sessionName);
    if (this.sessions.size === 0) {
      this.serverRunning = false;
    }
  }

  private extractSessionId(command: string) {
    const explicitMatch = command.match(
      /--session-id\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
    );
    if (explicitMatch?.[1]) {
      return explicitMatch[1];
    }

    const resumeMatch = command.match(
      /\bresume\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
    );
    if (resumeMatch?.[1]) {
      return resumeMatch[1];
    }

    const flagResumeMatch = command.match(
      /--resume\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
    );
    if (flagResumeMatch?.[1]) {
      return flagResumeMatch[1];
    }

    return RUNNER_GENERATED_ID;
  }

  private requireSession(sessionName: string) {
    const session = this.sessions.get(sessionName);
    if (!session) {
      throw new Error(`can't find session: ${sessionName}`);
    }
    return session;
  }

  private appendPendingPrompt(snapshot: string, text: string) {
    return `${this.stripPendingPrompt(snapshot, text)}\n> ${text}`;
  }

  private renderStartupPromptVariant(variant: FakeStartupPromptVariant) {
    return variant === "claude"
      ? [
          "Quick safety check:",
          "❯ 1. Yes, I trust this folder",
          "  2. No, exit",
          "Enter to confirm · Esc to cancel",
        ].join("\n")
      : variant === "gemini"
        ? [
            "Skipping project agents due to untrusted folder. To enable, ensure that the project root is trusted.",
            "",
            "Do you trust the files in this folder?",
            "",
            "Trusting a folder allows Gemini CLI to load its local configurations, including custom commands, hooks, MCP servers, agent skills, and settings. These configurations could execute code on your behalf or change the behavior of the CLI.",
            "",
            "1. Trust folder (default)",
            "2. Trust parent folder (workspaces)",
            "3. Don't trust",
          ].join("\n")
        : variant === "codex-update"
          ? [
              "✨ Update available! 0.129.0 → 0.130.0",
              "",
              "Release notes: https://github.com/openai/codex/releases/latest",
              "",
              "› 1. Update now (runs `npm install -g @openai/codex`)",
              "  2. Skip",
              "  3. Skip until next version",
              "",
              "Press enter to continue",
            ].join("\n")
          : "Do you trust the contents of this directory?\nPress enter to continue";
  }

  private writeExitRecord(command: string, sessionName: string, exitCode: number) {
    const match = command.match(/rm -f\s+'?([^'; ]+\/runner-exits\/[^'; ]+\.json)'?/);
    const exitRecordPath = match?.[1];
    if (!exitRecordPath) {
      return;
    }

    writeFileSync(
      exitRecordPath,
      `${JSON.stringify({
        sessionName,
        exitCode,
        command,
        exitedAt: new Date().toISOString(),
      })}\n`,
    );
  }

  private stripPendingPrompt(snapshot: string, text: string) {
    if (!text) {
      return snapshot;
    }
    const suffix = `\n> ${text}`;
    return snapshot.endsWith(suffix) ? snapshot.slice(0, -suffix.length) : snapshot;
  }
}

export function readSessionId(storePath: string, sessionKey: string) {
  const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<
    string,
    { sessionId?: string }
  >;
  return store[sessionKey]?.sessionId ?? null;
}

export function readSessionEntry(storePath: string, sessionKey: string) {
  const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<
    string,
    {
      sessionId?: string;
      runtime?: { state: string };
      queues?: Array<{ status: string }>;
      updatedAt: number;
    }
  >;
  return store[sessionKey] ?? null;
}

export function buildConfig(params: {
  socketPath: string;
  storePath: string;
  workspaceTemplate: string;
  runnerCommand: string;
  runnerArgs: string[];
  sessionId: NonNullable<ClisbotConfig["agents"]["defaults"]["runner"]["codex"]["sessionId"]>;
  trustWorkspace?: boolean;
  startupDelayMs?: number;
  startupRetryCount?: number;
  startupRetryDelayMs?: number;
  startupReadyPattern?: string;
  staleAfterMinutes?: number;
  cleanupEnabled?: boolean;
  cleanupIntervalMinutes?: number;
  streamOverrides?: Partial<{
    captureLines: number;
    updateIntervalMs: number;
    idleTimeoutMs: number;
    noOutputTimeoutMs: number;
    maxRuntimeSec: number;
    maxMessageChars: number;
  }>;
}) {
  const cli =
    params.runnerCommand === "codex" ||
      params.runnerCommand === "claude" ||
      params.runnerCommand === "gemini"
      ? params.runnerCommand
      : "codex";
  const stream = {
    captureLines: 80,
    updateIntervalMs: 1,
    idleTimeoutMs: 5,
    noOutputTimeoutMs: 100,
    maxRuntimeSec: 1,
    maxMessageChars: 2000,
    ...(params.streamOverrides ?? {}),
  };
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        channels: {
          slack: { enabled: false },
          telegram: { enabled: false },
        },
      }),
    ),
  );

  config.app.session.mainKey = "main";
  config.meta.schemaVersion = "0.1.51";
  config.app.session.storePath = params.storePath;
  config.app.control.configReload.watch = false;
  config.app.control.configReload.watchDebounceMs = 250;
  config.app.control.sessionCleanup.enabled = params.cleanupEnabled ?? true;
  config.app.control.sessionCleanup.intervalMinutes = params.cleanupIntervalMinutes ?? 5;

  config.bots.defaults.dmScope = "main";
  config.bots.slack.defaults.enabled = false;
  config.bots.telegram.defaults.enabled = false;
  config.bots.slack.defaults.defaultBotId = "default";
  config.bots.telegram.defaults.defaultBotId = "default";
  config.bots.slack.default.enabled = false;
  config.bots.telegram.default.enabled = false;
  config.bots.slack.default.agentId = "default";
  config.bots.telegram.default.agentId = "default";
  config.bots.slack.default.appToken = "app-token";
  config.bots.slack.default.botToken = "bot-token";
  config.bots.telegram.default.botToken = "telegram-token";
  config.bots.slack.default.groups = {};
  config.bots.telegram.default.groups = {};

  config.agents.defaults.defaultAgentId = "default";
  config.agents.defaults.workspace = params.workspaceTemplate;
  config.agents.defaults.cli = cli;
  config.agents.defaults.runner.defaults.tmux.socketPath = params.socketPath;
  config.agents.defaults.runner.defaults.trustWorkspace = params.trustWorkspace ?? false;
  config.agents.defaults.runner.defaults.startupDelayMs = params.startupDelayMs ?? 1;
  config.agents.defaults.runner.defaults.startupRetryCount = params.startupRetryCount ?? 2;
  config.agents.defaults.runner.defaults.startupRetryDelayMs = params.startupRetryDelayMs ?? 0;
  config.agents.defaults.runner.defaults.promptSubmitDelayMs = 1;
  config.agents.defaults.runner.defaults.stream = stream;
  config.agents.defaults.runner.defaults.session = {
    createIfMissing: true,
    staleAfterMinutes: params.staleAfterMinutes ?? 60,
    name: "{sessionKey}",
  };
  config.agents.defaults.runner[cli] = {
    ...config.agents.defaults.runner[cli],
    command: params.runnerCommand,
    args: params.runnerArgs,
    ...(params.startupDelayMs !== undefined ? { startupDelayMs: params.startupDelayMs } : {}),
    startupReadyPattern: params.startupReadyPattern,
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
  };
  config.agents.list = [{ id: "default", cli }];

  return config;
}
