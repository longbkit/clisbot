import { dirname } from "node:path";
import {
  type FollowUpMode,
  type StoredFollowUpState,
} from "./follow-up-policy.ts";
import {
  formatConfiguredRuntimeLimit,
  isTerminalRunStatus,
  type PromptExecutionStatus,
  type RunObserver,
  type RunUpdate,
  type StoredSessionRuntime,
} from "./run-observation.ts";
import { createSessionId, extractSessionId } from "./session-identity.ts";
import { SessionStore } from "./session-store.ts";
import {
  getAgentEntry,
  type LoadedConfig,
  resolveMaxRuntimeMs,
  resolveSessionStorePath,
} from "../config/load-config.ts";
import { buildTmuxSessionName, normalizeMainKey } from "./session-key.ts";
import { applyTemplate, ensureDir } from "../shared/paths.ts";
import { sleep } from "../shared/process.ts";
import { deriveInteractionText, normalizePaneText } from "../shared/transcript.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import { monitorTmuxRun } from "../runners/tmux/run-monitor.ts";
import { AgentJobQueue } from "./job-queue.ts";

export type AgentSessionTarget = {
  agentId: string;
  sessionKey: string;
  mainSessionKey?: string;
  parentSessionKey?: string;
};

export type SessionRuntimeInfo = {
  state: "idle" | "running" | "detached";
  startedAt?: number;
  detachedAt?: number;
  sessionKey: string;
  agentId: string;
};

type StreamUpdate = RunUpdate;

type StreamCallbacks = {
  onUpdate: (update: StreamUpdate) => Promise<void> | void;
};

type AgentExecutionResult = {
  status: Exclude<PromptExecutionStatus, "running">;
  agentId: string;
  sessionKey: string;
  sessionName: string;
  workspacePath: string;
  snapshot: string;
  fullSnapshot: string;
  initialSnapshot: string;
  note?: string;
};

type ActiveSessionRuntimeInfo = SessionRuntimeInfo & {
  state: "running" | "detached";
};

function hasActiveRuntime(
  entry: Awaited<ReturnType<SessionStore["list"]>>[number],
): entry is Awaited<ReturnType<SessionStore["list"]>>[number] & {
  runtime: StoredSessionRuntime & { state: "running" | "detached" };
} {
  return entry.runtime?.state === "running" || entry.runtime?.state === "detached";
}

type ShellCommandResult = {
  agentId: string;
  sessionKey: string;
  sessionName: string;
  workspacePath: string;
  command: string;
  output: string;
  exitCode: number;
  timedOut: boolean;
};

const BASH_WINDOW_NAME = "bash";
const BASH_WINDOW_STARTUP_DELAY_MS = 150;
const TRUST_PROMPT_POLL_INTERVAL_MS = 250;
const TRUST_PROMPT_MAX_WAIT_MS = 10_000;
const TMUX_MISSING_SESSION_PATTERN = /can't find session:/i;
const TMUX_DUPLICATE_SESSION_PATTERN = /duplicate session:/i;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  settled: boolean;
};

type ActiveRun = {
  resolved: ReturnType<AgentService["resolveTarget"]>;
  observers: Map<string, RunObserver>;
  initialResult: Deferred<AgentExecutionResult>;
  latestUpdate: RunUpdate;
  prompt: string;
};

export class ActiveRunInProgressError extends Error {
  constructor(
    readonly update: RunUpdate,
  ) {
    super(
      update.note ??
        "This session already has an active run. Use `/attach`, `/watch every <duration>`, or `/stop` before sending a new prompt.",
    );
  }
}

function shellQuote(value: string) {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function buildCommandString(command: string, args: string[]) {
  return [command, ...args].map(shellQuote).join(" ");
}

function escapeRegExp(raw: string) {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTmuxDuplicateSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return TMUX_DUPLICATE_SESSION_PATTERN.test(message);
}

function isMissingTmuxSessionError(error: unknown) {
  return error instanceof Error && TMUX_MISSING_SESSION_PATTERN.test(error.message);
}

function stripShellCommandEcho(output: string, command: string, sentinel?: string) {
  let lines = output.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  while (lines[0]?.trim() === "") {
    lines = lines.slice(1);
  }

  const commandLines = command
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, all) => !(index === all.length - 1 && line === ""));

  if (
    commandLines.length > 0 &&
    commandLines.every((line, index) => (lines[index] ?? "").trimEnd() === line)
  ) {
    lines = lines.slice(commandLines.length);
    while (lines[0]?.trim() === "") {
      lines = lines.slice(1);
    }
  }

  if (sentinel) {
    lines = lines.filter((line) => !line.includes(sentinel));
  }

  return lines.join("\n").trim();
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const deferred: Deferred<T> = {
    promise: new Promise<T>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    }),
    resolve: (value) => {
      if (deferred.settled) {
        return;
      }
      deferred.settled = true;
      resolve(value);
    },
    reject: (error) => {
      if (deferred.settled) {
        return;
      }
      deferred.settled = true;
      reject(error);
    },
    settled: false,
  };

  return deferred;
}

export class AgentService {
  private readonly tmux: TmuxClient;
  private readonly queue = new AgentJobQueue();
  private readonly sessionStore: SessionStore;
  private readonly activeRuns = new Map<string, ActiveRun>();
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleanupInFlight = false;

  constructor(
    private readonly loadedConfig: LoadedConfig,
    deps: { tmux?: TmuxClient; sessionStore?: SessionStore } = {},
  ) {
    this.tmux = deps.tmux ?? new TmuxClient(this.loadedConfig.raw.tmux.socketPath);
    this.sessionStore = deps.sessionStore ?? new SessionStore(resolveSessionStorePath(this.loadedConfig));
  }

  private mapSessionError(
    error: unknown,
    sessionName: string,
    action: "during startup" | "before prompt submission" | "while the prompt was running",
  ) {
    if (isMissingTmuxSessionError(error)) {
      return new Error(`Runner session "${sessionName}" disappeared ${action}.`);
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private async retryFreshStartWithClearedSessionId(
    target: AgentSessionTarget,
    resolved: ReturnType<AgentService["resolveTarget"]>,
    options: { allowRetry?: boolean; nextAllowFreshRetry?: boolean },
  ) {
    if (options.allowRetry === false) {
      return null;
    }

    await this.tmux.killSession(resolved.sessionName);
    await this.clearSessionIdEntry(resolved, {
      runnerCommand: resolved.runner.command,
    });
    return this.ensureSessionReady(target, {
      allowFreshRetry: options.nextAllowFreshRetry,
    });
  }

  async start() {
    await this.reconcileActiveRuns();
    const cleanup = this.loadedConfig.raw.control.sessionCleanup;
    if (!cleanup.enabled) {
      return;
    }

    await this.runSessionCleanup();
    this.cleanupTimer = setInterval(() => {
      void this.runSessionCleanup();
    }, cleanup.intervalMinutes * 60_000);
  }

  async stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  async cleanupStaleSessions() {
    await this.runSessionCleanup();
  }

  private async reconcileActiveRuns() {
    const entries = await this.sessionStore.list();

    for (const entry of entries) {
      if (!entry.runtime || entry.runtime.state === "idle") {
        continue;
      }

      const resolved = this.resolveTarget({
        agentId: entry.agentId,
        sessionKey: entry.sessionKey,
      });

      if (!(await this.tmux.hasSession(resolved.sessionName))) {
        await this.setSessionRuntime(resolved, {
          state: "idle",
        });
        continue;
      }

      const fullSnapshot = normalizePaneText(
        await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
      );
      const initialResult = createDeferred<AgentExecutionResult>();
      const update = this.createRunUpdate({
        resolved,
        status: entry.runtime.state === "detached" ? "detached" : "running",
        snapshot: deriveInteractionText("", fullSnapshot),
        fullSnapshot,
        initialSnapshot: "",
        note: entry.runtime.state === "detached" ? this.buildDetachedNote(resolved) : undefined,
      });
      const run: ActiveRun = {
        resolved,
        observers: new Map(),
        initialResult,
        latestUpdate: update,
        prompt: "",
      };
      this.activeRuns.set(resolved.sessionKey, run);
      this.startRunMonitor(run, {
        prompt: undefined,
        initialSnapshot: "",
        startedAt: entry.runtime.startedAt ?? Date.now(),
        detachedAlready: entry.runtime.state === "detached",
      });
    }
  }

  private resolveTarget(target: AgentSessionTarget) {
    const defaults = this.loadedConfig.raw.agents.defaults;
    const override = getAgentEntry(this.loadedConfig, target.agentId);
    const workspaceTemplate = override?.workspace ?? defaults.workspace;

    const workspacePath = applyTemplate(workspaceTemplate, {
      agentId: target.agentId,
    });
    const sessionName = buildTmuxSessionName({
      template: override?.session?.name ?? defaults.session.name,
      agentId: target.agentId,
      workspacePath,
      sessionKey: target.sessionKey,
      mainKey: normalizeMainKey(this.loadedConfig.raw.session.mainKey),
    });

    return {
      agentId: target.agentId,
      sessionKey: target.sessionKey,
      mainSessionKey: target.mainSessionKey ?? target.sessionKey,
      parentSessionKey: target.parentSessionKey,
      sessionName,
      workspacePath,
      runner: {
        ...defaults.runner,
        ...(override?.runner ?? {}),
        sessionId: {
          ...defaults.runner.sessionId,
          ...(override?.runner?.sessionId ?? {}),
          create: {
            ...defaults.runner.sessionId.create,
            ...(override?.runner?.sessionId?.create ?? {}),
          },
          capture: {
            ...defaults.runner.sessionId.capture,
            ...(override?.runner?.sessionId?.capture ?? {}),
          },
          resume: {
            ...defaults.runner.sessionId.resume,
            ...(override?.runner?.sessionId?.resume ?? {}),
          },
        },
      },
      stream: {
        ...defaults.stream,
        ...(override?.stream ?? {}),
        maxRuntimeLabel: formatConfiguredRuntimeLimit({
          maxRuntimeSec: override?.stream?.maxRuntimeSec ?? defaults.stream.maxRuntimeSec,
          maxRuntimeMin: override?.stream?.maxRuntimeMin ?? defaults.stream.maxRuntimeMin,
        }),
        maxRuntimeMs: resolveMaxRuntimeMs({
          maxRuntimeSec: override?.stream?.maxRuntimeSec ?? defaults.stream.maxRuntimeSec,
          maxRuntimeMin: override?.stream?.maxRuntimeMin ?? defaults.stream.maxRuntimeMin,
        }),
      },
      session: {
        ...defaults.session,
        ...(override?.session ?? {}),
      },
    };
  }

  private async upsertSessionEntry(
    resolved: ReturnType<AgentService["resolveTarget"]>,
    update: (existing: {
      sessionId?: string;
      followUp?: StoredFollowUpState;
      runnerCommand?: string;
      runtime?: StoredSessionRuntime;
    } | null) => {
      sessionId?: string;
      followUp?: StoredFollowUpState;
      runnerCommand?: string;
      runtime?: StoredSessionRuntime;
    },
  ) {
    return this.sessionStore.update(resolved.sessionKey, (existing) => {
      const next = update(existing);
      return {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
        sessionId: next.sessionId,
        workspacePath: resolved.workspacePath,
        runnerCommand: next.runnerCommand ?? existing?.runnerCommand ?? resolved.runner.command,
        followUp: next.followUp,
        runtime: next.runtime ?? existing?.runtime,
        updatedAt: Date.now(),
      };
    });
  }

  private async touchSessionEntry(
    resolved: ReturnType<AgentService["resolveTarget"]>,
    params: {
      sessionId?: string | null;
      runnerCommand?: string;
      runtime?: StoredSessionRuntime;
    } = {},
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: params.sessionId?.trim() || existing?.sessionId,
      followUp: existing?.followUp,
      runnerCommand: params.runnerCommand ?? existing?.runnerCommand ?? resolved.runner.command,
      runtime: params.runtime ?? existing?.runtime,
    }));
  }

  private async clearSessionIdEntry(
    resolved: ReturnType<AgentService["resolveTarget"]>,
    params: { runnerCommand?: string } = {},
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: undefined,
      followUp: existing?.followUp,
      runnerCommand: params.runnerCommand ?? existing?.runnerCommand ?? resolved.runner.command,
      runtime: {
        state: "idle",
      },
    }));
  }

  private async setSessionRuntime(
    resolved: ReturnType<AgentService["resolveTarget"]>,
    runtime: StoredSessionRuntime,
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      followUp: existing?.followUp,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime,
    }));
  }

  private buildRunnerArgs(
    resolved: ReturnType<AgentService["resolveTarget"]>,
    params: { sessionId?: string; resume?: boolean },
  ) {
    const values = {
      agentId: resolved.agentId,
      workspace: resolved.workspacePath,
      sessionName: resolved.sessionName,
      sessionKey: resolved.sessionKey,
      sessionId: params.sessionId ?? "",
    };
    const sessionId = params.sessionId?.trim();

    if (sessionId && params.resume && resolved.runner.sessionId.resume.mode === "command") {
      return {
        command: resolved.runner.sessionId.resume.command ?? resolved.runner.command,
        args: resolved.runner.sessionId.resume.args.map((value) => applyTemplate(value, values)),
      };
    }

    const args = [...resolved.runner.args];
    if (sessionId && resolved.runner.sessionId.create.mode === "explicit") {
      args.push(...resolved.runner.sessionId.create.args);
    }

    return {
      command: resolved.runner.command,
      args: args.map((value) => applyTemplate(value, values)),
    };
  }

  private async syncSessionIdentity(resolved: ReturnType<AgentService["resolveTarget"]>) {
    const existing = await this.sessionStore.get(resolved.sessionKey);
    if (existing?.sessionId) {
      return this.touchSessionEntry(resolved, {
        sessionId: existing.sessionId,
        runnerCommand: resolved.runner.command,
      });
    }

    let sessionId: string | null = null;
    if (resolved.runner.sessionId.capture.mode === "status-command") {
      sessionId = await this.captureSessionIdentity(resolved);
    }

    return this.touchSessionEntry(resolved, {
      sessionId,
      runnerCommand: resolved.runner.command,
    });
  }

  private async runSessionCleanup() {
    if (this.cleanupInFlight) {
      return;
    }

    this.cleanupInFlight = true;
    try {
      const entries = await this.sessionStore.list();
      const now = Date.now();

      for (const entry of entries) {
        const resolved = this.resolveTarget({
          agentId: entry.agentId,
          sessionKey: entry.sessionKey,
        });
        const staleAfterMinutes = resolved.session.staleAfterMinutes;
        if (staleAfterMinutes <= 0) {
          continue;
        }

        if (now - entry.updatedAt < staleAfterMinutes * 60_000) {
          continue;
        }

        if (entry.runtime?.state === "running" || entry.runtime?.state === "detached") {
          continue;
        }

        if (this.queue.isBusy(entry.sessionKey)) {
          continue;
        }

        if (!(await this.tmux.hasSession(resolved.sessionName))) {
          continue;
        }

        await this.tmux.killSession(resolved.sessionName);
        console.log(
          `muxbot sunset stale session ${resolved.sessionName} after ${staleAfterMinutes}m idle`,
        );
      }
    } finally {
      this.cleanupInFlight = false;
    }
  }

  private async captureSessionIdentity(resolved: ReturnType<AgentService["resolveTarget"]>) {
    const capture = resolved.runner.sessionId.capture;
    let deadline = Date.now() + capture.timeoutMs;

    await this.submitSessionInput(
      resolved.sessionName,
      capture.statusCommand,
      resolved.runner.promptSubmitDelayMs,
    );

    while (Date.now() < deadline) {
      await sleep(capture.pollIntervalMs);
      const snapshot = normalizePaneText(
        await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
      );
      if (this.hasTrustPrompt(snapshot)) {
        await this.tmux.sendKey(resolved.sessionName, "Enter");
        await sleep(1500);
        deadline = Date.now() + capture.timeoutMs;
        await this.submitSessionInput(
          resolved.sessionName,
          capture.statusCommand,
          resolved.runner.promptSubmitDelayMs,
        );
        continue;
      }
      const sessionId = extractSessionId(snapshot, capture.pattern);
      if (sessionId) {
        return sessionId;
      }
    }

    return null;
  }

  private async ensureSessionReady(
    target: AgentSessionTarget,
    options: { allowFreshRetry?: boolean } = {},
  ): Promise<ReturnType<AgentService["resolveTarget"]>> {
    const resolved = this.resolveTarget(target);
    await ensureDir(resolved.workspacePath);
    await ensureDir(dirname(this.loadedConfig.raw.tmux.socketPath));
    const existing = await this.sessionStore.get(resolved.sessionKey);
    const serverRunning = await this.tmux.isServerRunning();

    if (serverRunning && (await this.tmux.hasSession(resolved.sessionName))) {
      try {
        await this.syncSessionIdentity(resolved);
      } catch (error) {
        throw this.mapSessionError(error, resolved.sessionName, "during startup");
      }
      return resolved;
    }

    if (!resolved.session.createIfMissing) {
      throw new Error(`tmux session "${resolved.sessionName}" does not exist`);
    }

    const startupSessionId =
      existing?.sessionId || (resolved.runner.sessionId.create.mode === "explicit" ? createSessionId() : "");
    const resumingExistingSession = Boolean(existing?.sessionId);
    const runnerLaunch = this.buildRunnerArgs(resolved, {
      sessionId: startupSessionId || undefined,
      resume: resumingExistingSession,
    });
    const command = buildCommandString(runnerLaunch.command, runnerLaunch.args);

    try {
      await this.tmux.newSession({
        sessionName: resolved.sessionName,
        cwd: resolved.workspacePath,
        command,
      });
    } catch (error) {
      if (
        !isTmuxDuplicateSessionError(error) ||
        !(await this.tmux.hasSession(resolved.sessionName))
      ) {
        throw error;
      }
    }

    await sleep(resolved.runner.startupDelayMs);
    if (!(await this.tmux.hasSession(resolved.sessionName))) {
      if (resumingExistingSession) {
        const retried = await this.retryFreshStartWithClearedSessionId(
          target,
          resolved,
          {
            allowRetry: options.allowFreshRetry,
            nextAllowFreshRetry: false,
          },
        );
        if (retried) {
          return retried;
        }
      }
      throw new Error(`Runner session "${resolved.sessionName}" disappeared during startup.`);
    }

    if (resolved.runner.trustWorkspace) {
      try {
        await this.dismissTrustPromptIfPresent(resolved);
      } catch (error) {
        if (
          resumingExistingSession &&
          isMissingTmuxSessionError(error)
        ) {
          const retried = await this.retryFreshStartWithClearedSessionId(
            target,
            resolved,
            {
              allowRetry: options.allowFreshRetry,
              nextAllowFreshRetry: false,
            },
          );
          if (retried) {
            return retried;
          }
        }
        throw this.mapSessionError(error, resolved.sessionName, "during startup");
      }
    }

    if (startupSessionId) {
      await this.touchSessionEntry(resolved, {
        sessionId: startupSessionId,
        runnerCommand: runnerLaunch.command,
      });
    } else {
      try {
        await this.syncSessionIdentity(resolved);
      } catch (error) {
        if (
          resumingExistingSession &&
          isMissingTmuxSessionError(error)
        ) {
          const retried = await this.retryFreshStartWithClearedSessionId(
            target,
            resolved,
            {
              allowRetry: options.allowFreshRetry,
              nextAllowFreshRetry: false,
            },
          );
          if (retried) {
            return retried;
          }
        }
        throw this.mapSessionError(error, resolved.sessionName, "during startup");
      }
    }

    return resolved;
  }

  async captureTranscript(target: AgentSessionTarget) {
    const resolved = this.resolveTarget(target);
    if (!(await this.tmux.hasSession(resolved.sessionName))) {
      return {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
        sessionName: resolved.sessionName,
        workspacePath: resolved.workspacePath,
        snapshot: "",
      };
    }

    await this.touchSessionEntry(resolved);

    try {
      return {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
        sessionName: resolved.sessionName,
        workspacePath: resolved.workspacePath,
        snapshot: normalizePaneText(
          await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
        ),
      };
    } catch (error) {
      if (isMissingTmuxSessionError(error)) {
        return {
          agentId: resolved.agentId,
          sessionKey: resolved.sessionKey,
          sessionName: resolved.sessionName,
          workspacePath: resolved.workspacePath,
          snapshot: "",
        };
      }

      throw error;
    }
  }

  async interruptSession(target: AgentSessionTarget) {
    const resolved = this.resolveTarget(target);
    const existed = await this.tmux.hasSession(resolved.sessionName);
    if (existed) {
      await this.touchSessionEntry(resolved, {
        runtime: {
          state: "idle",
        },
      });
      try {
        await this.tmux.sendKey(resolved.sessionName, "Escape");
        await sleep(150);
      } catch {
        // Ignore interrupt failures and return the session state.
      }
    }

    return {
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
      sessionName: resolved.sessionName,
      workspacePath: resolved.workspacePath,
      interrupted: existed,
    };
  }

  async getConversationFollowUpState(target: AgentSessionTarget): Promise<StoredFollowUpState> {
    const entry = await this.sessionStore.get(target.sessionKey);
    return entry?.followUp ?? {};
  }

  async getSessionRuntime(target: AgentSessionTarget): Promise<SessionRuntimeInfo> {
    const entry = await this.sessionStore.get(target.sessionKey);
    return {
      state: entry?.runtime?.state ?? "idle",
      startedAt: entry?.runtime?.startedAt,
      detachedAt: entry?.runtime?.detachedAt,
      sessionKey: target.sessionKey,
      agentId: target.agentId,
    };
  }

  async listActiveSessionRuntimes(): Promise<ActiveSessionRuntimeInfo[]> {
    const entries = await this.sessionStore.list();
    return entries
      .filter(hasActiveRuntime)
      .map((entry) => ({
        state: entry.runtime?.state,
        startedAt: entry.runtime.startedAt,
        detachedAt: entry.runtime.detachedAt,
        sessionKey: entry.sessionKey,
        agentId: entry.agentId,
      }));
  }

  async setConversationFollowUpMode(target: AgentSessionTarget, mode: FollowUpMode) {
    const resolved = this.resolveTarget(target);
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      followUp: {
        ...existing?.followUp,
        overrideMode: mode,
      },
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
    }));
  }

  async resetConversationFollowUpMode(target: AgentSessionTarget) {
    const resolved = this.resolveTarget(target);
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      followUp: existing?.followUp
        ? {
            ...existing.followUp,
            overrideMode: undefined,
          }
        : undefined,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
    }));
  }

  async reactivateConversationFollowUp(target: AgentSessionTarget) {
    const existing = await this.sessionStore.get(target.sessionKey);
    if (existing?.followUp?.overrideMode !== "paused") {
      return existing;
    }
    return this.resetConversationFollowUpMode(target);
  }

  getResolvedAgentConfig(agentId: string) {
    return this.resolveTarget({
      agentId,
      sessionKey: this.loadedConfig.raw.session.mainKey,
    });
  }

  async recordConversationReply(target: AgentSessionTarget) {
    const resolved = this.resolveTarget(target);
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      followUp: {
        ...existing?.followUp,
        lastBotReplyAt: Date.now(),
      },
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime: existing?.runtime,
    }));
  }

  private async ensureShellPane(target: AgentSessionTarget) {
    const resolved = await this.ensureSessionReady(target);
    const existingPaneId = await this.tmux.findPaneByWindowName(
      resolved.sessionName,
      BASH_WINDOW_NAME,
    );
    if (existingPaneId) {
      return {
        ...resolved,
        paneId: existingPaneId,
      };
    }

    const paneId = await this.tmux.newWindow({
      sessionName: resolved.sessionName,
      cwd: resolved.workspacePath,
      name: BASH_WINDOW_NAME,
      command: buildCommandString("env", ["PS1=", "HISTFILE=/dev/null", "bash", "--noprofile", "--norc", "-i"]),
    });
    await sleep(BASH_WINDOW_STARTUP_DELAY_MS);

    return {
      ...resolved,
      paneId,
    };
  }

  private async executeShellCommand(
    target: AgentSessionTarget,
    command: string,
  ): Promise<ShellCommandResult> {
    const resolved = await this.ensureShellPane(target);
    const sentinel = `__TMUX_TALK_EXIT_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    const startedAt = Date.now();
    const maxRuntimeMs = resolved.stream.maxRuntimeMs;
    const captureLines = Math.max(resolved.stream.captureLines, 240);
    const sentinelPattern = new RegExp(`${escapeRegExp(sentinel)}:(\\d+)`);
    const initialSnapshot = normalizePaneText(
      await this.tmux.captureTarget(resolved.paneId, captureLines),
    );
    let lastInteractionSnapshot = "";

    await this.tmux.sendLiteralTarget(resolved.paneId, command);
    await sleep(50);
    await this.tmux.sendKeyTarget(resolved.paneId, "Enter");
    await sleep(50);
    await this.tmux.sendLiteralTarget(
      resolved.paneId,
      `printf '\\n${sentinel}:%s\\n' "$?"`,
    );
    await sleep(50);
    await this.tmux.sendKeyTarget(resolved.paneId, "Enter");

    while (Date.now() - startedAt < maxRuntimeMs) {
      await sleep(250);
      const snapshot = normalizePaneText(await this.tmux.captureTarget(resolved.paneId, captureLines));
      const interactionSnapshot = deriveInteractionText(initialSnapshot, snapshot);
      lastInteractionSnapshot = interactionSnapshot;
      const match = interactionSnapshot.match(sentinelPattern);
      if (!match) {
        continue;
      }

      const exitCode = Number.parseInt(match[1] ?? "1", 10);
      const output = stripShellCommandEcho(
        interactionSnapshot.slice(0, match.index ?? interactionSnapshot.length).trim(),
        command,
        sentinel,
      );
      return {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
        sessionName: resolved.sessionName,
        workspacePath: resolved.workspacePath,
        command,
        output,
        exitCode,
        timedOut: false,
      };
    }

    return {
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
      sessionName: resolved.sessionName,
      workspacePath: resolved.workspacePath,
      command,
      output: stripShellCommandEcho(lastInteractionSnapshot.trim(), command, sentinel),
      exitCode: 124,
      timedOut: true,
    };
  }

  async runShellCommand(target: AgentSessionTarget, command: string): Promise<ShellCommandResult> {
    return this.queue.enqueue(`${target.sessionKey}:bash`, async () =>
      this.executeShellCommand(target, command),
    ).result;
  }

  getWorkspacePath(target: AgentSessionTarget) {
    return this.resolveTarget(target).workspacePath;
  }

  private buildDetachedNote(resolved: ReturnType<AgentService["resolveTarget"]>) {
    return `This session has been running for over ${resolved.stream.maxRuntimeLabel}. muxbot will keep monitoring it and will post the final result here when it completes. Use \`/attach\` to resume live updates, \`/watch every 30s\` for interval updates, or \`/stop\` to interrupt it.`;
  }

  private createRunUpdate<TStatus extends PromptExecutionStatus>(params: {
    resolved: ReturnType<AgentService["resolveTarget"]>;
    status: TStatus;
    snapshot: string;
    fullSnapshot: string;
    initialSnapshot: string;
    note?: string;
  }): TStatus extends "running" ? RunUpdate : AgentExecutionResult {
    return {
      status: params.status,
      agentId: params.resolved.agentId,
      sessionKey: params.resolved.sessionKey,
      sessionName: params.resolved.sessionName,
      workspacePath: params.resolved.workspacePath,
      snapshot: params.snapshot,
      fullSnapshot: params.fullSnapshot,
      initialSnapshot: params.initialSnapshot,
      note: params.note,
    } as TStatus extends "running" ? RunUpdate : AgentExecutionResult;
  }

  private async notifyRunObservers(run: ActiveRun, update: RunUpdate) {
    run.latestUpdate = update;
    const now = Date.now();

    for (const observer of run.observers.values()) {
      if (observer.expiresAt && now >= observer.expiresAt && observer.mode !== "passive-final") {
        observer.mode = "passive-final";
      }

      let shouldSend = false;
      if (isTerminalRunStatus(update.status)) {
        shouldSend = true;
      } else if (observer.mode === "live") {
        shouldSend = true;
      } else if (observer.mode === "poll") {
        shouldSend =
          typeof observer.lastSentAt !== "number" ||
          now - observer.lastSentAt >= (observer.intervalMs ?? 0);
      }

      if (!shouldSend) {
        continue;
      }

      observer.lastSentAt = now;
      await observer.onUpdate(update);
    }
  }

  private async finishActiveRun(
    run: ActiveRun,
    update: AgentExecutionResult,
  ) {
    await this.setSessionRuntime(run.resolved, {
      state: "idle",
    });
    await this.notifyRunObservers(run, update);
    run.initialResult.resolve(update);
    this.activeRuns.delete(run.resolved.sessionKey);
  }

  private async failActiveRun(run: ActiveRun, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const update = this.createRunUpdate({
      resolved: run.resolved,
      status: "error",
      snapshot: message,
      fullSnapshot: run.latestUpdate.fullSnapshot,
      initialSnapshot: run.latestUpdate.initialSnapshot,
      note: "Run failed.",
    });
    await this.setSessionRuntime(run.resolved, {
      state: "idle",
    });
    await this.notifyRunObservers(run, update);
    if (!run.initialResult.settled) {
      run.initialResult.reject(error);
    }
    this.activeRuns.delete(run.resolved.sessionKey);
  }

  async observeRun(
    target: AgentSessionTarget,
    observer: Omit<RunObserver, "lastSentAt">,
  ) {
    const existingRun = this.activeRuns.get(target.sessionKey);
    if (existingRun) {
      existingRun.observers.set(observer.id, {
        ...observer,
      });
      return {
        active: !isTerminalRunStatus(existingRun.latestUpdate.status),
        update: existingRun.latestUpdate,
      };
    }

    const transcript = await this.captureTranscript(target);
    return {
      active: false,
      update: {
        status: "completed" as const,
        agentId: transcript.agentId,
        sessionKey: transcript.sessionKey,
        sessionName: transcript.sessionName,
        workspacePath: transcript.workspacePath,
        snapshot: transcript.snapshot,
        fullSnapshot: transcript.snapshot,
        initialSnapshot: "",
      },
    };
  }

  async detachRunObserver(target: AgentSessionTarget, observerId: string) {
    const run = this.activeRuns.get(target.sessionKey);
    if (!run) {
      return {
        detached: false,
      };
    }

    const observer = run.observers.get(observerId);
    if (!observer) {
      return {
        detached: false,
      };
    }

    observer.mode = "passive-final";
    return {
      detached: true,
    };
  }

  private startRunMonitor(
    run: ActiveRun,
    params: {
      prompt?: string;
      initialSnapshot: string;
      startedAt: number;
      detachedAlready: boolean;
    },
  ) {
    void (async () => {
      try {
        await monitorTmuxRun({
          tmux: this.tmux,
          sessionName: run.resolved.sessionName,
          prompt: params.prompt,
          promptSubmitDelayMs: run.resolved.runner.promptSubmitDelayMs,
          captureLines: run.resolved.stream.captureLines,
          updateIntervalMs: run.resolved.stream.updateIntervalMs,
          idleTimeoutMs: run.resolved.stream.idleTimeoutMs,
          noOutputTimeoutMs: run.resolved.stream.noOutputTimeoutMs,
          maxRuntimeMs: run.resolved.stream.maxRuntimeMs,
          startedAt: params.startedAt,
          initialSnapshot: params.initialSnapshot,
          detachedAlready: params.detachedAlready,
          onRunning: async (update) => {
            await this.notifyRunObservers(
              run,
              this.createRunUpdate({
                resolved: run.resolved,
                status: "running",
                snapshot: update.snapshot,
                fullSnapshot: update.fullSnapshot,
                initialSnapshot: update.initialSnapshot,
              }),
            );
          },
          onDetached: async (update) => {
            const detachedUpdate = this.createRunUpdate({
              resolved: run.resolved,
              status: "detached",
              snapshot: update.snapshot,
              fullSnapshot: update.fullSnapshot,
              initialSnapshot: update.initialSnapshot,
              note: this.buildDetachedNote(run.resolved),
            });
            await this.setSessionRuntime(run.resolved, {
              state: "detached",
              startedAt: params.startedAt,
              detachedAt: Date.now(),
            });
            run.latestUpdate = detachedUpdate;
            run.initialResult.resolve(detachedUpdate);
          },
          onCompleted: async (update) => {
            await this.finishActiveRun(
              run,
              this.createRunUpdate({
                resolved: run.resolved,
                status: "completed",
                snapshot: update.snapshot,
                fullSnapshot: update.fullSnapshot,
                initialSnapshot: update.initialSnapshot,
              }),
            );
          },
          onTimeout: async (update) => {
            await this.finishActiveRun(
              run,
              this.createRunUpdate({
                resolved: run.resolved,
                status: "timeout",
                snapshot: update.snapshot,
                fullSnapshot: update.fullSnapshot,
                initialSnapshot: update.initialSnapshot,
              }),
            );
          },
        });
      } catch (error) {
        await this.failActiveRun(run, this.mapSessionError(
          error,
          run.resolved.sessionName,
          "while the prompt was running",
        ));
      }
    })();
  }

  private async submitSessionInput(
    sessionName: string,
    text: string,
    promptSubmitDelayMs: number,
  ) {
    await this.tmux.sendLiteral(sessionName, text);
    await sleep(promptSubmitDelayMs);
    await this.tmux.sendKey(sessionName, "Enter");
  }

  private hasTrustPrompt(snapshot: string) {
    return (
      snapshot.includes("Do you trust the contents of this directory?") ||
      snapshot.includes("Press enter to continue")
    );
  }

  private async dismissTrustPromptIfPresent(
    resolved: ReturnType<AgentService["resolveTarget"]>,
  ) {
    const deadline = Date.now() + Math.max(
      TRUST_PROMPT_MAX_WAIT_MS,
      resolved.runner.startupDelayMs,
    );

    while (Date.now() <= deadline) {
      const snapshot = normalizePaneText(
        await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
      );
      if (!snapshot) {
        await sleep(TRUST_PROMPT_POLL_INTERVAL_MS);
        continue;
      }

      if (!this.hasTrustPrompt(snapshot)) {
        return;
      }

      await this.tmux.sendKey(resolved.sessionName, "Enter");
      await sleep(1500);
    }
  }

  private async executePrompt(
    target: AgentSessionTarget,
    prompt: string,
    observer: Omit<RunObserver, "lastSentAt">,
    options: { allowFreshRetryBeforePrompt?: boolean } = {},
  ): Promise<AgentExecutionResult> {
    const existingActiveRun = this.activeRuns.get(target.sessionKey);
    if (existingActiveRun) {
      throw new ActiveRunInProgressError(existingActiveRun.latestUpdate);
    }

    const existingEntry = await this.sessionStore.get(target.sessionKey);
    if (
      existingEntry?.runtime?.state &&
      existingEntry.runtime.state !== "idle"
    ) {
      const resolvedExisting = this.resolveTarget(target);
      throw new ActiveRunInProgressError(
        this.createRunUpdate({
          resolved: resolvedExisting,
          status: existingEntry.runtime.state === "detached" ? "detached" : "running",
          snapshot: "",
          fullSnapshot: "",
          initialSnapshot: "",
          note:
            existingEntry.runtime.state === "detached"
              ? this.buildDetachedNote(resolvedExisting)
              : "This session already has an active run. Use `/attach`, `/watch every 30s`, or `/stop` before sending a new prompt.",
        }),
      );
    }

    let resolved = await this.ensureSessionReady(target, {
      allowFreshRetry: options.allowFreshRetryBeforePrompt,
    });
    let initialSnapshot = "";
    let recoveredBeforePrompt = false;
    try {
      initialSnapshot = normalizePaneText(
        await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
      );
    } catch (error) {
      if (
        options.allowFreshRetryBeforePrompt !== false &&
        isMissingTmuxSessionError(error)
      ) {
        const existing = await this.sessionStore.get(resolved.sessionKey);
        if (existing?.sessionId) {
          const retried = await this.retryFreshStartWithClearedSessionId(
            target,
            resolved,
            {
              allowRetry: true,
              nextAllowFreshRetry: false,
            },
          );
          if (retried) {
            resolved = retried;
            recoveredBeforePrompt = true;
            try {
              initialSnapshot = normalizePaneText(
                await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
              );
            } catch (retryError) {
              throw this.mapSessionError(
                retryError,
                resolved.sessionName,
                "before prompt submission",
              );
            }
          } else {
            throw this.mapSessionError(error, resolved.sessionName, "before prompt submission");
          }
        }
      }
      if (!recoveredBeforePrompt) {
        throw this.mapSessionError(error, resolved.sessionName, "before prompt submission");
      }
    }
    const startedAt = Date.now();
    const initialResult = createDeferred<AgentExecutionResult>();
    const activeRun: ActiveRun = {
      resolved,
      observers: new Map([
        [observer.id, { ...observer }],
      ]),
      initialResult,
      latestUpdate: this.createRunUpdate({
        resolved,
        status: "running",
        snapshot: "",
        fullSnapshot: initialSnapshot,
        initialSnapshot,
      }),
      prompt,
    };
    this.activeRuns.set(resolved.sessionKey, activeRun);

    await this.setSessionRuntime(resolved, {
      state: "running",
      startedAt,
    });
    this.startRunMonitor(activeRun, {
      prompt,
      initialSnapshot,
      startedAt,
      detachedAlready: false,
    });

    return initialResult.promise;
  }

  enqueuePrompt(
    target: AgentSessionTarget,
    prompt: string,
    callbacks: StreamCallbacks & {
      observerId?: string;
    },
  ) {
    return this.queue.enqueue(target.sessionKey, async () =>
      this.executePrompt(target, prompt, {
        id: callbacks.observerId ?? `prompt:${target.sessionKey}`,
        mode: "live",
        onUpdate: callbacks.onUpdate,
      }),
    );
  }

  getMaxMessageChars(agentId: string) {
    const defaults = this.loadedConfig.raw.agents.defaults.stream;
    const override = getAgentEntry(this.loadedConfig, agentId)?.stream;
    return {
      ...defaults,
      ...(override ?? {}),
    }.maxMessageChars;
  }
}
