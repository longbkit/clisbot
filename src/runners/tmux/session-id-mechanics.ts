// Backend-specific sessionId mechanics for the tmux backend: capture a
// runner-created id from live pane output and record it through the
// session-owned continuity mapping. Continuity decisions (which id is active
// for a sessionKey) stay in the agents layer; this class only executes the
// tmux-side capture and best-effort recording.

import type { SessionMapping } from "../../agents/session/session-mapping.ts";
import type { ResolvedAgentTarget } from "../../agents/routing/resolved-target.ts";
import { sleep } from "../../infra/process.ts";
import type { TmuxClient } from "./client.ts";
import { captureTmuxSessionIdentity } from "./identity-capture.ts";
import {
  isFreshStartRetryablePromptDeliveryError,
  isRecoverableStartupSessionLoss,
  isTransientTmuxTargetError,
} from "./errors.ts";

const STARTUP_SESSION_ID_CAPTURE_RETRY_COUNT = 2;
const STARTUP_SESSION_ID_CAPTURE_RETRY_DELAY_MS = 500;
const SESSION_ID_CAPTURE_FAILURE_COOLDOWN_MS = 15_000;

export class TmuxSessionIdMechanics {
  private readonly captureRetryAt = new Map<string, number>();

  constructor(
    private readonly tmux: TmuxClient,
    private readonly sessionMapping: SessionMapping,
  ) {}

  async syncActiveSessionMapping(resolved: ResolvedAgentTarget) {
    const existing = await this.sessionMapping.get(resolved.sessionKey);
    if (existing?.sessionId) {
      await this.recordActiveSessionIdBestEffort(
        resolved,
        existing.sessionId,
        resolved.runner.command,
      );
      return existing;
    }

    const retryAt = this.captureRetryAt.get(resolved.sessionKey) ?? 0;
    if (retryAt > Date.now()) {
      return this.sessionMapping.touch(resolved, {
        runnerCommand: resolved.runner.command,
      });
    }

    let sessionId: string | null;
    try {
      sessionId = await this.captureSessionIdFromRunner(resolved);
    } catch (error) {
      if (isFreshStartRetryablePromptDeliveryError(error)) {
        this.captureRetryAt.set(
          resolved.sessionKey,
          Date.now() + SESSION_ID_CAPTURE_FAILURE_COOLDOWN_MS,
        );
      }
      throw error;
    }
    if (sessionId) {
      await this.recordActiveSessionIdBestEffort(
        resolved,
        sessionId,
        resolved.runner.command,
      );
      return {
        sessionId,
      };
    }

    this.deferSessionIdCapture(resolved.sessionKey);
    return this.sessionMapping.touch(resolved, {
      runnerCommand: resolved.runner.command,
    });
  }

  recordActiveSessionId(
    resolved: ResolvedAgentTarget,
    sessionId: string,
    runnerCommand = resolved.runner.command,
  ) {
    this.captureRetryAt.delete(resolved.sessionKey);
    return this.sessionMapping.setActive(resolved, {
      sessionId,
      runnerCommand,
    });
  }

  async recordActiveSessionIdBestEffort(
    resolved: ResolvedAgentTarget,
    sessionId: string,
    runnerCommand = resolved.runner.command,
  ) {
    try {
      await this.recordActiveSessionId(resolved, sessionId, runnerCommand);
      return true;
    } catch (error) {
      this.warnStartupSessionIdentityDegraded(resolved, error);
      return false;
    }
  }

  deferSessionIdCapture(sessionKey: string) {
    this.captureRetryAt.set(
      sessionKey,
      Date.now() + SESSION_ID_CAPTURE_FAILURE_COOLDOWN_MS,
    );
  }

  async captureSessionIdFromRunner(
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

  async retryMissingStoredSessionIdAfterStartup(resolved: ResolvedAgentTarget) {
    for (let attempt = 0; attempt < STARTUP_SESSION_ID_CAPTURE_RETRY_COUNT; attempt += 1) {
      await sleep(STARTUP_SESSION_ID_CAPTURE_RETRY_DELAY_MS);

      let sessionId: string | null = null;
      try {
        sessionId = await this.captureSessionIdFromRunner(resolved);
      } catch (error) {
        if (
          isRecoverableStartupSessionLoss(error) ||
          isTransientTmuxTargetError(error) ||
          isFreshStartRetryablePromptDeliveryError(error)
        ) {
          continue;
        }
        return;
      }

      if (!sessionId) {
        continue;
      }

      await this.recordActiveSessionIdBestEffort(resolved, sessionId);
      return;
    }
  }

  // Post-run capture point: the pane is idle after a run settles, so this is
  // the safest moment to retry a missed session id capture and make the
  // conversation resumable. Deliberately bypasses the in-run capture cooldown.
  async recaptureSessionIdAfterRun(resolved: ResolvedAgentTarget) {
    if (resolved.runner.sessionId.capture.mode !== "status-command") {
      return null;
    }
    const existing = await this.sessionMapping.get(resolved.sessionKey);
    if (existing?.sessionId) {
      return existing.sessionId;
    }
    if (!(await this.tmux.hasSession(resolved.sessionName))) {
      return null;
    }

    let sessionId: string | null = null;
    try {
      sessionId = await this.captureSessionIdFromRunner(resolved);
    } catch (error) {
      console.warn(
        `clisbot post-run session id recapture failed for ${resolved.sessionName}`,
        error,
      );
      this.deferSessionIdCapture(resolved.sessionKey);
      return null;
    }
    if (!sessionId) {
      this.deferSessionIdCapture(resolved.sessionKey);
      return null;
    }

    const recorded = await this.recordActiveSessionIdBestEffort(resolved, sessionId);
    if (!recorded) {
      return null;
    }
    console.log(
      `clisbot captured durable session id after run completion for ${resolved.sessionName}`,
    );
    return sessionId;
  }

  private warnStartupSessionIdentityDegraded(
    resolved: ResolvedAgentTarget,
    error: unknown,
  ) {
    console.warn(
      `clisbot could not persist or confirm a durable sessionId after startup for ${resolved.sessionName}; continuing without resumable state`,
      error,
    );
  }
}
