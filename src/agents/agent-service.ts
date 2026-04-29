import {
  type FollowUpMode,
} from "./follow-up-policy.ts";
import type { IntervalLoopStatus } from "./loop-state.ts";
import {
  type RunObserver,
} from "./run-observation.ts";
import { SessionStore } from "./session-store.ts";
import {
  AgentSessionState,
  type ConversationReplySource,
  type ActiveSessionRuntimeInfo,
  type ConversationReplyKind,
} from "./session-state.ts";
import type { SessionRuntimeInfo } from "./session-runtime.ts";
import {
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
import { buildResumeCommandPreview } from "./agent-resume-command.ts";
import {
  ManagedLoopController,
  type CreateCalendarLoopParams,
  type CreateIntervalLoopParams,
} from "./managed-loop-controller.ts";
import {
  ManagedQueueController,
  type PromptQueueResult,
  type QueuePromptCallbacks,
} from "./managed-queue-controller.ts";
import {
  RunnerService,
  type ShellCommandResult,
} from "./runner-service.ts";
import {
  ActiveRunInProgressError,
  SessionService,
} from "./session-service.ts";
export { ActiveRunInProgressError };
import {
  SurfaceRuntime,
  type SurfaceNotificationRegistration,
  type SurfaceNotificationTarget,
} from "./surface-runtime.ts";
import type { StoredRecentConversationMessage } from "../shared/recent-message-context.ts";
import { resolveConfigTimezone } from "../config/timezone.ts";

type LoopConfig = {
  maxRunsPerLoop: number;
  maxActiveLoops: number;
  legacyMaxTimes?: number;
};

type QueueConfig = {
  maxPendingItemsPerSession: number;
};

const LOOP_RECONCILE_INTERVAL_MS = 1_000;
const QUEUE_RECONCILE_INTERVAL_MS = 1_000;

export type SessionDiagnostics = {
  sessionId?: string;
  resumeCommand?: string;
};

export class AgentService {
  private tmuxClient: TmuxClient;
  private readonly queue = new AgentJobQueue();
  private readonly sessionState: AgentSessionState;
  private runnerSessions: RunnerService;
  private activeRuns: SessionService;
  private managedLoops: ManagedLoopController;
  private managedQueues: ManagedQueueController;
  private readonly surfaceRuntime: SurfaceRuntime;
  private stopping = false;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private loopReconcileTimer?: ReturnType<typeof setInterval>;
  private queueReconcileTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly loadedConfig: LoadedConfig,
    deps: { tmux?: TmuxClient; sessionStore?: SessionStore } = {},
  ) {
    this.tmuxClient = deps.tmux ?? new TmuxClient(this.loadedConfig.raw.tmux.socketPath);
    const sessionStore = deps.sessionStore ?? new SessionStore(resolveSessionStorePath(this.loadedConfig));
    this.sessionState = new AgentSessionState(sessionStore);
    this.runnerSessions = new RunnerService(
      this.loadedConfig,
      this.tmuxClient,
      this.sessionState,
      (target) => this.resolveTarget(target),
    );
    this.activeRuns = this.createSessionService();
    this.surfaceRuntime = new SurfaceRuntime(this.loadedConfig);
    this.managedQueues = this.createManagedQueueController();
    this.managedLoops = this.createManagedLoopController();
  }

  get tmux() {
    return this.tmuxClient;
  }

  set tmux(value: TmuxClient) {
    this.tmuxClient = value;
    this.runnerSessions = new RunnerService(
      this.loadedConfig,
      this.tmuxClient,
      this.sessionState,
      (target) => this.resolveTarget(target),
    );
    this.activeRuns = this.createSessionService();
    this.managedQueues = this.createManagedQueueController();
  }

  private createSessionService() {
    return new SessionService(
      this.tmuxClient,
      this.sessionState,
      this.runnerSessions,
      (target) => this.resolveTarget(target),
    );
  }

  private createManagedQueueController() {
    return new ManagedQueueController({
      queue: this.queue,
      sessionState: this.sessionState,
      activeRuns: this.activeRuns,
      surfaceRuntime: this.surfaceRuntime,
      getQueueConfig: () => this.getQueueConfig(),
      resolveTarget: (target) => this.resolveTarget(target),
      hasBlockingActiveRun: (target) => this.hasBlockingActiveRun(target),
      shouldSuppressShutdownError: (error) => this.shouldSuppressLoopShutdownError(error),
    });
  }

  private createManagedLoopController() {
    return new ManagedLoopController({
      sessionState: this.sessionState,
      surfaceRuntime: this.surfaceRuntime,
      getLoopConfig: () => this.getLoopConfig(),
      resolveTarget: (target) => this.resolveTarget(target),
      isSessionBusy: (target) => this.isSessionBusy(target),
      enqueuePrompt: (target, prompt, callbacks) =>
        this.enqueuePrompt(target, prompt, callbacks),
      shouldSuppressShutdownError: (error) => this.shouldSuppressLoopShutdownError(error),
    });
  }

  async start() {
    await this.activeRuns.recoverPersistedRuns();
    const activeSessions = new Set(
      (await this.sessionState.listActiveSessionRuntimes()).map((runtime) => runtime.sessionKey),
    );
    await this.sessionState.resetStaleRunningQueuedItems(activeSessions);
    await this.managedQueues.reconcilePersistedQueueItems();
    this.queueReconcileTimer = setInterval(() => {
      void this.managedQueues.reconcilePersistedQueueItems().catch((error) => {
        console.error("queue reconcile failed", error);
      });
    }, QUEUE_RECONCILE_INTERVAL_MS);
    await this.managedLoops.reconcilePersistedIntervalLoops();
    this.loopReconcileTimer = setInterval(() => {
      void this.managedLoops.reconcilePersistedIntervalLoops().catch((error) => {
        console.error("loop reconcile failed", error);
      });
    }, LOOP_RECONCILE_INTERVAL_MS);
    const cleanup = this.loadedConfig.raw.control.sessionCleanup;
    if (!cleanup.enabled) {
      return;
    }

    await this.runnerSessions.runSessionCleanup();
    this.cleanupTimer = setInterval(() => {
      void this.runnerSessions.runSessionCleanup().catch((error) => {
        console.error("session cleanup failed", error);
      });
    }, cleanup.intervalMinutes * 60_000);
  }

  async stop() {
    this.stopping = true;
    if (this.queueReconcileTimer) {
      clearInterval(this.queueReconcileTimer);
      this.queueReconcileTimer = undefined;
    }
    if (this.loopReconcileTimer) {
      clearInterval(this.loopReconcileTimer);
      this.loopReconcileTimer = undefined;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.managedLoops.clear();
    this.managedQueues.clear();
    await this.activeRuns.stop();
  }

  async cleanupStaleSessions() {
    await this.runnerSessions.runSessionCleanup();
  }

  registerSurfaceNotificationHandler(params: SurfaceNotificationRegistration) {
    this.surfaceRuntime.registerSurfaceNotificationHandler(params);
  }

  unregisterSurfaceNotificationHandler(params: SurfaceNotificationTarget) {
    this.surfaceRuntime.unregisterSurfaceNotificationHandler(params);
  }

  private resolveTarget(target: AgentSessionTarget): ResolvedAgentTarget {
    return resolveAgentTarget(this.loadedConfig, target);
  }

  async captureTranscript(target: AgentSessionTarget) {
    return this.runnerSessions.captureTranscript(target);
  }

  async interruptSession(target: AgentSessionTarget) {
    const runner = await this.runnerSessions.interruptSession(target);
    const activeRun = await this.activeRuns.interruptActiveRun(target);
    return {
      ...runner,
      interrupted: runner.interrupted || activeRun.interrupted,
    };
  }

  async nudgeSession(target: AgentSessionTarget) {
    return this.runnerSessions.nudgeSession(target);
  }

  async triggerNewSession(target: AgentSessionTarget) {
    return this.runnerSessions.triggerNewSession(target);
  }

  async getConversationFollowUpState(target: AgentSessionTarget) {
    return this.sessionState.getConversationFollowUpState(target);
  }

  async getSessionRuntime(target: AgentSessionTarget): Promise<SessionRuntimeInfo> {
    return this.sessionState.getSessionRuntime(target);
  }

  async getSessionDiagnostics(target: AgentSessionTarget): Promise<SessionDiagnostics> {
    const resolved = this.resolveTarget(target);
    const entry = await this.sessionState.getEntry(target.sessionKey);
    const sessionId = entry?.sessionId?.trim() || undefined;
    return {
      sessionId,
      resumeCommand: buildResumeCommandPreview(resolved, sessionId),
    };
  }

  async listActiveSessionRuntimes(): Promise<ActiveSessionRuntimeInfo[]> {
    await this.activeRuns.clearLostPersistedActiveRuns();
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
    source: ConversationReplySource = "channel",
  ) {
    return this.sessionState.recordConversationReply(this.resolveTarget(target), kind, source);
  }

  async appendRecentConversationMessage(
    target: AgentSessionTarget,
    message: StoredRecentConversationMessage,
  ) {
    return this.sessionState.appendRecentConversationMessage(this.resolveTarget(target), message);
  }

  async getRecentConversationReplayMessages(
    target: AgentSessionTarget,
    params: {
      excludeMarker?: string;
    } = {},
  ) {
    return this.sessionState.getRecentConversationReplayMessages(target, params);
  }

  async markRecentConversationProcessed(
    target: AgentSessionTarget,
    marker: string,
  ) {
    return this.sessionState.markRecentConversationProcessed(this.resolveTarget(target), marker);
  }

  async runShellCommand(target: AgentSessionTarget, command: string): Promise<ShellCommandResult> {
    return this.queue.enqueue(`${target.sessionKey}:bash`, async () =>
      this.runnerSessions.runShellCommand(target, command),
    ).result;
  }

  hasActiveRun(target: AgentSessionTarget) {
    return this.activeRuns.hasActiveRun(target);
  }

  canSteerActiveRun(target: AgentSessionTarget) {
    return this.activeRuns.canSteerActiveRun(target);
  }

  async submitSessionInput(target: AgentSessionTarget, text: string) {
    return this.activeRuns.submitSessionInput(target, text);
  }

  async isSessionBusy(target: AgentSessionTarget) {
    return (
      (await this.hasBlockingActiveRun(target)) ||
      this.queue.isBusy(target.sessionKey) ||
      (await this.sessionState.hasQueuedItemsForSession(target.sessionKey))
    );
  }

  private async hasBlockingActiveRun(target: AgentSessionTarget) {
    if (await this.activeRuns.hasLiveActiveRun(target)) {
      return true;
    }
    const runtime = await this.sessionState.getSessionRuntime(target);
    if (runtime.state === "idle") {
      return false;
    }
    return !(
      typeof runtime.finalReplyAt === "number" &&
      typeof runtime.startedAt === "number" &&
      runtime.finalReplyAt >= runtime.startedAt
    );
  }

  async isAwaitingFollowUpRouting(target: AgentSessionTarget) {
    if (
      this.queue.isBusy(target.sessionKey) ||
      (await this.sessionState.hasQueuedItemsForSession(target.sessionKey))
    ) {
      return true;
    }

    if (!(await this.activeRuns.hasLiveActiveRun(target))) {
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

  async listQueuedPrompts(target: AgentSessionTarget): Promise<PendingQueueItem[]> {
    return this.managedQueues.listQueuedPrompts(target);
  }

  async clearQueuedPrompts(target: AgentSessionTarget) {
    return this.managedQueues.clearQueuedPrompts(target);
  }

  getLoopConfig() {
    const raw = this.loadedConfig.raw.control.loop as LoopConfig;
    return {
      maxRunsPerLoop: raw.maxRunsPerLoop ?? raw.legacyMaxTimes ?? 50,
      maxActiveLoops: raw.maxActiveLoops ?? 10,
    };
  }

  getQueueConfig() {
    const raw = this.loadedConfig.raw.control.queue as QueueConfig | undefined;
    return {
      maxPendingItemsPerSession: raw?.maxPendingItemsPerSession ?? 20,
    };
  }

  resolveEffectiveTimezone(params: {
    agentId?: string;
    routeTimezone?: string;
    botTimezone?: string;
    loopTimezone?: string;
  } = {}) {
    return resolveConfigTimezone({
      config: this.loadedConfig.raw,
      agentId: params.agentId,
      routeTimezone: params.routeTimezone,
      botTimezone: params.botTimezone,
      loopTimezone: params.loopTimezone,
    });
  }

  async createIntervalLoop(params: CreateIntervalLoopParams) {
    return this.managedLoops.createIntervalLoop(params);
  }

  async createCalendarLoop(params: CreateCalendarLoopParams) {
    return this.managedLoops.createCalendarLoop(params);
  }

  async cancelIntervalLoop(loopId: string) {
    return this.managedLoops.cancelIntervalLoop(loopId);
  }

  async cancelIntervalLoopsForSession(target: AgentSessionTarget) {
    return this.managedLoops.cancelIntervalLoopsForSession(target);
  }

  async cancelAllIntervalLoops() {
    return this.managedLoops.cancelAllIntervalLoops();
  }

  listIntervalLoops(params?: {
    sessionKey?: string;
  }): IntervalLoopStatus[] {
    return this.managedLoops.listIntervalLoops(params);
  }

  getIntervalLoop(loopId: string): IntervalLoopStatus | null {
    return this.managedLoops.getIntervalLoop(loopId);
  }

  getActiveIntervalLoopCount() {
    return this.managedLoops.getActiveIntervalLoopCount();
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

  async observeActiveRun(
    target: AgentSessionTarget,
    observer: Omit<RunObserver, "lastSentAt">,
    options: { resumeLive?: boolean } = {},
  ) {
    return this.activeRuns.observeActiveRun(target, observer, options);
  }

  async detachRunObserver(target: AgentSessionTarget, observerId: string) {
    return this.activeRuns.detachRunObserver(target, observerId);
  }

  enqueuePrompt(
    target: AgentSessionTarget,
    prompt: string | (() => string),
    callbacks: QueuePromptCallbacks,
  ): PromptQueueResult {
    return this.managedQueues.enqueuePrompt(target, prompt, callbacks);
  }

  getMaxMessageChars(agentId: string) {
    return this.surfaceRuntime.getMaxMessageChars(agentId);
  }

  private shouldSuppressLoopShutdownError(error: unknown) {
    if (!this.stopping) {
      return false;
    }

    const message = error instanceof Error ? error.message : String(error);
    return /Runtime stopped before the active run finished startup|Runtime is stopping and cannot accept a new prompt/i
      .test(message);
  }
}
