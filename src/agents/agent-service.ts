import { dirname } from "node:path";
import {
  type FollowUpMode,
  type StoredFollowUpState,
} from "./follow-up-policy.ts";
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
import { deriveInteractionText, normalizePaneText } from "../shared/transcript.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import { AgentJobQueue } from "./job-queue.ts";

export type AgentSessionTarget = {
  agentId: string;
  sessionKey: string;
  mainSessionKey?: string;
  parentSessionKey?: string;
};

type StreamUpdate = {
  status: "running" | "completed" | "timeout";
  agentId: string;
  sessionKey: string;
  sessionName: string;
  workspacePath: string;
  snapshot: string;
  fullSnapshot: string;
  initialSnapshot: string;
};

type StreamCallbacks = {
  onUpdate: (update: StreamUpdate) => Promise<void> | void;
};

type AgentExecutionResult = {
  status: "completed" | "timeout";
  agentId: string;
  sessionKey: string;
  sessionName: string;
  workspacePath: string;
  snapshot: string;
  fullSnapshot: string;
  initialSnapshot: string;
};

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
const TMUX_MISSING_SESSION_PATTERN = /can't find session:/i;

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

export class AgentService {
  private readonly tmux: TmuxClient;
  private readonly queue = new AgentJobQueue();
  private readonly sessionStore: SessionStore;
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
    } | null) => {
      sessionId?: string;
      followUp?: StoredFollowUpState;
      runnerCommand?: string;
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
        updatedAt: Date.now(),
      };
    });
  }

  private async touchSessionEntry(
    resolved: ReturnType<AgentService["resolveTarget"]>,
    params: { sessionId?: string | null; runnerCommand?: string } = {},
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: params.sessionId?.trim() || existing?.sessionId,
      followUp: existing?.followUp,
      runnerCommand: params.runnerCommand ?? existing?.runnerCommand ?? resolved.runner.command,
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
    const startedAt = Date.now();

    await this.tmux.sendLiteral(resolved.sessionName, capture.statusCommand);
    await Bun.sleep(resolved.runner.promptSubmitDelayMs);
    await this.tmux.sendKey(resolved.sessionName, "Enter");

    while (Date.now() - startedAt < capture.timeoutMs) {
      await Bun.sleep(capture.pollIntervalMs);
      const snapshot = normalizePaneText(
        await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
      );
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

    if (await this.tmux.hasSession(resolved.sessionName)) {
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

    await this.tmux.newSession({
      sessionName: resolved.sessionName,
      cwd: resolved.workspacePath,
      command,
    });

    await Bun.sleep(resolved.runner.startupDelayMs);
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
      let snapshot = "";
      try {
        snapshot = normalizePaneText(
          await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
        );
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
      if (
        snapshot.includes("Do you trust the contents of this directory?") ||
        snapshot.includes("Press enter to continue")
      ) {
        await this.tmux.sendKey(resolved.sessionName, "Enter");
        await Bun.sleep(1500);
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
      await this.touchSessionEntry(resolved);
      try {
        await this.tmux.sendKey(resolved.sessionName, "Escape");
        await Bun.sleep(150);
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
    await Bun.sleep(BASH_WINDOW_STARTUP_DELAY_MS);

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
    await Bun.sleep(50);
    await this.tmux.sendKeyTarget(resolved.paneId, "Enter");
    await Bun.sleep(50);
    await this.tmux.sendLiteralTarget(
      resolved.paneId,
      `printf '\\n${sentinel}:%s\\n' "$?"`,
    );
    await Bun.sleep(50);
    await this.tmux.sendKeyTarget(resolved.paneId, "Enter");

    while (Date.now() - startedAt < maxRuntimeMs) {
      await Bun.sleep(250);
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

  private async executePrompt(
    target: AgentSessionTarget,
    prompt: string,
    callbacks: StreamCallbacks,
    options: { allowFreshRetryBeforePrompt?: boolean } = {},
  ): Promise<AgentExecutionResult> {
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
    let previousSnapshot = initialSnapshot;
    let lastChangeAt = Date.now();
    let sawChange = false;
    let lastVisibleSnapshot = "";
    const startedAt = Date.now();

    try {
      await this.tmux.sendLiteral(resolved.sessionName, prompt);
      await Bun.sleep(resolved.runner.promptSubmitDelayMs);
      await this.tmux.sendKey(resolved.sessionName, "Enter");
    } catch (error) {
      throw this.mapSessionError(error, resolved.sessionName, "before prompt submission");
    }

    while (true) {
      await Bun.sleep(resolved.stream.updateIntervalMs);
      let snapshot = "";
      try {
        snapshot = normalizePaneText(
          await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
        );
      } catch (error) {
        throw this.mapSessionError(error, resolved.sessionName, "while the prompt was running");
      }
      const now = Date.now();

      if (snapshot !== previousSnapshot) {
        lastChangeAt = now;
        previousSnapshot = snapshot;
        const interactionSnapshot = deriveInteractionText(initialSnapshot, snapshot);
        if (interactionSnapshot && interactionSnapshot !== lastVisibleSnapshot) {
          sawChange = true;
          lastVisibleSnapshot = interactionSnapshot;
          await callbacks.onUpdate({
            status: "running",
            agentId: resolved.agentId,
            sessionKey: resolved.sessionKey,
            sessionName: resolved.sessionName,
            workspacePath: resolved.workspacePath,
            snapshot: interactionSnapshot,
            fullSnapshot: snapshot,
            initialSnapshot,
          });
        }
      }

      if (sawChange && now - lastChangeAt >= resolved.stream.idleTimeoutMs) {
        const interactionSnapshot = deriveInteractionText(initialSnapshot, previousSnapshot);
        return {
          status: "completed",
          agentId: resolved.agentId,
          sessionKey: resolved.sessionKey,
          sessionName: resolved.sessionName,
          workspacePath: resolved.workspacePath,
          snapshot: interactionSnapshot,
          fullSnapshot: previousSnapshot,
          initialSnapshot,
        };
      }

      if (!sawChange && now - startedAt >= resolved.stream.noOutputTimeoutMs) {
        const interactionSnapshot = deriveInteractionText(initialSnapshot, previousSnapshot);
        return {
          status: "timeout",
          agentId: resolved.agentId,
          sessionKey: resolved.sessionKey,
          sessionName: resolved.sessionName,
          workspacePath: resolved.workspacePath,
          snapshot: interactionSnapshot,
          fullSnapshot: previousSnapshot,
          initialSnapshot,
        };
      }

      if (now - startedAt >= resolved.stream.maxRuntimeMs) {
        const interactionSnapshot = deriveInteractionText(initialSnapshot, previousSnapshot);
        return {
          status: "timeout",
          agentId: resolved.agentId,
          sessionKey: resolved.sessionKey,
          sessionName: resolved.sessionName,
          workspacePath: resolved.workspacePath,
          snapshot: interactionSnapshot,
          fullSnapshot: previousSnapshot,
          initialSnapshot,
        };
      }
    }
  }

  enqueuePrompt(target: AgentSessionTarget, prompt: string, callbacks: StreamCallbacks) {
    return this.queue.enqueue(target.sessionKey, async () =>
      this.executePrompt(target, prompt, callbacks),
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
