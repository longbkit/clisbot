import { dirname } from "node:path";
import { createSessionId } from "./session-identity.ts";
import type { AgentSessionState } from "./session-state.ts";
import type { AgentSessionTarget, ResolvedAgentTarget } from "./resolved-target.ts";
import { applyTemplate, ensureDir } from "../shared/paths.ts";
import { sleep } from "../shared/process.ts";
import { normalizePaneText } from "../shared/transcript.ts";
import type { LoadedConfig } from "../config/load-config.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import {
  captureTmuxSessionIdentity,
  dismissTmuxTrustPromptIfPresent,
  submitTmuxSessionInput,
  waitForTmuxSessionBootstrap,
} from "../runners/tmux/session-handshake.ts";
import {
  ensureTmuxShellPane,
  runTmuxShellCommand,
} from "../runners/tmux/shell-command.ts";
import {
  ensureClisbotWrapper,
  getClisbotWrapperDir,
  getClisbotWrapperPath,
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
const TMUX_DUPLICATE_SESSION_PATTERN = /duplicate session:/i;

type SessionErrorAction =
  | "during startup"
  | "before prompt submission"
  | "while the prompt was running";

function shellQuote(value: string) {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function buildCommandString(command: string, args: string[]) {
  return [command, ...args].map(shellQuote).join(" ");
}

function buildRunnerLaunchCommand(command: string, args: string[]) {
  const wrapperDir = getClisbotWrapperDir();
  const wrapperPath = getClisbotWrapperPath();
  const exports = [
    `export PATH=${shellQuote(wrapperDir)}:"$PATH"`,
    `export CLISBOT_BIN=${shellQuote(wrapperPath)}`,
  ];
  return `${exports.join("; ")}; exec ${buildCommandString(command, args)}`;
}

function isTmuxDuplicateSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return TMUX_DUPLICATE_SESSION_PATTERN.test(message);
}

function isMissingTmuxSessionError(error: unknown) {
  return error instanceof Error && TMUX_MISSING_SESSION_PATTERN.test(error.message);
}

export class RunnerSessionService {
  private cleanupInFlight = false;

  constructor(
    private readonly loadedConfig: LoadedConfig,
    private readonly tmux: TmuxClient,
    private readonly sessionState: AgentSessionState,
    private readonly resolveTarget: (target: AgentSessionTarget) => ResolvedAgentTarget,
  ) {}

  private mapSessionError(
    error: unknown,
    sessionName: string,
    action: SessionErrorAction,
  ) {
    if (isMissingTmuxSessionError(error)) {
      return new Error(`Runner session "${sessionName}" disappeared ${action}.`);
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
      return this.sessionState.touchSessionEntry(resolved, {
        sessionId: existing.sessionId,
        runnerCommand: resolved.runner.command,
      });
    }

    const sessionId = await this.captureSessionIdentity(resolved);
    return this.sessionState.touchSessionEntry(resolved, {
      sessionId,
      runnerCommand: resolved.runner.command,
    });
  }

  private async captureSessionIdentity(resolved: ResolvedAgentTarget) {
    const capture = resolved.runner.sessionId.capture;
    if (capture.mode !== "status-command") {
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

  private async retryFreshStartWithClearedSessionId(
    target: AgentSessionTarget,
    resolved: ResolvedAgentTarget,
    options: { allowRetry?: boolean; nextAllowFreshRetry?: boolean },
  ) {
    if (options.allowRetry === false) {
      return null;
    }

    await this.tmux.killSession(resolved.sessionName);
    await this.sessionState.clearSessionIdEntry(resolved, {
      runnerCommand: resolved.runner.command,
    });
    return this.ensureSessionReady(target, {
      allowFreshRetry: options.nextAllowFreshRetry,
    });
  }

  async runSessionCleanup() {
    if (this.cleanupInFlight) {
      return;
    }

    this.cleanupInFlight = true;
    try {
      const entries = await this.sessionState.listEntries();
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

        if (!(await this.tmux.hasSession(resolved.sessionName))) {
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
    options: { allowFreshRetry?: boolean; timingContext?: LatencyDebugContext } = {},
  ): Promise<ResolvedAgentTarget> {
    await ensureClisbotWrapper();
    const resolved = this.resolveTarget(target);
    const timingContext = {
      ...options.timingContext,
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
      sessionName: resolved.sessionName,
    };
    logLatencyDebug("ensure-session-ready-start", timingContext);
    await ensureDir(resolved.workspacePath);
    await ensureDir(dirname(this.loadedConfig.raw.tmux.socketPath));
    const existing = await this.sessionState.getEntry(resolved.sessionKey);
    const serverRunning = await this.tmux.isServerRunning();

    if (serverRunning && (await this.tmux.hasSession(resolved.sessionName))) {
      logLatencyDebug("ensure-session-ready-existing-session", timingContext, {
        hasStoredSessionId: Boolean(existing?.sessionId),
      });
      try {
        await this.syncSessionIdentity(resolved);
      } catch (error) {
        throw this.mapSessionError(error, resolved.sessionName, "during startup");
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
    const command = buildRunnerLaunchCommand(runnerLaunch.command, runnerLaunch.args);

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
    await waitForTmuxSessionBootstrap({
      tmux: this.tmux,
      sessionName: resolved.sessionName,
      captureLines: resolved.stream.captureLines,
      startupDelayMs: resolved.runner.startupDelayMs,
    });
    const sessionStillExists = await this.tmux.hasSession(resolved.sessionName);
    if (!sessionStillExists) {
      if (resumingExistingSession) {
        const retried = await this.retryFreshStartWithClearedSessionId(target, resolved, {
          allowRetry: options.allowFreshRetry,
          nextAllowFreshRetry: false,
        });
        if (retried) {
          return retried;
        }
      }
      throw new Error(`Runner session "${resolved.sessionName}" disappeared during startup.`);
    }

    try {
      await this.finalizeSessionStartup(target, resolved, {
        startupSessionId,
        resumingExistingSession,
        runnerCommand: runnerLaunch.command,
        allowFreshRetry: options.allowFreshRetry,
      });
    } catch (error) {
      throw this.mapSessionError(error, resolved.sessionName, "during startup");
    }

    logLatencyDebug("ensure-session-ready-complete", timingContext, {
      startupDelayMs: resolved.runner.startupDelayMs,
      reusedSession: false,
    });
    return resolved;
  }

  private async finalizeSessionStartup(
    target: AgentSessionTarget,
    resolved: ResolvedAgentTarget,
    params: {
      startupSessionId: string;
      resumingExistingSession: boolean;
      runnerCommand: string;
      allowFreshRetry?: boolean;
    },
  ) {
    await this.dismissTrustPrompt(target, resolved, params);

    if (params.startupSessionId) {
      await this.sessionState.touchSessionEntry(resolved, {
        sessionId: params.startupSessionId,
        runnerCommand: params.runnerCommand,
      });
      return;
    }

    try {
      await this.syncSessionIdentity(resolved);
    } catch (error) {
      const retried = await this.retryFromMissingSessionDuringResume(
        target,
        resolved,
        error,
        params.allowFreshRetry,
      );
      if (!retried) {
        throw error;
      }
    }
  }

  private async dismissTrustPrompt(
    target: AgentSessionTarget,
    resolved: ResolvedAgentTarget,
    params: { resumingExistingSession: boolean; allowFreshRetry?: boolean },
  ) {
    if (!resolved.runner.trustWorkspace) {
      return;
    }

    try {
      await dismissTmuxTrustPromptIfPresent({
        tmux: this.tmux,
        sessionName: resolved.sessionName,
        captureLines: resolved.stream.captureLines,
        startupDelayMs: resolved.runner.startupDelayMs,
      });
    } catch (error) {
      const retried = await this.retryFromMissingSessionDuringResume(
        target,
        resolved,
        error,
        params.allowFreshRetry,
        params.resumingExistingSession,
      );
      if (!retried) {
        throw error;
      }
    }
  }

  private async retryFromMissingSessionDuringResume(
    target: AgentSessionTarget,
    resolved: ResolvedAgentTarget,
    error: unknown,
    allowFreshRetry?: boolean,
    resumingExistingSession = true,
  ) {
    if (!resumingExistingSession || !isMissingTmuxSessionError(error)) {
      return null;
    }

    return this.retryFreshStartWithClearedSessionId(target, resolved, {
      allowRetry: allowFreshRetry,
      nextAllowFreshRetry: false,
    });
  }

  private async captureSessionSnapshot(resolved: ResolvedAgentTarget) {
    return normalizePaneText(
      await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
    );
  }

  async preparePromptSession(
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
      const existing = await this.sessionState.getEntry(resolved.sessionKey);
      if (
        options.allowFreshRetryBeforePrompt === false ||
        !existing?.sessionId ||
        !isMissingTmuxSessionError(error)
      ) {
        throw this.mapSessionError(error, resolved.sessionName, "before prompt submission");
      }

      const retried = await this.retryFreshStartWithClearedSessionId(target, resolved, {
        allowRetry: true,
        nextAllowFreshRetry: false,
      });
      if (!retried) {
        throw this.mapSessionError(error, resolved.sessionName, "before prompt submission");
      }

      resolved = retried;
      return {
        resolved,
        initialSnapshot: await this.captureSessionSnapshot(resolved),
      };
    }
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

  mapRunError(error: unknown, sessionName: string) {
    return this.mapSessionError(error, sessionName, "while the prompt was running");
  }
}
