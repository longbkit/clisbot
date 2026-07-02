// ACP implementation of the RunnerBackend contract. One adapter process per
// active session, structured session/update events instead of pane scraping,
// session/load resume, and first-class cancel. Capabilities that ACP cannot
// express (mid-turn steering, pane attach, shell panes, Enter-nudges) degrade
// with truthful guidance instead of pretending.

import type {
  AgentSessionTarget,
  ResolvedAgentTarget,
} from "../../agents/routing/resolved-target.ts";
import type { SessionMapping } from "../../agents/session/session-mapping.ts";
import type { LatencyDebugContext } from "../../control/runtime/latency-debug.ts";
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
import { AcpAdapterProcessError } from "./adapter-process.ts";
import { monitorAcpRun } from "./run-monitor.ts";
import { AcpSession } from "./session.ts";

export const ACP_RUNNER_CAPABILITIES: RunnerCapabilities = {
  steer: false,
  interrupt: true,
  resume: true,
  attachView: false,
  permissionRequests: true,
  structuredEvents: true,
  nativeSlashCommands: true,
  shellCommands: false,
  nudge: false,
};

export const ACP_STEER_UNSUPPORTED_MESSAGE =
  "This agent runs on the ACP backend, which cannot steer into a running turn. Use `/queue <message>` to run it after the current turn, or `/stop` and resend a combined prompt.";

const ACP_SHELL_UNSUPPORTED_MESSAGE =
  "This agent runs on the ACP backend, which has no shell pane. Run shell commands through a tmux-backed agent or directly in the workspace terminal.";

export class AcpRunnerBackend implements RunnerBackend {
  readonly id = "acp" as const;
  readonly capabilities = ACP_RUNNER_CAPABILITIES;

  private readonly sessions = new Map<string, AcpSession>();
  private readonly startupInFlight = new Map<string, Promise<AcpSession>>();
  private cleanupInFlight = false;

  constructor(
    private readonly resolveTarget: (target: AgentSessionTarget) => ResolvedAgentTarget,
    private readonly sessionMapping: SessionMapping,
  ) {}

  async ensureSessionReady(target: AgentSessionTarget, options: EnsureSessionReadyOptions = {}) {
    const resolved = this.resolveTarget(target);
    await this.ensureSession(resolved, options.startupNotes);
    return resolved;
  }

  async ensureRunnerReady(
    target: AgentSessionTarget,
    options: {
      allowFreshRetryBeforePrompt?: boolean;
      timingContext?: LatencyDebugContext;
    } = {},
  ): Promise<RunnerReadyResult> {
    void options;
    const resolved = this.resolveTarget(target);
    const startupNotes: string[] = [];
    const session = await this.ensureSession(resolved, startupNotes);
    return {
      resolved,
      initialSnapshot: session.transcript,
      startupNotes,
    };
  }

  async hasLiveSession(target: AgentSessionTarget) {
    const resolved = this.resolveTarget(target);
    return this.sessions.get(resolved.sessionKey)?.alive === true;
  }

  async shutdown() {
    // Adapter processes are children of this runtime; stored session ids keep
    // conversations resumable through session/load on the next start.
    this.stopAllSessions();
  }

  async runSessionCleanup() {
    if (this.cleanupInFlight) {
      return;
    }
    this.cleanupInFlight = true;
    try {
      const entries = await this.sessionMapping.listEntries();
      const now = Date.now();
      for (const entry of entries) {
        const session = this.sessions.get(entry.sessionKey);
        if (!session) {
          continue;
        }
        const resolved = this.resolveTarget({
          agentId: entry.agentId,
          sessionKey: entry.sessionKey,
        });
        if (resolved.runner.backend !== "acp") {
          continue;
        }
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
        if (session.hasActiveTurn) {
          continue;
        }
        this.dropSession(resolved.sessionKey);
        console.log(
          `clisbot sunset stale ACP session ${resolved.sessionName} after ${staleAfterMinutes}m idle`,
        );
      }
    } finally {
      this.cleanupInFlight = false;
    }
  }

  async submitSessionInput(target: AgentSessionTarget, text: string): Promise<SubmitInputResult> {
    void text;
    const resolved = this.resolveTarget(target);
    throw new Error(
      `Runner session "${resolved.sessionName}" cannot accept steering input. ${ACP_STEER_UNSUPPORTED_MESSAGE}`,
    );
  }

  async interruptSession(target: AgentSessionTarget): Promise<InterruptResult> {
    const resolved = this.resolveTarget(target);
    const session = this.sessions.get(resolved.sessionKey);
    if (!session?.alive) {
      return {
        ...this.describeTarget(resolved),
        interrupted: false,
      };
    }

    await this.sessionMapping.touch(resolved, {
      runtime: {
        state: "idle",
      },
    });
    await session.cancel().catch(() => undefined);
    return {
      ...this.describeTarget(resolved),
      interrupted: true,
    };
  }

  async nudgeSession(target: AgentSessionTarget): Promise<NudgeResult> {
    // ACP has no waiting-composer concept to nudge; report truthfully.
    const resolved = this.resolveTarget(target);
    return {
      ...this.describeTarget(resolved),
      nudged: false,
    };
  }

  async triggerNewSession(target: AgentSessionTarget): Promise<NewSessionResult> {
    const resolved = this.resolveTarget(target);
    const session = this.sessions.get(resolved.sessionKey);
    if (!session?.alive) {
      const restarted = await this.restartRunnerWithFreshSessionId(target);
      const entry = await this.sessionMapping.get(restarted.resolved.sessionKey);
      return {
        ...this.describeTarget(restarted.resolved),
        command: "(fresh runner)",
        sessionId: entry?.sessionId,
        restartedRunner: true,
      };
    }

    const sessionId = await session.rotateToNewSession();
    await this.sessionMapping.setActive(resolved, {
      sessionId,
      runnerCommand: resolved.runner.command,
      runtime: {
        state: "idle",
      },
    });
    return {
      ...this.describeTarget(resolved),
      command: "session/new",
      sessionId,
      restartedRunner: false,
    };
  }

  async runShellCommand(target: AgentSessionTarget, command: string): Promise<ShellCommandResult> {
    void command;
    const resolved = this.resolveTarget(target);
    throw new Error(
      `Runner session "${resolved.sessionName}" cannot run shell commands. ${ACP_SHELL_UNSUPPORTED_MESSAGE}`,
    );
  }

  async captureTranscript(target: AgentSessionTarget): Promise<TranscriptCapture> {
    const resolved = this.resolveTarget(target);
    const session = this.sessions.get(resolved.sessionKey);
    return {
      ...this.describeTarget(resolved),
      snapshot: session?.alive ? session.transcript : "",
    };
  }

  async monitorRun(params: RunMonitorParams) {
    const session = await this.ensureSession(params.resolved);
    await monitorAcpRun({ session, ...params });
  }

  async reopenRunContext(target: AgentSessionTarget, timingContext?: LatencyDebugContext) {
    const resolved = this.resolveTarget(target);
    const storedSessionId = (await this.sessionMapping.get(resolved.sessionKey))?.sessionId;
    if (!storedSessionId) {
      throw new Error(
        `Runner session "${resolved.sessionName}" cannot reopen the same conversation context.`,
      );
    }
    return this.restartRunnerPreservingSessionId(target, timingContext);
  }

  async restartRunnerPreservingSessionId(
    target: AgentSessionTarget,
    timingContext?: LatencyDebugContext,
  ) {
    void timingContext;
    const resolved = this.resolveTarget(target);
    this.dropSession(resolved.sessionKey);
    await this.sessionMapping.touch(resolved, {
      runnerCommand: resolved.runner.command,
    });
    return this.ensureRunnerReady(target);
  }

  async restartRunnerWithFreshSessionId(
    target: AgentSessionTarget,
    timingContext?: LatencyDebugContext,
  ) {
    void timingContext;
    const resolved = this.resolveTarget(target);
    this.dropSession(resolved.sessionKey);
    console.log(
      `clisbot clearing stored sessionId for explicit fresh ACP session ${resolved.sessionName}`,
    );
    await this.sessionMapping.clearActive(resolved, {
      runnerCommand: resolved.runner.command,
    });
    return this.ensureRunnerReady(target);
  }

  async recaptureSessionIdAfterRun(target: AgentSessionTarget) {
    // ACP session ids are known at session creation and already recorded; the
    // post-run recapture used by scrape-based backends has nothing to do.
    const resolved = this.resolveTarget(target);
    return this.sessions.get(resolved.sessionKey)?.sessionId ?? null;
  }

  isSessionLoss(error: unknown) {
    return error instanceof AcpAdapterProcessError;
  }

  canRecoverMidRun(error: unknown) {
    return error instanceof AcpAdapterProcessError;
  }

  canRetryPromptAfterFreshStart(error: unknown) {
    void error;
    // ACP prompt delivery is a JSON-RPC request: it either reaches the agent
    // or fails as an adapter loss; there is no unconfirmed-paste class.
    return false;
  }

  async mapRunError(error: unknown, sessionName: string, lastSnapshot = "") {
    void lastSnapshot;
    if (error instanceof AcpAdapterProcessError) {
      const evidence = error.stderrTail ? ` Adapter stderr: ${error.stderrTail.slice(-400)}` : "";
      return new Error(
        `Runner session "${sessionName}" lost its ACP adapter process. Your run could not continue; resend the message to retry. If this keeps happening, verify the adapter command starts cleanly in the workspace and inspect clisbot logs.${evidence}`,
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  /** Stops every live adapter process (runtime shutdown path). */
  stopAllSessions() {
    for (const sessionKey of [...this.sessions.keys()]) {
      this.dropSession(sessionKey);
    }
  }

  private describeTarget(resolved: ResolvedAgentTarget) {
    return {
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
      sessionName: resolved.sessionName,
      workspacePath: resolved.workspacePath,
    };
  }

  private dropSession(sessionKey: string) {
    const session = this.sessions.get(sessionKey);
    this.sessions.delete(sessionKey);
    session?.stop();
  }

  // Single-flight per sessionKey so concurrent chat ingress cannot spawn two
  // adapter processes for the same session.
  private async ensureSession(
    resolved: ResolvedAgentTarget,
    startupNotes?: string[],
  ): Promise<AcpSession> {
    const existing = this.sessions.get(resolved.sessionKey);
    if (existing?.alive) {
      return existing;
    }

    const inFlight = this.startupInFlight.get(resolved.sessionKey);
    if (inFlight) {
      return inFlight;
    }

    const startup = this.startSession(resolved, startupNotes).finally(() => {
      this.startupInFlight.delete(resolved.sessionKey);
    });
    this.startupInFlight.set(resolved.sessionKey, startup);
    return startup;
  }

  private async startSession(
    resolved: ResolvedAgentTarget,
    startupNotes?: string[],
  ): Promise<AcpSession> {
    this.dropSession(resolved.sessionKey);
    const session = new AcpSession({
      sessionName: resolved.sessionName,
      workspacePath: resolved.workspacePath,
      command: resolved.runner.command,
      args: resolved.runner.args,
      env: resolved.runner.env,
      permissionPolicy: resolved.runner.acp.permissionPolicy,
    });

    try {
      await session.initialize();
      const authMethodId = resolved.runner.acp.authMethodId;
      if (authMethodId) {
        await session.authenticate(authMethodId);
      }
      const prepared = await this.sessionMapping.prepareStartup(resolved);
      const sessionId = await this.openAcpSession(session, resolved, prepared, startupNotes);
      await this.sessionMapping.setActive(resolved, {
        sessionId,
        runnerCommand: resolved.runner.command,
      });
    } catch (error) {
      const adapterDied = !session.alive;
      session.stop();
      if (error instanceof AcpAdapterProcessError) {
        throw error;
      }
      if (adapterDied) {
        throw session.buildAdapterLostError(
          `exited during startup: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      throw error;
    }

    this.sessions.set(resolved.sessionKey, session);
    return session;
  }

  private async openAcpSession(
    session: AcpSession,
    resolved: ResolvedAgentTarget,
    prepared: { storedSessionId?: string; resume: boolean },
    startupNotes?: string[],
  ) {
    const storedSessionId = prepared.storedSessionId;
    if (storedSessionId && prepared.resume && session.supportsLoadSession) {
      try {
        return await session.loadSession(storedSessionId);
      } catch (error) {
        // Resume rejection is not fatal: fall back to a fresh conversation
        // with a truthful note, matching the tmux resume-rejected behavior.
        await this.sessionMapping.clearActive(resolved, {
          runnerCommand: resolved.runner.command,
        });
        startupNotes?.push(
          `Stored session ${storedSessionId} could not be resumed over ACP (${error instanceof Error ? error.message : String(error)}). Started a fresh conversation instead.`,
        );
        return session.newSession();
      }
    }
    if (storedSessionId && prepared.resume && !session.supportsLoadSession) {
      startupNotes?.push(
        "This ACP agent does not support session/load, so the stored conversation could not be resumed. Started a fresh conversation instead.",
      );
    }
    return session.newSession();
  }
}
