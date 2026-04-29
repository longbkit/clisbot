import { dirname } from "node:path";
import { createSessionId } from "./session-identity.ts";
import type { AgentSessionState } from "./session-state.ts";
import type { AgentSessionTarget, ResolvedAgentTarget } from "./resolved-target.ts";
import { applyTemplate, ensureDir } from "../shared/paths.ts";
import { sleep } from "../shared/process.ts";
import { normalizePaneText } from "../shared/transcript.ts";
import type { LoadedConfig } from "../config/load-config.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import { renderCliCommand } from "../shared/cli-name.ts";
import {
  captureTmuxSessionIdentity,
  dismissTmuxTrustPromptIfPresent,
  submitTmuxSessionInput,
  TmuxBootstrapSessionLostError,
  TmuxPasteUnconfirmedError,
  TmuxSubmitUnconfirmedError,
  tmuxPaneHasTrustPrompt,
  waitForTmuxSessionBootstrap,
} from "../runners/tmux/session-handshake.ts";
import {
  ensureTmuxShellPane,
  runTmuxShellCommand,
} from "../runners/tmux/shell-command.ts";
import {
  buildRunnerLaunchCommand,
  clearRunnerExitRecord,
  ensureClisbotWrapper,
  ensureRunnerExitRecordDir,
  getClisbotWrapperDir,
  getClisbotWrapperPath,
  readRunnerExitRecord,
} from "../control/clisbot-wrapper.ts";
import { logLatencyDebug, type LatencyDebugContext } from "../control/latency-debug.ts";

export type ShellCommandResult = {
  agentId: string;
  sessionKey: string;
  sessionName: string;
  workspacePath: string;
  command: string;
  output: string;
  exitCode: number;
  timedOut: boolean;
};

const TMUX_MISSING_SESSION_PATTERN = /(?:can't find session:|no server running on )/i;
const TMUX_SERVER_UNAVAILABLE_PATTERN = /(?:No such file or directory|error connecting to|failed to connect to server)/i;
const TMUX_DUPLICATE_SESSION_PATTERN = /duplicate session:/i;
const TMUX_TRANSIENT_TARGET_PATTERN =
  /(?:no current target|can't find pane|can't find window|no such pane|no such window|tmux pane state unavailable)/i;
const SESSION_READY_CAPTURE_RETRY_COUNT = 5;
const SESSION_READY_CAPTURE_RETRY_DELAY_MS = 100;
const TRIGGER_NEW_SESSION_CAPTURE_RETRY_COUNT = 3;
const SESSION_ID_CAPTURE_FAILURE_COOLDOWN_MS = 15_000;

type SessionErrorAction =
  | "during startup"
  | "before prompt submission"
  | "while the prompt was running";

function summarizeSnapshot(snapshot: string) {
  const compact = snapshot
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 220);
  return compact ? ` Last visible pane: ${compact}` : "";
}

function isTmuxDuplicateSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return TMUX_DUPLICATE_SESSION_PATTERN.test(message);
}

function isMissingTmuxSessionError(error: unknown) {
  return error instanceof Error && TMUX_MISSING_SESSION_PATTERN.test(error.message);
}

function isTmuxServerUnavailableError(error: unknown) {
  return error instanceof Error && TMUX_SERVER_UNAVAILABLE_PATTERN.test(error.message);
}

function isTransientTmuxTargetError(error: unknown) {
  return error instanceof Error && TMUX_TRANSIENT_TARGET_PATTERN.test(error.message);
}

function isBootstrapSessionLostError(error: unknown) {
  return error instanceof TmuxBootstrapSessionLostError;
}

function isRecoverableStartupSessionLoss(error: unknown) {
  return (
    isMissingTmuxSessionError(error) ||
    isTmuxServerUnavailableError(error) ||
    isBootstrapSessionLostError(error)
  );
}

function isFreshStartRetryablePromptDeliveryError(error: unknown) {
  return error instanceof TmuxPasteUnconfirmedError || error instanceof TmuxSubmitUnconfirmedError;
}

function isRetryableFreshStartFault(error: unknown) {
  return (
    isRecoverableStartupSessionLoss(error) ||
    isTransientTmuxTargetError(error) ||
    isFreshStartRetryablePromptDeliveryError(error)
  );
}

function canRestartWithStoredSessionId(resolved: ResolvedAgentTarget) {
  return (
    resolved.runner.sessionId.resume.mode === "command" ||
    resolved.runner.sessionId.create.mode === "explicit"
  );
}

export class RunnerService {
  private cleanupInFlight = false;
  private readonly sessionIdentityCaptureRetryAt = new Map<string, number>();

  constructor(
    private readonly loadedConfig: LoadedConfig,
    private readonly tmux: TmuxClient,
    private readonly sessionState: AgentSessionState,
    private readonly resolveTarget: (target: AgentSessionTarget) => ResolvedAgentTarget,
  ) {}

  private async mapSessionError(
    error: unknown,
    sessionName: string,
    action: SessionErrorAction,
    lastSnapshot = "",
  ) {
    if (isRecoverableStartupSessionLoss(error)) {
      const exitRecord = await readRunnerExitRecord(this.loadedConfig.stateDir, sessionName);
      console.error("runner session disappeared", {
        sessionName,
        action,
        exitCode: exitRecord?.exitCode,
        exitedAt: exitRecord?.exitedAt,
        runnerCommand: exitRecord?.command,
        lastVisiblePane: lastSnapshot ? summarizeSnapshot(lastSnapshot).trim() : undefined,
      });
      return new Error(`Runner session "${sessionName}" disappeared ${action}.`);
    }

    if (isTransientTmuxTargetError(error)) {
      return new Error(
        `Runner session "${sessionName}" lost its tmux target ${action}. clisbot stayed alive, but this request could not continue cleanly. Retry once. If it keeps happening, inspect ${renderCliCommand("status", { inline: true })} and ${renderCliCommand("logs", { inline: true })}.${summarizeSnapshot(lastSnapshot)}`,
      );
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private buildRunnerArgs(
    resolved: ResolvedAgentTarget,
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

  private async syncSessionIdentity(resolved: ResolvedAgentTarget) {
    const existing = await this.sessionState.getEntry(resolved.sessionKey);
    if (existing?.sessionId) {
      this.sessionIdentityCaptureRetryAt.delete(resolved.sessionKey);
      return this.sessionState.touchSessionEntry(resolved, {
        sessionId: existing.sessionId,
        runnerCommand: resolved.runner.command,
      });
    }

    const retryAt = this.sessionIdentityCaptureRetryAt.get(resolved.sessionKey) ?? 0;
    if (retryAt > Date.now()) {
      return this.sessionState.touchSessionEntry(resolved, {
        runnerCommand: resolved.runner.command,
      });
    }

    let sessionId: string | null;
    try {
      sessionId = await this.captureSessionIdentity(resolved);
    } catch (error) {
      if (isFreshStartRetryablePromptDeliveryError(error)) {
        this.sessionIdentityCaptureRetryAt.set(
          resolved.sessionKey,
          Date.now() + SESSION_ID_CAPTURE_FAILURE_COOLDOWN_MS,
        );
      }
      throw error;
    }
    if (sessionId) {
      this.sessionIdentityCaptureRetryAt.delete(resolved.sessionKey);
    } else {
      this.sessionIdentityCaptureRetryAt.set(
        resolved.sessionKey,
        Date.now() + SESSION_ID_CAPTURE_FAILURE_COOLDOWN_MS,
      );
    }
    return this.sessionState.touchSessionEntry(resolved, {
      sessionId,
      runnerCommand: resolved.runner.command,
    });
  }

  private async captureSessionIdentity(
    resolved: ResolvedAgentTarget,
    options: { forceStatusCommand?: boolean } = {},
  ) {
    const capture = resolved.runner.sessionId.capture;
    if (capture.mode !== "status-command" && !options.forceStatusCommand) {
      return null;
    }

    return captureTmuxSessionIdentity({
      tmux: this.tmux,
      sessionName: resolved.sessionName,
      promptSubmitDelayMs: resolved.runner.promptSubmitDelayMs,
      captureLines: resolved.stream.captureLines,
      statusCommand: capture.statusCommand,
      pattern: capture.pattern,
      timeoutMs: capture.timeoutMs,
      pollIntervalMs: capture.pollIntervalMs,
    });
  }

  private async retryRunnerRestartPreservingSessionId(
    target: AgentSessionTarget,
    resolved: ResolvedAgentTarget,
    remainingFreshRetries: number,
  ) {
    if (remainingFreshRetries <= 0) {
      return null;
    }

    await this.killRunnerAndPreserveSessionId(resolved);
    if (resolved.runner.startupRetryDelayMs > 0) {
      await sleep(resolved.runner.startupRetryDelayMs);
    }
    return this.ensureSessionReady(target, {
      remainingFreshRetries: remainingFreshRetries - 1,
    });
  }

  private async retryAfterStartupFault(
    target: AgentSessionTarget,
    resolved: ResolvedAgentTarget,
    error: unknown,
    remainingFreshRetries: number,
  ) {
    if (!isRetryableFreshStartFault(error)) {
      return null;
    }

    return this.retryRunnerRestartPreservingSessionId(
      target,
      resolved,
      remainingFreshRetries,
    );
  }

  private async retryAfterStartupTimeout(
    target: AgentSessionTarget,
    resolved: ResolvedAgentTarget,
    remainingFreshRetries: number,
  ) {
    return this.retryRunnerRestartPreservingSessionId(
      target,
      resolved,
      remainingFreshRetries,
    );
  }

  private resolveRemainingFreshRetries(
    resolved: ResolvedAgentTarget,
    options: {
      allowFreshRetry?: boolean;
      remainingFreshRetries?: number;
    },
  ) {
    if (typeof options.remainingFreshRetries === "number") {
      return options.remainingFreshRetries;
    }
    if (options.allowFreshRetry === false) {
      return 0;
    }
    return resolved.runner.startupRetryCount;
  }

  private async abortUnreadySession(
    resolved: ResolvedAgentTarget,
    reason: string,
    snapshot: string,
  ) {
    await this.tmux.killSession(resolved.sessionName);
    throw new Error(`${reason}${summarizeSnapshot(snapshot)}`);
  }

  private async verifySessionReady(resolved: ResolvedAgentTarget) {
    if (!(await this.tmux.isServerRunning())) {
      throw new TmuxBootstrapSessionLostError(
        resolved.sessionName,
        "tmux server became unavailable before startup finished",
      );
    }

    if (!(await this.tmux.hasSession(resolved.sessionName))) {
      throw new TmuxBootstrapSessionLostError(
        resolved.sessionName,
        "tmux session disappeared before startup finished",
      );
    }

    for (let attempt = 0; attempt < SESSION_READY_CAPTURE_RETRY_COUNT; attempt += 1) {
      try {
        const snapshot = await this.captureSessionSnapshot(resolved);
        if (tmuxPaneHasTrustPrompt(snapshot)) {
          await this.dismissVisibleTrustPrompt(resolved);
          continue;
        }
        return;
      } catch (error) {
        if (isRecoverableStartupSessionLoss(error)) {
          throw new TmuxBootstrapSessionLostError(
            resolved.sessionName,
            error instanceof Error ? error.message : String(error),
          );
        }
        if (
          !isTransientTmuxTargetError(error) ||
          attempt === SESSION_READY_CAPTURE_RETRY_COUNT - 1
        ) {
          throw error;
        }
      }

      await sleep(SESSION_READY_CAPTURE_RETRY_DELAY_MS);
    }
  }

  async runSessionCleanup() {
    if (this.cleanupInFlight) {
      return;
    }

    this.cleanupInFlight = true;
    try {
      const entries = await this.sessionState.listEntries();
      const liveSessionNames = new Set(await this.tmux.listSessions());
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

        if (!liveSessionNames.has(resolved.sessionName)) {
          continue;
        }

        await this.tmux.killSession(resolved.sessionName);
        console.log(
          `clisbot sunset stale session ${resolved.sessionName} after ${staleAfterMinutes}m idle`,
        );
      }
    } finally {
      this.cleanupInFlight = false;
    }
  }

  async ensureSessionReady(
    target: AgentSessionTarget,
    options: {
      allowFreshRetry?: boolean;
      remainingFreshRetries?: number;
      timingContext?: LatencyDebugContext;
    } = {},
  ): Promise<ResolvedAgentTarget> {
    await ensureClisbotWrapper();
    const resolved = this.resolveTarget(target);
    const timingContext = {
      ...options.timingContext,
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
      sessionName: resolved.sessionName,
    };
    const remainingFreshRetries = this.resolveRemainingFreshRetries(resolved, options);
    logLatencyDebug("ensure-session-ready-start", timingContext);
    await ensureDir(resolved.workspacePath);
    await ensureDir(dirname(this.loadedConfig.raw.tmux.socketPath));
    await ensureRunnerExitRecordDir(this.loadedConfig.stateDir, resolved.sessionName);
    const existing = await this.sessionState.getEntry(resolved.sessionKey);
    const serverRunning = await this.tmux.isServerRunning();

    if (serverRunning && (await this.tmux.hasSession(resolved.sessionName))) {
      logLatencyDebug("ensure-session-ready-existing-session", timingContext, {
        hasStoredSessionId: Boolean(existing?.sessionId),
      });
      try {
        await clearRunnerExitRecord(this.loadedConfig.stateDir, resolved.sessionName);
        await this.syncSessionIdentity(resolved);
      } catch (error) {
        throw await this.mapSessionError(error, resolved.sessionName, "during startup");
      }
      logLatencyDebug("ensure-session-ready-complete", timingContext, {
        startupDelayMs: 0,
        reusedSession: true,
      });
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
    await clearRunnerExitRecord(this.loadedConfig.stateDir, resolved.sessionName);
    const command = buildRunnerLaunchCommand({
      command: runnerLaunch.command,
      args: runnerLaunch.args,
      wrapperDir: getClisbotWrapperDir(),
      wrapperPath: getClisbotWrapperPath(),
      sessionName: resolved.sessionName,
      stateDir: this.loadedConfig.stateDir,
    });

    try {
      try {
        await this.tmux.newSession({
          sessionName: resolved.sessionName,
          cwd: resolved.workspacePath,
          command,
        });
      } catch (error) {
        const hasSession = await this.tmux.hasSession(resolved.sessionName);
        if (!isTmuxDuplicateSessionError(error) || !hasSession) {
          throw error;
        }
      }

      logLatencyDebug("ensure-session-ready-new-session", timingContext, {
        startupDelayMs: resolved.runner.startupDelayMs,
        resumingExistingSession,
        hasStoredSessionId: Boolean(existing?.sessionId),
      });
      const bootstrapResult = await waitForTmuxSessionBootstrap({
        tmux: this.tmux,
        sessionName: resolved.sessionName,
        captureLines: resolved.stream.captureLines,
        startupDelayMs: resolved.runner.startupDelayMs,
        trustWorkspace: resolved.runner.trustWorkspace,
        readyPattern: resolved.runner.startupReadyPattern,
        blockers: resolved.runner.startupBlockers,
      });
      if (bootstrapResult.status === "blocked") {
        await this.abortUnreadySession(
          resolved,
          bootstrapResult.message,
          bootstrapResult.snapshot,
        );
      }

      if (bootstrapResult.status === "timeout" && resolved.runner.startupReadyPattern) {
        const retried = await this.retryAfterStartupTimeout(
          target,
          resolved,
          remainingFreshRetries,
        );
        if (retried) {
          return retried;
        }
        await this.abortUnreadySession(
          resolved,
          `Runner session "${resolved.sessionName}" did not reach the configured ready state within ${resolved.runner.startupDelayMs}ms.`,
          bootstrapResult.snapshot,
        );
      }

      await this.finalizeSessionStartup(resolved, {
        startupSessionId,
        runnerCommand: runnerLaunch.command,
      });
    } catch (error) {
      const retried = await this.retryAfterStartupFault(
        target,
        resolved,
        error,
        remainingFreshRetries,
      );
      if (retried) {
        return retried;
      }
      throw await this.mapSessionError(error, resolved.sessionName, "during startup");
    }

    logLatencyDebug("ensure-session-ready-complete", timingContext, {
      startupDelayMs: resolved.runner.startupDelayMs,
      reusedSession: false,
    });
    return resolved;
  }

  private async finalizeSessionStartup(
    resolved: ResolvedAgentTarget,
    params: {
      startupSessionId: string;
      runnerCommand: string;
    },
  ) {
    await this.dismissTrustPrompt(resolved);
    await this.verifySessionReady(resolved);

    if (params.startupSessionId) {
      await this.sessionState.touchSessionEntry(resolved, {
        sessionId: params.startupSessionId,
        runnerCommand: params.runnerCommand,
      });
      return;
    }

    await this.syncSessionIdentity(resolved);
  }

  private async dismissTrustPrompt(resolved: ResolvedAgentTarget) {
    if (!resolved.runner.trustWorkspace) {
      return;
    }

    await this.dismissVisibleTrustPrompt(resolved);
  }

  private async dismissVisibleTrustPrompt(resolved: ResolvedAgentTarget) {
    await dismissTmuxTrustPromptIfPresent({
      tmux: this.tmux,
      sessionName: resolved.sessionName,
      captureLines: resolved.stream.captureLines,
      startupDelayMs: resolved.runner.startupDelayMs,
    });
  }

  private async captureSessionSnapshot(resolved: ResolvedAgentTarget) {
    return normalizePaneText(
      await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
    );
  }

  async ensureRunnerReady(
    target: AgentSessionTarget,
    options: {
      allowFreshRetryBeforePrompt?: boolean;
      timingContext?: LatencyDebugContext;
    } = {},
  ) {
    let resolved = await this.ensureSessionReady(target, {
      allowFreshRetry: options.allowFreshRetryBeforePrompt,
      timingContext: options.timingContext,
    });

    try {
      return {
        resolved,
        initialSnapshot: await this.captureSessionSnapshot(resolved),
      };
    } catch (error) {
      if (
        options.allowFreshRetryBeforePrompt === false ||
        !isRecoverableStartupSessionLoss(error)
      ) {
        throw await this.mapSessionError(
          error,
          resolved.sessionName,
          "before prompt submission",
          resolved.sessionName ? await this.captureSessionSnapshot(resolved).catch(() => "") : "",
        );
      }

      const retried = await this.retryRunnerRestartPreservingSessionId(
        target,
        resolved,
        resolved.runner.startupRetryCount,
      );
      if (!retried) {
        throw await this.mapSessionError(
          error,
          resolved.sessionName,
          "before prompt submission",
          resolved.sessionName ? await this.captureSessionSnapshot(resolved).catch(() => "") : "",
        );
      }

      resolved = retried;
      return {
        resolved,
        initialSnapshot: await this.captureSessionSnapshot(resolved),
      };
    }
  }

  canRecoverMidRun(error: unknown) {
    return isRecoverableStartupSessionLoss(error) || isTransientTmuxTargetError(error);
  }

  canRetryPromptAfterFreshStart(error: unknown) {
    return isFreshStartRetryablePromptDeliveryError(error);
  }

  async reopenRunContext(target: AgentSessionTarget, timingContext?: LatencyDebugContext) {
    const resolved = this.resolveTarget(target);
    const existing = await this.sessionState.getEntry(resolved.sessionKey);
    if (!existing?.sessionId || !canRestartWithStoredSessionId(resolved)) {
      throw new Error(`Runner session "${resolved.sessionName}" cannot reopen the same conversation context.`);
    }
    return this.ensureRunnerReady(target, { allowFreshRetryBeforePrompt: false, timingContext });
  }

  async restartRunnerWithFreshSessionId(
    target: AgentSessionTarget,
    timingContext?: LatencyDebugContext,
  ) {
    const resolved = this.resolveTarget(target);
    await this.tmux.killSession(resolved.sessionName).catch(() => undefined);
    console.log(
      `clisbot clearing stored sessionId for explicit fresh session ${resolved.sessionName}`,
    );
    await this.sessionState.clearSessionIdEntry(resolved, { runnerCommand: resolved.runner.command });
    return this.ensureRunnerReady(target, {
      allowFreshRetryBeforePrompt: false,
      timingContext,
    });
  }

  async triggerNewSession(target: AgentSessionTarget) {
    const resolved = this.resolveTarget(target);
    if (!(await this.tmux.hasSession(resolved.sessionName))) {
      return this.restartRunnerWithFreshSessionIdForNewCommand(target);
    }
    return this.triggerNewSessionInLiveRunner(resolved);
  }

  async restartRunnerPreservingSessionId(
    target: AgentSessionTarget,
    timingContext?: LatencyDebugContext,
  ) {
    const resolved = this.resolveTarget(target);
    await this.killRunnerAndPreserveSessionId(resolved);
    return this.ensureRunnerReady(target, {
      allowFreshRetryBeforePrompt: false,
      timingContext,
    });
  }

  private async triggerNewSessionInLiveRunner(resolved: ResolvedAgentTarget) {
    const oldSessionId = (await this.sessionState.getEntry(resolved.sessionKey))?.sessionId;
    const command = this.resolveNewSessionCommand(resolved);
    let sessionId: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.submitNewSessionCommand(resolved, command);
      sessionId = await this.captureNewSessionIdentityAfterTrigger(resolved, oldSessionId);
      if (sessionId) {
        break;
      }
    }
    if (!sessionId) {
      await this.clearSessionIdAfterNewSessionFailure(resolved, command);
    }
    await this.sessionState.touchSessionEntry(resolved, {
      sessionId,
      runnerCommand: resolved.runner.command,
      runtime: {
        state: "idle",
      },
    });
    return {
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
      sessionName: resolved.sessionName,
      workspacePath: resolved.workspacePath,
      command,
      sessionId,
      restartedRunner: false,
    };
  }

  private async restartRunnerWithFreshSessionIdForNewCommand(target: AgentSessionTarget) {
    const { resolved } = await this.restartRunnerWithFreshSessionId(target);
    const entry = await this.sessionState.getEntry(resolved.sessionKey);
    return {
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
      sessionName: resolved.sessionName,
      workspacePath: resolved.workspacePath,
      command: "(fresh runner)",
      sessionId: entry?.sessionId,
      restartedRunner: true,
    };
  }

  private async submitNewSessionCommand(
    resolved: ResolvedAgentTarget,
    command: string,
  ) {
    await submitTmuxSessionInput({
      tmux: this.tmux,
      sessionName: resolved.sessionName,
      text: command,
      promptSubmitDelayMs: resolved.runner.promptSubmitDelayMs,
      timingContext: undefined,
    });
  }

  private async captureNewSessionIdentityAfterTrigger(
    resolved: ResolvedAgentTarget,
    oldSessionId?: string,
  ) {
    for (let attempt = 0; attempt < TRIGGER_NEW_SESSION_CAPTURE_RETRY_COUNT; attempt += 1) {
      const sessionId = await this.captureSessionIdentity(resolved, {
        forceStatusCommand: true,
      });
      if (sessionId && sessionId !== oldSessionId) {
        return sessionId;
      }
      if (attempt < TRIGGER_NEW_SESSION_CAPTURE_RETRY_COUNT - 1) {
        await sleep(SESSION_READY_CAPTURE_RETRY_DELAY_MS);
      }
    }
    return null;
  }

  private async clearSessionIdAfterNewSessionFailure(
    resolved: ResolvedAgentTarget,
    command: string,
  ): Promise<never> {
    console.log(
      `clisbot clearing stored sessionId after ${command} because status capture returned no id for ${resolved.sessionName}`,
    );
    await this.sessionState.clearSessionIdEntry(resolved, {
      runnerCommand: resolved.runner.command,
    });
    throw new Error(
      `${command} completed, but clisbot could not capture a new session id from the runner status command.`,
    );
  }

  private async killRunnerAndPreserveSessionId(resolved: ResolvedAgentTarget) {
    await this.tmux.killSession(resolved.sessionName);
    await this.sessionState.touchSessionEntry(resolved, {
      runnerCommand: resolved.runner.command,
    });
  }

  private resolveNewSessionCommand(resolved: ResolvedAgentTarget) {
    return resolved.runner.command.toLowerCase().includes("gemini") ? "/clear" : "/new";
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

    await this.sessionState.touchSessionEntry(resolved);

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
      await this.sessionState.touchSessionEntry(resolved, {
        runtime: {
          state: "idle",
        },
      });
      try {
        await this.tmux.sendKey(resolved.sessionName, "Escape");
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

  async nudgeSession(target: AgentSessionTarget) {
    const resolved = this.resolveTarget(target);
    const existed = await this.tmux.hasSession(resolved.sessionName);
    if (existed) {
      await this.tmux.sendKey(resolved.sessionName, "Enter");
      await this.sessionState.touchSessionEntry(resolved);
    }

    return {
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
      sessionName: resolved.sessionName,
      workspacePath: resolved.workspacePath,
      nudged: existed,
    };
  }

  private async ensureShellPane(target: AgentSessionTarget) {
    const resolved = await this.ensureSessionReady(target);
    const paneId = await ensureTmuxShellPane({
      tmux: this.tmux,
      session: resolved,
    });
    return {
      ...resolved,
      paneId,
    };
  }

  async runShellCommand(target: AgentSessionTarget, command: string): Promise<ShellCommandResult> {
    const resolved = await this.ensureShellPane(target);
    return runTmuxShellCommand({
      tmux: this.tmux,
      session: resolved,
      paneId: resolved.paneId,
      command,
    });
  }

  async submitSessionInput(target: AgentSessionTarget, text: string) {
    const resolved = this.resolveTarget(target);
    if (!(await this.tmux.hasSession(resolved.sessionName))) {
      throw new Error(`tmux session "${resolved.sessionName}" does not exist`);
    }

    await submitTmuxSessionInput({
      tmux: this.tmux,
      sessionName: resolved.sessionName,
      text,
      promptSubmitDelayMs: resolved.runner.promptSubmitDelayMs,
      timingContext: undefined,
    });
    await this.sessionState.touchSessionEntry(resolved);
    return {
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
      sessionName: resolved.sessionName,
      workspacePath: resolved.workspacePath,
    };
  }

  async mapRunError(error: unknown, sessionName: string, lastSnapshot = "") {
    return await this.mapSessionError(
      error,
      sessionName,
      "while the prompt was running",
      lastSnapshot,
    );
  }
}
