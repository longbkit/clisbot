import {
  type FollowUpMode,
} from "./follow-up-policy.ts";
import { randomUUID } from "node:crypto";
import type { IntervalLoopStatus, StoredIntervalLoop } from "./loop-state.ts";
import {
  computeNextCalendarLoopRunAtMs,
  type LoopCalendarCadence,
} from "./loop-command.ts";
import {
  type RunObserver,
  type RunUpdate,
} from "./run-observation.ts";
import { SessionStore } from "./session-store.ts";
import {
  AgentSessionState,
  type ActiveSessionRuntimeInfo,
  type ConversationReplyKind,
} from "./session-state.ts";
import type { SessionRuntimeInfo } from "./session-runtime.ts";
import {
  getAgentEntry,
  type LoadedConfig,
  resolveSessionStorePath,
} from "../config/load-config.ts";
import {
  resolveAgentTarget,
  type AgentSessionTarget,
  type ResolvedAgentTarget,
} from "./resolved-target.ts";
export type { AgentSessionTarget } from "./resolved-target.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import { AgentJobQueue } from "./job-queue.ts";
import type { PendingQueueItem } from "./job-queue.ts";
import {
  RunnerSessionService,
  type ShellCommandResult,
} from "./runner-session.ts";
import {
  ActiveRunInProgressError,
  ActiveRunManager,
} from "./active-run-manager.ts";
export { ActiveRunInProgressError };
import type { LatencyDebugContext } from "../control/latency-debug.ts";

type StreamUpdate = RunUpdate;

type StreamCallbacks = {
  onUpdate: (update: StreamUpdate) => Promise<void> | void;
};

type ManagedIntervalLoop = {
  target: AgentSessionTarget;
  loop: StoredIntervalLoop;
  timer?: ReturnType<typeof setTimeout>;
};

type LoopConfig = {
  maxRunsPerLoop: number;
  maxActiveLoops: number;
  defaultTimezone?: string;
  legacyMaxTimes?: number;
};

function escapeRegExp(raw: string) {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class AgentService {
  private tmuxClient: TmuxClient;
  private readonly queue = new AgentJobQueue();
  private readonly sessionState: AgentSessionState;
  private runnerSessions: RunnerSessionService;
  private activeRuns: ActiveRunManager;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private loopTimers = new Set<ReturnType<typeof setTimeout>>();
  private intervalLoops = new Map<string, ManagedIntervalLoop>();

  constructor(
    private readonly loadedConfig: LoadedConfig,
    deps: { tmux?: TmuxClient; sessionStore?: SessionStore } = {},
  ) {
    this.tmuxClient = deps.tmux ?? new TmuxClient(this.loadedConfig.raw.tmux.socketPath);
    const sessionStore = deps.sessionStore ?? new SessionStore(resolveSessionStorePath(this.loadedConfig));
    this.sessionState = new AgentSessionState(sessionStore);
    this.runnerSessions = new RunnerSessionService(
      this.loadedConfig,
      this.tmuxClient,
      this.sessionState,
      (target) => this.resolveTarget(target),
    );
    this.activeRuns = this.createActiveRunManager();
  }

  get tmux() {
    return this.tmuxClient;
  }

  set tmux(value: TmuxClient) {
    this.tmuxClient = value;
    this.runnerSessions = new RunnerSessionService(
      this.loadedConfig,
      this.tmuxClient,
      this.sessionState,
      (target) => this.resolveTarget(target),
    );
    this.activeRuns = this.createActiveRunManager();
  }

  private createActiveRunManager() {
    return new ActiveRunManager(
      this.tmuxClient,
      this.sessionState,
      this.runnerSessions,
      (target) => this.resolveTarget(target),
    );
  }

  async start() {
    await this.activeRuns.reconcileActiveRuns();
    await this.restoreIntervalLoops();
    const cleanup = this.loadedConfig.raw.control.sessionCleanup;
    if (!cleanup.enabled) {
      return;
    }

    await this.runnerSessions.runSessionCleanup();
    this.cleanupTimer = setInterval(() => {
      void this.runnerSessions.runSessionCleanup();
    }, cleanup.intervalMinutes * 60_000);
  }

  async stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    for (const managed of this.intervalLoops.values()) {
      if (managed.timer) {
        clearTimeout(managed.timer);
      }
    }
    this.intervalLoops.clear();
    for (const timer of this.loopTimers) {
      clearTimeout(timer);
    }
    this.loopTimers.clear();
  }

  async cleanupStaleSessions() {
    await this.runnerSessions.runSessionCleanup();
  }

  private resolveTarget(target: AgentSessionTarget): ResolvedAgentTarget {
    return resolveAgentTarget(this.loadedConfig, target);
  }

  async captureTranscript(target: AgentSessionTarget) {
    return this.runnerSessions.captureTranscript(target);
  }

  async interruptSession(target: AgentSessionTarget) {
    return this.runnerSessions.interruptSession(target);
  }

  async nudgeSession(target: AgentSessionTarget) {
    return this.runnerSessions.nudgeSession(target);
  }

  async getConversationFollowUpState(target: AgentSessionTarget) {
    return this.sessionState.getConversationFollowUpState(target);
  }

  async getSessionRuntime(target: AgentSessionTarget): Promise<SessionRuntimeInfo> {
    return this.sessionState.getSessionRuntime(target);
  }

  async listActiveSessionRuntimes(): Promise<ActiveSessionRuntimeInfo[]> {
    return this.sessionState.listActiveSessionRuntimes();
  }

  async setConversationFollowUpMode(target: AgentSessionTarget, mode: FollowUpMode) {
    return this.sessionState.setConversationFollowUpMode(this.resolveTarget(target), mode);
  }

  async resetConversationFollowUpMode(target: AgentSessionTarget) {
    return this.sessionState.resetConversationFollowUpMode(this.resolveTarget(target));
  }

  async reactivateConversationFollowUp(target: AgentSessionTarget) {
    return this.sessionState.reactivateConversationFollowUp(this.resolveTarget(target));
  }

  getResolvedAgentConfig(agentId: string) {
    return this.resolveTarget({
      agentId,
      sessionKey: this.loadedConfig.raw.session.mainKey,
    });
  }

  async recordConversationReply(
    target: AgentSessionTarget,
    kind: ConversationReplyKind = "reply",
  ) {
    return this.sessionState.recordConversationReply(this.resolveTarget(target), kind);
  }

  async runShellCommand(target: AgentSessionTarget, command: string): Promise<ShellCommandResult> {
    return this.queue.enqueue(`${target.sessionKey}:bash`, async () =>
      this.runnerSessions.runShellCommand(target, command),
    ).result;
  }

  hasActiveRun(target: AgentSessionTarget) {
    return this.activeRuns.hasActiveRun(target);
  }

  async submitSessionInput(target: AgentSessionTarget, text: string) {
    return this.runnerSessions.submitSessionInput(target, text);
  }

  isSessionBusy(target: AgentSessionTarget) {
    return this.activeRuns.hasActiveRun(target) || this.queue.isBusy(target.sessionKey);
  }

  async isAwaitingFollowUpRouting(target: AgentSessionTarget) {
    if (this.queue.isBusy(target.sessionKey)) {
      return true;
    }

    if (!this.activeRuns.hasActiveRun(target)) {
      return false;
    }

    const runtime = await this.sessionState.getSessionRuntime(target);
    if (
      typeof runtime.finalReplyAt === "number" &&
      typeof runtime.startedAt === "number" &&
      runtime.finalReplyAt >= runtime.startedAt
    ) {
      return false;
    }

    return true;
  }

  listQueuedPrompts(target: AgentSessionTarget): PendingQueueItem[] {
    return this.queue.listPending(target.sessionKey);
  }

  clearQueuedPrompts(target: AgentSessionTarget) {
    return this.queue.clearPending(target.sessionKey);
  }

  getLoopConfig() {
    const raw = this.loadedConfig.raw.control.loop as LoopConfig;
    return {
      maxRunsPerLoop: raw.maxRunsPerLoop ?? raw.legacyMaxTimes ?? 50,
      maxActiveLoops: raw.maxActiveLoops ?? 10,
      defaultTimezone: raw.defaultTimezone,
    };
  }

  async createIntervalLoop(params: {
    target: AgentSessionTarget;
    promptText: string;
    promptSummary: string;
    promptSource: "custom" | "LOOP.md";
    intervalMs: number;
    maxRuns: number;
    createdBy?: string;
    force: boolean;
  }) {
    if (this.intervalLoops.size >= this.getLoopConfig().maxActiveLoops) {
      throw new Error(
        `Active loop count exceeds the configured max of \`${this.getLoopConfig().maxActiveLoops}\`. Cancel an existing loop first.`,
      );
    }

    const id = randomUUID().split("-")[0] ?? randomUUID();
    const loop: StoredIntervalLoop = {
      id,
      intervalMs: params.intervalMs,
      maxRuns: params.maxRuns,
      attemptedRuns: 0,
      executedRuns: 0,
      skippedRuns: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nextRunAt: Date.now(),
      promptText: params.promptText,
      promptSummary: params.promptSummary,
      promptSource: params.promptSource,
      createdBy: params.createdBy,
      force: params.force,
    };

    const resolved = this.resolveTarget(params.target);
    await this.sessionState.setIntervalLoop(resolved, loop);
    this.intervalLoops.set(loop.id, {
      target: params.target,
      loop,
    });
    await this.runIntervalLoopIteration(loop.id);
    return this.getIntervalLoop(loop.id);
  }

  async createCalendarLoop(params: {
    target: AgentSessionTarget;
    promptText: string;
    promptSummary: string;
    promptSource: "custom" | "LOOP.md";
    cadence: LoopCalendarCadence;
    dayOfWeek?: number;
    localTime: string;
    hour: number;
    minute: number;
    timezone: string;
    maxRuns: number;
    createdBy?: string;
  }) {
    if (this.intervalLoops.size >= this.getLoopConfig().maxActiveLoops) {
      throw new Error(
        `Active loop count exceeds the configured max of \`${this.getLoopConfig().maxActiveLoops}\`. Cancel an existing loop first.`,
      );
    }

    const nextRunAt =
      computeNextCalendarLoopRunAtMs({
        cadence: params.cadence,
        dayOfWeek: params.dayOfWeek,
        hour: params.hour,
        minute: params.minute,
        timezone: params.timezone,
        nowMs: Date.now(),
      }) ?? 0;
    if (!nextRunAt) {
      throw new Error("Unable to compute the next wall-clock loop run.");
    }

    const id = randomUUID().split("-")[0] ?? randomUUID();
    const loop: StoredIntervalLoop = {
      kind: "calendar",
      id,
      maxRuns: params.maxRuns,
      attemptedRuns: 0,
      executedRuns: 0,
      skippedRuns: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nextRunAt,
      promptText: params.promptText,
      promptSummary: params.promptSummary,
      promptSource: params.promptSource,
      createdBy: params.createdBy,
      cadence: params.cadence,
      dayOfWeek: params.dayOfWeek,
      localTime: params.localTime,
      hour: params.hour,
      minute: params.minute,
      timezone: params.timezone,
      force: false,
    };

    const resolved = this.resolveTarget(params.target);
    await this.sessionState.setIntervalLoop(resolved, loop);
    this.intervalLoops.set(loop.id, {
      target: params.target,
      loop,
    });
    this.scheduleIntervalLoopTimer(loop.id, Math.max(0, loop.nextRunAt - Date.now()));
    return this.getIntervalLoop(loop.id);
  }

  async cancelIntervalLoop(loopId: string) {
    const managed = this.intervalLoops.get(loopId);
    if (!managed) {
      return false;
    }

    if (managed.timer) {
      clearTimeout(managed.timer);
      this.loopTimers.delete(managed.timer);
    }
    this.intervalLoops.delete(loopId);
    await this.sessionState.removeIntervalLoop(this.resolveTarget(managed.target), loopId);
    return true;
  }

  async cancelIntervalLoopsForSession(target: AgentSessionTarget) {
    const matching = [...this.intervalLoops.values()]
      .filter((managed) => managed.target.sessionKey === target.sessionKey)
      .map((managed) => managed.loop.id);
    for (const loopId of matching) {
      await this.cancelIntervalLoop(loopId);
    }
    return matching.length;
  }

  async cancelAllIntervalLoops() {
    const ids = [...this.intervalLoops.keys()];
    for (const loopId of ids) {
      await this.cancelIntervalLoop(loopId);
    }
    return ids.length;
  }

  listIntervalLoops(params?: {
    sessionKey?: string;
  }): IntervalLoopStatus[] {
    return [...this.intervalLoops.values()]
      .filter((managed) => !params?.sessionKey || managed.target.sessionKey === params.sessionKey)
      .map((managed) => ({
        ...managed.loop,
        agentId: managed.target.agentId,
        sessionKey: managed.target.sessionKey,
        remainingRuns: Math.max(0, managed.loop.maxRuns - managed.loop.attemptedRuns),
      }))
      .sort((left, right) => left.nextRunAt - right.nextRunAt);
  }

  getIntervalLoop(loopId: string): IntervalLoopStatus | null {
    const managed = this.intervalLoops.get(loopId);
    if (!managed) {
      return null;
    }

    return {
      ...managed.loop,
      agentId: managed.target.agentId,
      sessionKey: managed.target.sessionKey,
      remainingRuns: Math.max(0, managed.loop.maxRuns - managed.loop.attemptedRuns),
    };
  }

  getActiveIntervalLoopCount() {
    return this.intervalLoops.size;
  }

  getWorkspacePath(target: AgentSessionTarget) {
    return this.resolveTarget(target).workspacePath;
  }

  async observeRun(
    target: AgentSessionTarget,
    observer: Omit<RunObserver, "lastSentAt">,
  ) {
    return this.activeRuns.observeRun(target, observer);
  }

  async detachRunObserver(target: AgentSessionTarget, observerId: string) {
    return this.activeRuns.detachRunObserver(target, observerId);
  }

  enqueuePrompt(
    target: AgentSessionTarget,
    prompt: string,
    callbacks: StreamCallbacks & {
      observerId?: string;
      timingContext?: LatencyDebugContext;
    },
  ) {
    return this.queue.enqueue(
      target.sessionKey,
      async () =>
        this.activeRuns.executePrompt(target, prompt, {
        id: callbacks.observerId ?? `prompt:${target.sessionKey}`,
        mode: "live",
        timingContext: callbacks.timingContext,
        onUpdate: callbacks.onUpdate,
        }),
      {
        text: prompt,
      },
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

  private async restoreIntervalLoops() {
    const persistedLoops = await this.sessionState.listIntervalLoops();
    for (const persisted of persistedLoops) {
      if (persisted.attemptedRuns >= persisted.maxRuns) {
        continue;
      }
      const target = {
        agentId: persisted.agentId,
        sessionKey: persisted.sessionKey,
      };
      this.intervalLoops.set(persisted.id, {
        target,
        loop: persisted,
      });
      this.scheduleIntervalLoopTimer(
        persisted.id,
        Math.max(0, persisted.nextRunAt - Date.now()),
      );
    }
  }

  private async runIntervalLoopIteration(loopId: string) {
    const managed = this.intervalLoops.get(loopId);
    if (!managed) {
      return;
    }

    const attemptedRuns = managed.loop.attemptedRuns + 1;
    const now = Date.now();
    const nextRunAt = this.computeNextManagedLoopRunAtMs(managed.loop, now);
    const nextLoopState: StoredIntervalLoop = {
      ...managed.loop,
      attemptedRuns,
      updatedAt: now,
      nextRunAt,
    };

    if (this.isSessionBusy(managed.target)) {
      nextLoopState.skippedRuns += 1;
      await this.updateManagedIntervalLoop(managed, nextLoopState);
      if (attemptedRuns >= managed.loop.maxRuns) {
        await this.cancelIntervalLoop(loopId);
        return;
      }
      this.scheduleIntervalLoopTimer(loopId, Math.max(0, nextLoopState.nextRunAt - now));
      return;
    }

    nextLoopState.executedRuns += 1;
    await this.updateManagedIntervalLoop(managed, nextLoopState);

    const { result } = this.enqueuePrompt(
      managed.target,
      nextLoopState.promptText,
      {
        observerId: `loop:${loopId}:${attemptedRuns}`,
        onUpdate: async () => undefined,
      },
    );
    void result.catch((error) => {
      console.error("loop execution failed", error);
    });

    if (attemptedRuns >= managed.loop.maxRuns) {
      await this.cancelIntervalLoop(loopId);
      return;
    }
    this.scheduleIntervalLoopTimer(loopId, Math.max(0, nextLoopState.nextRunAt - now));
  }

  private scheduleIntervalLoopTimer(loopId: string, delayMs: number) {
    const managed = this.intervalLoops.get(loopId);
    if (!managed) {
      return;
    }

    if (managed.timer) {
      clearTimeout(managed.timer);
      this.loopTimers.delete(managed.timer);
    }

    const timer = setTimeout(() => {
      this.loopTimers.delete(timer);
      const current = this.intervalLoops.get(loopId);
      if (!current) {
        return;
      }
      current.timer = undefined;
      void this.runIntervalLoopIteration(loopId).catch((error) => {
        console.error("loop execution failed", error);
      });
    }, delayMs);
    managed.timer = timer;
    this.loopTimers.add(timer);
  }

  private async updateManagedIntervalLoop(
    managed: ManagedIntervalLoop,
    nextLoopState: StoredIntervalLoop,
  ) {
    managed.loop = nextLoopState;
    await this.sessionState.setIntervalLoop(this.resolveTarget(managed.target), nextLoopState);
  }

  private computeNextManagedLoopRunAtMs(loop: StoredIntervalLoop, nowMs: number) {
    if (loop.kind === "calendar") {
      return (
        computeNextCalendarLoopRunAtMs({
          cadence: loop.cadence,
          dayOfWeek: loop.dayOfWeek,
          hour: loop.hour,
          minute: loop.minute,
          timezone: loop.timezone,
          nowMs,
        }) ?? nowMs + 60_000
      );
    }
    return nowMs + loop.intervalMs;
  }
}
