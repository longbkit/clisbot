// tmux backend startup flow: bring the runner session to a ready state,
// including bootstrap waits, trust/continue prompts, resume handling, retry
// policy, and truthful failure classification. Continuity decisions stay in
// the session-owned mapping; this class only executes tmux-side mechanics.

import { dirname } from "node:path";
import type {
  AgentSessionTarget,
  ResolvedAgentTarget,
} from "../../agents/routing/resolved-target.ts";
import type { SessionMapping } from "../../agents/session/session-mapping.ts";
import { buildResumeRejectedFreshStartNote } from "../../agents/session/run-recovery.ts";
import type { LoadedConfig } from "../../config/core/load-config.ts";
import {
  buildRunnerLaunchCommand,
  clearRunnerExitRecord,
  ensureClisbotWrapper,
  ensureRunnerExitRecordDir,
  getClisbotWrapperDir,
  getClisbotWrapperPath,
  readRunnerExitRecord,
} from "../../control/commands/clisbot-wrapper.ts";
import { renderCliCommand } from "../../control/commands/cli-name.ts";
import { paneShowsRunnerExitSentinel } from "../../control/runner/runner-exit-diagnostics.ts";
import { logLatencyDebug, type LatencyDebugContext } from "../../control/runtime/latency-debug.ts";
import { ensureDir } from "../../infra/paths.ts";
import { sleep } from "../../infra/process.ts";
import type { EnsureSessionReadyOptions } from "../contract/runner-backend.ts";
import { normalizePaneText } from "../transcript/index.ts";
import {
  paneShowsResumeRejected,
  RunnerResumeRejectedError,
} from "../resume-rejection.ts";
import {
  RunnerStateContentionError,
  RunnerStateCorruptionError,
} from "../runner-state-failures.ts";
import type { TmuxClient } from "./client.ts";
import {
  classifyRunnerStartupExit,
  isRecoverableStartupSessionLoss,
  isRetryableFreshStartFault,
  isTmuxDuplicateSessionError,
  isTransientTmuxTargetError,
  mapTmuxSessionError,
  summarizeSnapshot,
} from "./errors.ts";
import { buildRunnerArgs, renderRunnerResumeCommand } from "./launch-command.ts";
import {
  acceptTmuxStartupContinuePromptIfPresent,
  TmuxBootstrapSessionLostError,
  tmuxPaneHasStartupContinuePrompt,
  waitForTmuxSessionBootstrap,
} from "./session-handshake.ts";
import type { TmuxSessionIdMechanics } from "./session-id-mechanics.ts";

const SESSION_READY_CAPTURE_RETRY_COUNT = 5;
const SESSION_READY_CAPTURE_RETRY_DELAY_MS = 100;

export class TmuxSessionStartup {
  constructor(
    private readonly loadedConfig: LoadedConfig,
    private readonly tmux: TmuxClient,
    private readonly resolveTarget: (target: AgentSessionTarget) => ResolvedAgentTarget,
    private readonly sessionMapping: SessionMapping,
    private readonly sessionIds: TmuxSessionIdMechanics,
  ) {}

  async ensureSessionReady(
    target: AgentSessionTarget,
    options: EnsureSessionReadyOptions = {},
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
    const preparedMapping = await this.sessionMapping.prepareStartup(resolved);
    const serverRunning = await this.tmux.isServerRunning();

    if (serverRunning && (await this.tmux.hasSession(resolved.sessionName))) {
      const lingeringExitSnapshot = await this.captureSessionSnapshot(resolved).catch(() => "");
      if (paneShowsRunnerExitSentinel(lingeringExitSnapshot)) {
        // A failed runner is lingering for post-mortem reads only; never
        // reuse it or submit into it. Clear it and start normally below.
        await this.tmux.killSession(resolved.sessionName).catch(() => undefined);
      } else {
        logLatencyDebug("ensure-session-ready-existing-session", timingContext, {
          hasStoredSessionId: Boolean(preparedMapping.storedSessionId),
        });
        try {
          await clearRunnerExitRecord(this.loadedConfig.stateDir, resolved.sessionName);
          await this.acceptStartupContinuePromptIfPresent(resolved);
          await this.sessionIds.syncActiveSessionMapping(resolved);
        } catch (error) {
          throw await this.mapSessionError(error, resolved.sessionName, "during startup");
        }
        logLatencyDebug("ensure-session-ready-complete", timingContext, {
          startupDelayMs: 0,
          reusedSession: true,
        });
        return resolved;
      }
    }

    if (!resolved.session.createIfMissing) {
      throw new Error(`tmux session "${resolved.sessionName}" does not exist`);
    }

    const storedOrExplicitSessionId = preparedMapping.sessionId ?? "";
    const resumingExistingSession = preparedMapping.resume;
    const runnerLaunch = buildRunnerArgs(resolved, {
      sessionId: storedOrExplicitSessionId || undefined,
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
        hasStoredSessionId: Boolean(preparedMapping.storedSessionId),
      });
      const bootstrapResult = await waitForTmuxSessionBootstrap({
        tmux: this.tmux,
        sessionName: resolved.sessionName,
        captureLines: resolved.stream.captureLines,
        startupDelayMs: resolved.runner.startupDelayMs,
        trustWorkspace: resolved.runner.trustWorkspace,
        readyPattern: resolved.runner.startupReadyPattern,
        blockers: resolved.runner.startupBlockers,
        resumeRejection:
          resumingExistingSession && storedOrExplicitSessionId
            ? { detect: paneShowsResumeRejected }
            : undefined,
        exitDetection: { detect: paneShowsRunnerExitSentinel },
      });
      if (bootstrapResult.status === "exited") {
        await this.tmux.killSession(resolved.sessionName).catch(() => undefined);
        throw classifyRunnerStartupExit(resolved.sessionName, bootstrapResult.snapshot);
      }
      if (bootstrapResult.status === "resume-rejected") {
        // Kill the dead resume pane so a later prompt can never be submitted
        // into the runner's session picker. Caught below: either falls back to
        // a fresh conversation with a user-visible note, or propagates
        // truthfully to recovery callers.
        await this.tmux.killSession(resolved.sessionName).catch(() => undefined);
        throw new RunnerResumeRejectedError(
          resolved.sessionName,
          storedOrExplicitSessionId,
          bootstrapResult.snapshot,
        );
      }
      if (bootstrapResult.status === "blocked") {
        await this.abortUnreadySession(
          resolved,
          bootstrapResult.message,
          bootstrapResult.snapshot,
        );
      }

      if (bootstrapResult.status === "timeout" && resolved.runner.startupReadyPattern) {
        const retried = await this.retryRunnerRestartPreservingSessionId(
          target,
          resolved,
          remainingFreshRetries,
          options.startupNotes,
        );
        if (retried) {
          return retried;
        }
        await this.abortUnreadySession(
          resolved,
          `Runner session "${resolved.sessionName}" did not reach the configured ready state within ${resolved.runner.startupDelayMs}ms, so your prompt was not submitted. Verify that \`${resolved.runner.command}\` starts cleanly in the workspace terminal, then resend. Inspect ${renderCliCommand("runner inspect --latest --lines 120", { inline: true })} and ${renderCliCommand("logs", { inline: true })} if it keeps happening.`,
          bootstrapResult.snapshot,
        );
      }

      await this.finalizeSessionStartup(resolved, {
        storedOrExplicitSessionId,
        runnerCommand: runnerLaunch.command,
      });
    } catch (error) {
      const retried = await this.retryAfterStartupFault(
        target,
        resolved,
        error,
        remainingFreshRetries,
        options.allowFreshRetry !== false,
        options.startupNotes,
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

  async ensureRunnerReady(
    target: AgentSessionTarget,
    options: {
      allowFreshRetryBeforePrompt?: boolean;
      timingContext?: LatencyDebugContext;
    } = {},
  ) {
    const startupNotes: string[] = [];
    let resolved = await this.ensureSessionReady(target, {
      allowFreshRetry: options.allowFreshRetryBeforePrompt,
      timingContext: options.timingContext,
      startupNotes,
    });

    try {
      return {
        resolved,
        initialSnapshot: await this.captureSessionSnapshot(resolved),
        startupNotes,
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
        startupNotes,
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
        startupNotes,
      };
    }
  }

  async killRunnerAndPreserveSessionId(resolved: ResolvedAgentTarget) {
    // The session may already be gone (runner exited, server lost); a missing
    // target must not abort the preserved-session-id retry itself.
    await this.tmux.killSession(resolved.sessionName).catch(() => undefined);
    await this.sessionMapping.touch(resolved, {
      runnerCommand: resolved.runner.command,
    });
  }

  async acceptStartupContinuePromptIfPresent(resolved: ResolvedAgentTarget) {
    await acceptTmuxStartupContinuePromptIfPresent({
      tmux: this.tmux,
      sessionName: resolved.sessionName,
      captureLines: resolved.stream.captureLines,
      startupDelayMs: resolved.runner.startupDelayMs,
      trustWorkspace: resolved.runner.trustWorkspace,
    });
  }

  async captureSessionSnapshot(resolved: ResolvedAgentTarget) {
    return normalizePaneText(
      await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
    );
  }

  mapSessionError(
    error: unknown,
    sessionName: string,
    action: "during startup" | "before prompt submission" | "while the prompt was running",
    lastSnapshot = "",
  ) {
    return mapTmuxSessionError({
      stateDir: this.loadedConfig.stateDir,
      error,
      sessionName,
      action,
      lastSnapshot,
    });
  }

  private async finalizeSessionStartup(
    resolved: ResolvedAgentTarget,
    params: {
      storedOrExplicitSessionId: string;
      runnerCommand: string;
    },
  ) {
    await this.acceptStartupContinuePromptIfPresent(resolved);
    await this.verifySessionReady(resolved);

    // Startup may already know the runner-side sessionId from one of two
    // sources: a previously storedSessionId used for continuity, or an explicit
    // sessionId created before launch. In that branch there is nothing to
    // capture from runner output, only to record through the session-owned
    // continuity mapping.
    if (params.storedOrExplicitSessionId) {
      await this.sessionIds.recordActiveSessionIdBestEffort(
        resolved,
        params.storedOrExplicitSessionId,
        params.runnerCommand,
      );
      return;
    }

    // Runner-created session ids do not exist in persistence until clisbot
    // captures them from live runner output and records them through the
    // session-owned continuity mapping.
    const entry = await this.sessionIds.syncActiveSessionMapping(resolved);
    if (entry?.sessionId) {
      return;
    }

    await this.sessionIds.retryMissingStoredSessionIdAfterStartup(resolved);
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
        if (
          tmuxPaneHasStartupContinuePrompt(snapshot, {
            trustWorkspace: resolved.runner.trustWorkspace,
          })
        ) {
          await this.acceptStartupContinuePromptIfPresent(resolved);
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

  private async abortUnreadySession(
    resolved: ResolvedAgentTarget,
    reason: string,
    snapshot: string,
  ) {
    await this.tmux.killSession(resolved.sessionName);
    throw new Error(`${reason}${summarizeSnapshot(snapshot)}`);
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

  private async retryRunnerRestartPreservingSessionId(
    target: AgentSessionTarget,
    resolved: ResolvedAgentTarget,
    remainingFreshRetries: number,
    startupNotes?: string[],
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
      startupNotes,
    });
  }

  private async retryAfterStateContention(
    target: AgentSessionTarget,
    resolved: ResolvedAgentTarget,
    remainingFreshRetries: number,
    startupNotes?: string[],
  ) {
    if (remainingFreshRetries <= 0) {
      return null;
    }

    const attempt = resolved.runner.startupRetryCount - remainingFreshRetries + 1;
    const backoffMs =
      resolved.runner.startupRetryDelayMs * attempt + Math.floor(Math.random() * 250);
    console.log(
      `clisbot runner state database contention for ${resolved.sessionName}; retrying startup with the preserved session id in ${backoffMs}ms`,
    );
    await this.killRunnerAndPreserveSessionId(resolved);
    if (backoffMs > 0) {
      await sleep(backoffMs);
    }
    return this.ensureSessionReady(target, {
      remainingFreshRetries: remainingFreshRetries - 1,
      startupNotes,
    });
  }

  private async retryAfterStartupFault(
    target: AgentSessionTarget,
    resolved: ResolvedAgentTarget,
    error: unknown,
    remainingFreshRetries: number,
    allowFreshResumeFallback: boolean,
    startupNotes?: string[],
  ) {
    if (error instanceof RunnerStateContentionError) {
      return this.retryAfterStateContention(
        target,
        resolved,
        remainingFreshRetries,
        startupNotes,
      );
    }
    if (error instanceof RunnerStateCorruptionError) {
      return null;
    }

    if (allowFreshResumeFallback) {
      const fallback = await this.fallBackToFreshAfterRejectedResume(
        target,
        resolved,
        error,
        remainingFreshRetries,
        startupNotes,
      );
      if (fallback) {
        return fallback;
      }
    }

    if (!isRetryableFreshStartFault(error)) {
      return null;
    }

    return this.retryRunnerRestartPreservingSessionId(
      target,
      resolved,
      remainingFreshRetries,
      startupNotes,
    );
  }

  // Decides whether a startup failure means the stored session id can no
  // longer be resumed. "rejected" is definitive runner output; "exit" means
  // the resume launch kept dying after the preserved-session-id retries.
  private async classifyRejectedResumeStartup(
    resolved: ResolvedAgentTarget,
    error: unknown,
    remainingFreshRetries: number,
  ): Promise<{ storedSessionId: string; reason: "rejected" | "exit" } | null> {
    const storedSessionId =
      (await this.sessionMapping.get(resolved.sessionKey))?.sessionId?.trim() || "";
    if (!storedSessionId) {
      return null;
    }

    if (error instanceof RunnerResumeRejectedError) {
      return { storedSessionId, reason: "rejected" };
    }
    if (
      error instanceof TmuxBootstrapSessionLostError &&
      paneShowsResumeRejected(error.lastSnapshot)
    ) {
      return { storedSessionId, reason: "rejected" };
    }

    if (!isRecoverableStartupSessionLoss(error)) {
      return null;
    }
    if (
      resolved.runner.sessionId.resume.mode !== "command" ||
      resolved.runner.sessionId.create.mode !== "runner"
    ) {
      return null;
    }
    if (remainingFreshRetries > 0) {
      // Let the preserved-session-id resume retries run first; fall back to a
      // fresh conversation only when resume keeps dying.
      return null;
    }

    const exitRecord = await readRunnerExitRecord(this.loadedConfig.stateDir, resolved.sessionName);
    if (!exitRecord || exitRecord.exitCode === 0) {
      return null;
    }
    return { storedSessionId, reason: "exit" };
  }

  private async fallBackToFreshAfterRejectedResume(
    target: AgentSessionTarget,
    resolved: ResolvedAgentTarget,
    error: unknown,
    remainingFreshRetries: number,
    startupNotes?: string[],
  ) {
    const rejection = await this.classifyRejectedResumeStartup(
      resolved,
      error,
      remainingFreshRetries,
    );
    if (!rejection) {
      return null;
    }

    console.log(
      `clisbot resume rejected for ${resolved.sessionName}; opening a fresh runner conversation`,
      {
        storedSessionId: rejection.storedSessionId,
        reason: rejection.reason,
      },
    );
    await this.tmux.killSession(resolved.sessionName).catch(() => undefined);
    await this.sessionMapping.clearActive(resolved, {
      runnerCommand: resolved.runner.command,
    });
    startupNotes?.push(
      buildResumeRejectedFreshStartNote({
        storedSessionId: rejection.storedSessionId,
        reason: rejection.reason,
        resumeCommand: renderRunnerResumeCommand(resolved, rejection.storedSessionId),
      }),
    );
    return this.ensureSessionReady(target, {
      remainingFreshRetries: resolved.runner.startupRetryCount,
      startupNotes,
    });
  }
}
