// tmux implementation of the RunnerBackend contract. Owns tmux-side run
// mechanics: readiness, input submission, interrupt/nudge, transcript
// capture, run monitoring, recovery restarts, and stale-session cleanup.

import type {
  AgentSessionTarget,
  ResolvedAgentTarget,
} from "../../agents/routing/resolved-target.ts";
import type { SessionMapping } from "../../agents/session/session-mapping.ts";
import type { LoadedConfig } from "../../config/core/load-config.ts";
import type { LatencyDebugContext } from "../../control/runtime/latency-debug.ts";
import { sleep } from "../../infra/process.ts";
import type { RunnerCapabilities } from "../contract/capabilities.ts";
import type {
  EnsureSessionReadyOptions,
  InterruptResult,
  NewSessionResult,
  NudgeResult,
  RunMonitorParams,
  RunnerBackend,
  RunnerReadyResult,
  ShellCommandResult,
  SubmitInputResult,
  TranscriptCapture,
} from "../contract/runner-backend.ts";
import { normalizePaneText } from "../transcript/index.ts";
import type { TmuxClient } from "./client.ts";
import {
  isFreshStartRetryablePromptDeliveryError,
  isMissingTmuxSessionError,
  isRecoverableStartupSessionLoss,
  isTransientTmuxTargetError,
  TmuxSubmitUnconfirmedError,
} from "./errors.ts";
import { canRestartWithStoredSessionId } from "./launch-command.ts";
import { monitorTmuxRun } from "./run-monitor.ts";
import { submitTmuxSessionInput } from "./submit-input.ts";
import { TmuxSessionIdMechanics } from "./session-id-mechanics.ts";
import { ensureTmuxShellPane, runTmuxShellCommand } from "./shell-command.ts";
import { TmuxSessionStartup } from "./startup.ts";

const NEW_SESSION_CAPTURE_RETRY_COUNT = 5;
const NEW_SESSION_CAPTURE_RETRY_DELAY_MS = 100;

export const TMUX_RUNNER_CAPABILITIES: RunnerCapabilities = {
  steer: true,
  interrupt: true,
  resume: true,
  attachView: true,
  permissionRequests: false,
  structuredEvents: false,
  nativeSlashCommands: true,
  shellCommands: true,
  nudge: true,
};

export class TmuxRunnerBackend implements RunnerBackend {
  readonly id = "tmux" as const;
  readonly capabilities = TMUX_RUNNER_CAPABILITIES;

  private cleanupInFlight = false;
  private readonly sessionIds: TmuxSessionIdMechanics;
  private readonly startup: TmuxSessionStartup;

  constructor(
    private readonly loadedConfig: LoadedConfig,
    private readonly tmux: TmuxClient,
    private readonly resolveTarget: (target: AgentSessionTarget) => ResolvedAgentTarget,
    private readonly sessionMapping: SessionMapping,
  ) {
    this.sessionIds = new TmuxSessionIdMechanics(tmux, sessionMapping);
    this.startup = new TmuxSessionStartup(
      loadedConfig,
      tmux,
      resolveTarget,
      sessionMapping,
      this.sessionIds,
    );
  }

  ensureSessionReady(target: AgentSessionTarget, options: EnsureSessionReadyOptions = {}) {
    return this.startup.ensureSessionReady(target, options);
  }

  ensureRunnerReady(
    target: AgentSessionTarget,
    options: {
      allowFreshRetryBeforePrompt?: boolean;
      timingContext?: LatencyDebugContext;
    } = {},
  ): Promise<RunnerReadyResult> {
    return this.startup.ensureRunnerReady(target, options);
  }

  async hasLiveSession(target: AgentSessionTarget) {
    const resolved = this.resolveTarget(target);
    return this.tmux.hasSession(resolved.sessionName);
  }

  async runSessionCleanup() {
    if (this.cleanupInFlight) {
      return;
    }

    this.cleanupInFlight = true;
    try {
      const entries = await this.sessionMapping.listEntries();
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

  async submitSessionInput(target: AgentSessionTarget, text: string): Promise<SubmitInputResult> {
    const resolved = this.resolveTarget(target);
    if (!(await this.tmux.hasSession(resolved.sessionName))) {
      throw new Error(`tmux session "${resolved.sessionName}" does not exist`);
    }

    await this.startup.acceptStartupContinuePromptIfPresent(resolved);
    await submitTmuxSessionInput({
      tmux: this.tmux,
      sessionName: resolved.sessionName,
      text,
      promptSubmitDelayMs: resolved.runner.promptSubmitDelayMs,
      timingContext: undefined,
    });
    await this.sessionMapping.touch(resolved);
    return this.describeTarget(resolved);
  }

  async interruptSession(target: AgentSessionTarget): Promise<InterruptResult> {
    const resolved = this.resolveTarget(target);
    const existed = await this.tmux.hasSession(resolved.sessionName);
    if (existed) {
      await this.sessionMapping.touch(resolved, {
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
      ...this.describeTarget(resolved),
      interrupted: existed,
    };
  }

  async nudgeSession(target: AgentSessionTarget): Promise<NudgeResult> {
    const resolved = this.resolveTarget(target);
    const existed = await this.tmux.hasSession(resolved.sessionName);
    if (existed) {
      await this.tmux.sendKey(resolved.sessionName, "Enter");
      await this.sessionMapping.touch(resolved);
    }

    return {
      ...this.describeTarget(resolved),
      nudged: existed,
    };
  }

  async triggerNewSession(target: AgentSessionTarget): Promise<NewSessionResult> {
    const resolved = this.resolveTarget(target);
    if (!(await this.tmux.hasSession(resolved.sessionName))) {
      return this.restartRunnerWithFreshSessionIdForNewCommand(target);
    }
    return this.triggerNewSessionInLiveRunner(resolved);
  }

  async runShellCommand(target: AgentSessionTarget, command: string): Promise<ShellCommandResult> {
    const resolved = await this.startup.ensureSessionReady(target);
    const paneId = await ensureTmuxShellPane({
      tmux: this.tmux,
      session: resolved,
    });
    return runTmuxShellCommand({
      tmux: this.tmux,
      session: resolved,
      paneId,
      command,
    });
  }

  async captureTranscript(target: AgentSessionTarget): Promise<TranscriptCapture> {
    const resolved = this.resolveTarget(target);
    if (!(await this.tmux.hasSession(resolved.sessionName))) {
      return {
        ...this.describeTarget(resolved),
        snapshot: "",
      };
    }

    try {
      return {
        ...this.describeTarget(resolved),
        snapshot: normalizePaneText(
          await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
        ),
      };
    } catch (error) {
      if (isMissingTmuxSessionError(error)) {
        return {
          ...this.describeTarget(resolved),
          snapshot: "",
        };
      }

      throw error;
    }
  }

  async monitorRun(params: RunMonitorParams) {
    const { resolved } = params;
    await monitorTmuxRun({
      tmux: this.tmux,
      sessionName: resolved.sessionName,
      prompt: params.prompt,
      promptSubmitDelayMs: resolved.runner.promptSubmitDelayMs,
      trustWorkspace: resolved.runner.trustWorkspace,
      startupDelayMs: resolved.runner.startupDelayMs,
      captureLines: resolved.stream.captureLines,
      updateIntervalMs: resolved.stream.updateIntervalMs,
      idleTimeoutMs: resolved.stream.idleTimeoutMs,
      noOutputTimeoutMs: resolved.stream.noOutputTimeoutMs,
      maxRuntimeMs: resolved.stream.maxRuntimeMs,
      startedAt: params.startedAt,
      initialSnapshot: params.initialSnapshot,
      detachedAlready: params.detachedAlready,
      timingContext: params.timingContext,
      onPromptSubmitted: params.onPromptSubmitted,
      onRunning: params.onRunning,
      onDetached: params.onDetached,
      onCompleted: params.onCompleted,
    });
  }

  async reopenRunContext(target: AgentSessionTarget, timingContext?: LatencyDebugContext) {
    const resolved = this.resolveTarget(target);
    const existing = await this.sessionMapping.get(resolved.sessionKey);
    if (!existing?.sessionId || !canRestartWithStoredSessionId(resolved)) {
      throw new Error(`Runner session "${resolved.sessionName}" cannot reopen the same conversation context.`);
    }
    return this.startup.ensureRunnerReady(target, {
      allowFreshRetryBeforePrompt: false,
      timingContext,
    });
  }

  async restartRunnerPreservingSessionId(
    target: AgentSessionTarget,
    timingContext?: LatencyDebugContext,
  ) {
    const resolved = this.resolveTarget(target);
    await this.startup.killRunnerAndPreserveSessionId(resolved);
    return this.startup.ensureRunnerReady(target, {
      allowFreshRetryBeforePrompt: false,
      timingContext,
    });
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
    await this.sessionMapping.clearActive(resolved, {
      runnerCommand: resolved.runner.command,
    });
    return this.startup.ensureRunnerReady(target, {
      allowFreshRetryBeforePrompt: false,
      timingContext,
    });
  }

  async recaptureSessionIdAfterRun(target: AgentSessionTarget) {
    const resolved = this.resolveTarget(target);
    return this.sessionIds.recaptureSessionIdAfterRun(resolved);
  }

  isSessionLoss(error: unknown) {
    return isRecoverableStartupSessionLoss(error);
  }

  canRecoverMidRun(error: unknown) {
    return isRecoverableStartupSessionLoss(error) || isTransientTmuxTargetError(error);
  }

  canRetryPromptAfterFreshStart(error: unknown) {
    return isFreshStartRetryablePromptDeliveryError(error);
  }

  async mapRunError(error: unknown, sessionName: string, lastSnapshot = "") {
    return this.startup.mapSessionError(
      error,
      sessionName,
      "while the prompt was running",
      lastSnapshot,
    );
  }

  private describeTarget(resolved: ResolvedAgentTarget) {
    return {
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
      sessionName: resolved.sessionName,
      workspacePath: resolved.workspacePath,
    };
  }

  private async triggerNewSessionInLiveRunner(resolved: ResolvedAgentTarget): Promise<NewSessionResult> {
    const oldSessionId = (await this.sessionMapping.get(resolved.sessionKey))?.sessionId;
    const command = this.resolveNewSessionCommand(resolved);
    await this.startup.acceptStartupContinuePromptIfPresent(resolved);
    let submitUnconfirmedError: TmuxSubmitUnconfirmedError | null = null;
    try {
      await this.submitNewSessionCommand(resolved, command);
    } catch (error) {
      if (error instanceof TmuxSubmitUnconfirmedError) {
        submitUnconfirmedError = error;
      } else {
        throw error;
      }
    }
    const sessionId = await this.captureNewSessionIdentityAfterTrigger(resolved, oldSessionId);
    if (!sessionId) {
      if (submitUnconfirmedError) {
        throw submitUnconfirmedError;
      }
      this.throwNewSessionCaptureFailure(command, oldSessionId);
    }
    try {
      await this.sessionMapping.setActive(resolved, {
        sessionId,
        runnerCommand: resolved.runner.command,
        runtime: {
          state: "idle",
        },
      });
    } catch (error) {
      this.throwNewSessionPersistFailure(command, sessionId, error);
    }
    return {
      ...this.describeTarget(resolved),
      command,
      sessionId,
      restartedRunner: false,
    };
  }

  private async restartRunnerWithFreshSessionIdForNewCommand(
    target: AgentSessionTarget,
  ): Promise<NewSessionResult> {
    const { resolved } = await this.restartRunnerWithFreshSessionId(target);
    const entry = await this.sessionMapping.get(resolved.sessionKey);
    return {
      ...this.describeTarget(resolved),
      command: "(fresh runner)",
      sessionId: entry?.sessionId,
      restartedRunner: true,
    };
  }

  private async submitNewSessionCommand(resolved: ResolvedAgentTarget, command: string) {
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
    for (let attempt = 0; attempt < NEW_SESSION_CAPTURE_RETRY_COUNT; attempt += 1) {
      const sessionId = await this.sessionIds.captureSessionIdFromRunner(resolved, {
        forceStatusCommand: true,
      });
      if (sessionId && sessionId !== oldSessionId) {
        return sessionId;
      }
      if (attempt < NEW_SESSION_CAPTURE_RETRY_COUNT - 1) {
        await sleep(NEW_SESSION_CAPTURE_RETRY_DELAY_MS);
      }
    }
    return null;
  }

  private throwNewSessionCaptureFailure(command: string, oldSessionId?: string): never {
    console.log(
      `clisbot preserved the previous stored sessionId after ${command} because status capture returned no id`,
    );
    throw new Error(
      oldSessionId
        ? `${command} completed, but clisbot could not confirm the rotated session id. The previous stored session id was preserved instead of being cleared automatically.`
        : `${command} completed, but clisbot could not capture a new session id from the runner status command.`,
    );
  }

  private throwNewSessionPersistFailure(
    command: string,
    sessionId: string,
    error: unknown,
  ): never {
    console.error(`clisbot failed to persist rotated sessionId after ${command}`, {
      sessionId,
      error,
    });
    const details =
      error instanceof Error && error.message.trim()
        ? ` Persist error: ${error.message.trim()}`
        : "";
    throw new Error(
      `${command} completed and clisbot captured session id ${sessionId}, but could not persist it. The durable session mapping was left unchanged.${details}`,
    );
  }

  private resolveNewSessionCommand(resolved: ResolvedAgentTarget) {
    return resolved.runner.command.toLowerCase().includes("gemini") ? "/clear" : "/new";
  }
}
