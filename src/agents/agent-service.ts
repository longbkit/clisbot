import {
  type FollowUpMode,
} from "./follow-up-policy.ts";
import type { IntervalLoopStatus, StoredLoop, StoredLoopSender } from "./loop-state.ts";
import {
  computeNextCalendarLoopRunAtMs,
  type LoopCalendarCadence,
} from "./loop-command.ts";
import {
  createStoredCalendarLoop,
  createStoredIntervalLoop,
} from "./loop-control-shared.ts";
import {
  type RunObserver,
  type RunUpdate,
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
  getAgentEntry,
  type LoadedConfig,
  resolveSessionStorePath,
} from "../config/load-config.ts";
import { buildAgentPromptText } from "../channels/agent-prompt.ts";
import {
  renderLoopStartNotification,
  type SurfaceNotificationsConfig,
} from "../channels/surface-notifications.ts";
import { buildSurfacePromptContextWithDirectory } from "../channels/surface-directory.ts";
import {
  buildConfiguredTargetFromIdentity,
  resolveConfiguredSurfaceModeTarget,
} from "../channels/mode-config-shared.ts";
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
  RunnerService,
  type ShellCommandResult,
} from "./runner-service.ts";
import {
  ActiveRunInProgressError,
  SessionService,
} from "./session-service.ts";
export { ActiveRunInProgressError };
import type { LatencyDebugContext } from "../control/latency-debug.ts";
import type { ChannelIdentity } from "../channels/channel-identity.ts";
import { resolveChannelIdentityBotId } from "../channels/channel-identity.ts";
import type { StoredLoopSurfaceBinding } from "./loop-state.ts";
import { applyTemplate } from "../shared/paths.ts";
import type { StoredRecentConversationMessage } from "../shared/recent-message-context.ts";
import {
  resolveSlackBotConfig,
  resolveSlackDirectMessageConfig,
  resolveTelegramBotConfig,
  resolveTelegramDirectMessageConfig,
} from "../config/channel-bots.ts";
import { resolveSharedGroupsWildcardRoute } from "../config/group-routes.ts";
import { resolveConfigTimezone } from "../config/timezone.ts";

type StreamUpdate = RunUpdate;

type StreamCallbacks = {
  onUpdate: (update: StreamUpdate) => Promise<void> | void;
};

type ManagedIntervalLoop = {
  target: AgentSessionTarget;
  loop: StoredLoop;
  timer?: ReturnType<typeof setTimeout>;
};

type LoopConfig = {
  maxRunsPerLoop: number;
  maxActiveLoops: number;
  legacyMaxTimes?: number;
};

type SurfaceNotificationRequest = {
  binding: StoredLoopSurfaceBinding;
  text: string;
};

type SurfaceNotificationHandler = (request: SurfaceNotificationRequest) => Promise<void>;

const LOOP_RECONCILE_INTERVAL_MS = 1_000;

export type SessionDiagnostics = {
  sessionId?: string;
  resumeCommand?: string;
};

function escapeRegExp(raw: string) {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function stripWorkspaceArgs(args: string[]) {
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "-C") {
      index += 1;
      continue;
    }
    filtered.push(current);
  }
  return filtered;
}

export class AgentService {
  private tmuxClient: TmuxClient;
  private readonly queue = new AgentJobQueue();
  private readonly sessionState: AgentSessionState;
  private runnerSessions: RunnerService;
  private activeRuns: SessionService;
  private stopping = false;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private loopReconcileTimer?: ReturnType<typeof setInterval>;
  private loopTimers = new Set<ReturnType<typeof setTimeout>>();
  private intervalLoops = new Map<string, ManagedIntervalLoop>();
  private surfaceNotificationHandlers = new Map<string, SurfaceNotificationHandler>();

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
  }

  private createSessionService() {
    return new SessionService(
      this.tmuxClient,
      this.sessionState,
      this.runnerSessions,
      (target) => this.resolveTarget(target),
    );
  }

  async start() {
    await this.activeRuns.recoverPersistedRuns();
    await this.reconcilePersistedIntervalLoops();
    this.loopReconcileTimer = setInterval(() => {
      void this.reconcilePersistedIntervalLoops().catch((error) => {
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
    if (this.loopReconcileTimer) {
      clearInterval(this.loopReconcileTimer);
      this.loopReconcileTimer = undefined;
    }
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
    await this.activeRuns.stop();
  }

  async cleanupStaleSessions() {
    await this.runnerSessions.runSessionCleanup();
  }

  registerSurfaceNotificationHandler(params: {
    platform: "slack" | "telegram";
    botId?: string;
    accountId?: string;
    handler: SurfaceNotificationHandler;
  }) {
    this.surfaceNotificationHandlers.set(
      this.getSurfaceNotificationHandlerKey(params.platform, params.botId ?? params.accountId),
      params.handler,
    );
  }

  unregisterSurfaceNotificationHandler(params: {
    platform: "slack" | "telegram";
    botId?: string;
    accountId?: string;
  }) {
    this.surfaceNotificationHandlers.delete(
      this.getSurfaceNotificationHandlerKey(params.platform, params.botId ?? params.accountId),
    );
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
      resumeCommand: this.buildResumeCommandPreview(resolved, sessionId),
    };
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
    return (await this.activeRuns.hasLiveActiveRun(target)) || this.queue.isBusy(target.sessionKey);
  }

  async isAwaitingFollowUpRouting(target: AgentSessionTarget) {
    if (this.queue.isBusy(target.sessionKey)) {
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

  async createIntervalLoop(params: {
    target: AgentSessionTarget;
    promptText: string;
    canonicalPromptText?: string;
    protectedControlMutationRule?: string;
    promptSummary: string;
    promptSource: "custom" | "LOOP.md";
    surfaceBinding?: StoredLoopSurfaceBinding;
    intervalMs: number;
    maxRuns: number;
    createdBy?: string;
    sender?: StoredLoopSender;
    force: boolean;
  }) {
    if (this.intervalLoops.size >= this.getLoopConfig().maxActiveLoops) {
      throw new Error(
        `Active loop count exceeds the configured max of \`${this.getLoopConfig().maxActiveLoops}\`. Cancel an existing loop first.`,
      );
    }

    const loop = createStoredIntervalLoop({
      promptText: params.promptText,
      canonicalPromptText: params.canonicalPromptText,
      protectedControlMutationRule: params.protectedControlMutationRule,
      promptSummary: params.promptSummary,
      promptSource: params.promptSource,
      surfaceBinding: params.surfaceBinding,
      intervalMs: params.intervalMs,
      maxRuns: params.maxRuns,
      createdBy: params.createdBy,
      sender: params.sender,
      force: params.force,
    });

    const resolved = this.resolveTarget(params.target);
    await this.sessionState.setIntervalLoop(resolved, loop);
    this.intervalLoops.set(loop.id, {
      target: params.target,
      loop,
    });
    await this.runIntervalLoopIteration(loop.id, {
      notifyStart: false,
    });
    return this.getIntervalLoop(loop.id);
  }

  async createCalendarLoop(params: {
    target: AgentSessionTarget;
    promptText: string;
    canonicalPromptText?: string;
    protectedControlMutationRule?: string;
    promptSummary: string;
    promptSource: "custom" | "LOOP.md";
    surfaceBinding?: StoredLoopSurfaceBinding;
    cadence: LoopCalendarCadence;
    dayOfWeek?: number;
    localTime: string;
    hour: number;
    minute: number;
    timezone: string;
    maxRuns: number;
    createdBy?: string;
    sender?: StoredLoopSender;
  }) {
    if (this.intervalLoops.size >= this.getLoopConfig().maxActiveLoops) {
      throw new Error(
        `Active loop count exceeds the configured max of \`${this.getLoopConfig().maxActiveLoops}\`. Cancel an existing loop first.`,
      );
    }

    const loop = createStoredCalendarLoop({
      promptText: params.promptText,
      canonicalPromptText: params.canonicalPromptText,
      protectedControlMutationRule: params.protectedControlMutationRule,
      promptSummary: params.promptSummary,
      promptSource: params.promptSource,
      surfaceBinding: params.surfaceBinding,
      cadence: params.cadence,
      dayOfWeek: params.dayOfWeek,
      localTime: params.localTime,
      hour: params.hour,
      minute: params.minute,
      timezone: params.timezone,
      maxRuns: params.maxRuns,
      createdBy: params.createdBy,
      sender: params.sender,
    });

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
    callbacks: StreamCallbacks & {
      observerId?: string;
      timingContext?: LatencyDebugContext;
      queueText?: string;
    },
  ) {
    return this.queue.enqueue(
      target.sessionKey,
      async () => {
        const promptText = typeof prompt === "function" ? prompt() : prompt;
        return this.activeRuns.executePrompt(target, promptText, {
          id: callbacks.observerId ?? `prompt:${target.sessionKey}`,
          mode: "live",
          timingContext: callbacks.timingContext,
          onUpdate: callbacks.onUpdate,
        });
      },
      {
        text: callbacks.queueText ?? (typeof prompt === "string" ? prompt : undefined),
        canStart: async () => !(await this.activeRuns.hasLiveActiveRun(target)),
      },
    );
  }

  getMaxMessageChars(agentId: string) {
    const defaults = this.loadedConfig.raw.agents.defaults.runner.defaults.stream;
    const override = getAgentEntry(this.loadedConfig, agentId)?.runner?.defaults?.stream;
    return {
      ...defaults,
      ...(override ?? {}),
    }.maxMessageChars;
  }

  private async reconcilePersistedIntervalLoops() {
    const persistedLoops = await this.sessionState.listIntervalLoops();
    const persistedIds = new Set<string>();
    for (const persisted of persistedLoops) {
      persistedIds.add(persisted.id);
      if (persisted.attemptedRuns >= persisted.maxRuns) {
        this.dropManagedIntervalLoop(persisted.id);
        continue;
      }
      if (this.intervalLoops.has(persisted.id)) {
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

    for (const loopId of this.intervalLoops.keys()) {
      if (persistedIds.has(loopId)) {
        continue;
      }
      this.dropManagedIntervalLoop(loopId);
    }
  }

  private buildResumeCommandPreview(
    resolved: ResolvedAgentTarget,
    sessionId?: string,
  ) {
    if (!sessionId || resolved.runner.sessionId.resume.mode !== "command") {
      return undefined;
    }

    const values = {
      agentId: resolved.agentId,
      workspace: resolved.workspacePath,
      sessionName: resolved.sessionName,
      sessionKey: resolved.sessionKey,
      sessionId,
    };
    const command = resolved.runner.sessionId.resume.command ?? resolved.runner.command;
    const args = stripWorkspaceArgs(
      resolved.runner.sessionId.resume.args.map((value) =>
        applyTemplate(value, values),
      ),
    );
    return buildCommandString(command, args);
  }

  private async isManagedLoopPersisted(managed: ManagedIntervalLoop) {
    const entry = await this.sessionState.getEntry(managed.target.sessionKey);
    return (entry?.loops ?? entry?.intervalLoops ?? []).some((loop) => loop.id === managed.loop.id);
  }

  private dropManagedIntervalLoop(loopId: string) {
    const managed = this.intervalLoops.get(loopId);
    if (!managed) {
      return;
    }

    if (managed.timer) {
      clearTimeout(managed.timer);
      this.loopTimers.delete(managed.timer);
    }
    this.intervalLoops.delete(loopId);
  }

  private async runIntervalLoopIteration(
    loopId: string,
    options: {
      notifyStart?: boolean;
    } = {},
  ) {
    const managed = this.intervalLoops.get(loopId);
    if (!managed) {
      return;
    }

    if (!(await this.isManagedLoopPersisted(managed))) {
      this.dropManagedIntervalLoop(loopId);
      return;
    }

    const attemptedRuns = managed.loop.attemptedRuns + 1;
    const now = Date.now();
    const nextRunAt = this.computeNextManagedLoopRunAtMs(managed.loop, now);
    const nextLoopState: StoredLoop = {
      ...managed.loop,
      attemptedRuns,
      updatedAt: now,
      nextRunAt,
    };

    if (await this.isSessionBusy(managed.target)) {
      nextLoopState.skippedRuns += 1;
      if (!(await this.updateManagedIntervalLoop(managed, nextLoopState))) {
        this.dropManagedIntervalLoop(loopId);
        return;
      }
      if (attemptedRuns >= managed.loop.maxRuns) {
        await this.cancelIntervalLoop(loopId);
        return;
      }
      this.scheduleIntervalLoopTimer(loopId, Math.max(0, nextLoopState.nextRunAt - now));
      return;
    }

    nextLoopState.executedRuns += 1;
    if (!(await this.updateManagedIntervalLoop(managed, nextLoopState))) {
      this.dropManagedIntervalLoop(loopId);
      return;
    }

    if (options.notifyStart !== false) {
      await this.notifyManagedLoopStart(managed.target, nextLoopState);
    }

    const promptText = await this.buildManagedLoopPrompt(
      managed.target.agentId,
      nextLoopState,
    );
    const { result } = this.enqueuePrompt(
      managed.target,
      promptText,
      {
        observerId: `loop:${loopId}:${attemptedRuns}`,
        onUpdate: async () => undefined,
      },
    );
    void result.catch((error) => {
      if (this.shouldSuppressLoopShutdownError(error)) {
        return;
      }
      console.error("loop execution failed", error);
    });

    if (attemptedRuns >= managed.loop.maxRuns) {
      await this.cancelIntervalLoop(loopId);
      return;
    }
    this.scheduleIntervalLoopTimer(loopId, Math.max(0, nextLoopState.nextRunAt - now));
  }

  private getSurfaceNotificationHandlerKey(
    platform: "slack" | "telegram",
    botId?: string,
  ) {
    return `${platform}:${botId?.trim() || "default"}`;
  }

  private async notifySurface(request: SurfaceNotificationRequest) {
    const handler = this.surfaceNotificationHandlers.get(
      this.getSurfaceNotificationHandlerKey(request.binding.platform, request.binding.botId),
    );
    if (!handler) {
      return;
    }
    await handler(request);
  }

  private resolveLoopSurfaceNotifications(identity: ChannelIdentity): SurfaceNotificationsConfig {
    if (identity.platform === "slack") {
      const channelConfig = resolveSlackBotConfig(
        this.loadedConfig.raw.bots.slack,
        resolveChannelIdentityBotId(identity),
      );
      let resolved: SurfaceNotificationsConfig = {
        queueStart: channelConfig.surfaceNotifications?.queueStart ?? "brief",
        loopStart: channelConfig.surfaceNotifications?.loopStart ?? "brief",
      };

      if (identity.conversationKind === "dm") {
        const directMessageConfig = resolveSlackDirectMessageConfig(
          channelConfig,
          identity.senderId,
        );
        return {
          ...resolved,
          ...(directMessageConfig?.surfaceNotifications ?? {}),
        };
      }

      const routeCollection = channelConfig.groups;
      const routeKey = identity.conversationKind === "group"
        ? identity.channelId ? `group:${identity.channelId}` : undefined
        : identity.channelId ? `channel:${identity.channelId}` : undefined;
      const wildcardRoute = resolveSharedGroupsWildcardRoute(routeCollection);
      const route = identity.channelId
        ? routeCollection[routeKey ?? ""] ?? wildcardRoute
        : undefined;
      return {
        ...resolved,
        ...(route?.surfaceNotifications ?? {}),
      };
    }

    const channelConfig = resolveTelegramBotConfig(
      this.loadedConfig.raw.bots.telegram,
      resolveChannelIdentityBotId(identity),
    );
    let resolved: SurfaceNotificationsConfig = {
      queueStart: channelConfig.surfaceNotifications?.queueStart ?? "brief",
      loopStart: channelConfig.surfaceNotifications?.loopStart ?? "brief",
    };

    if (identity.conversationKind === "dm") {
      const directMessageConfig = resolveTelegramDirectMessageConfig(
        channelConfig,
        identity.senderId,
      );
      return {
        ...resolved,
        ...(directMessageConfig?.surfaceNotifications ?? {}),
      };
    }

    const groupRoute = identity.chatId
      ? channelConfig.groups[identity.chatId] ??
        resolveSharedGroupsWildcardRoute(channelConfig.groups)
      : undefined;
    resolved = {
      ...resolved,
      ...(groupRoute?.surfaceNotifications ?? {}),
    };

    if (identity.conversationKind === "topic" && identity.topicId) {
      return {
        ...resolved,
        ...(groupRoute?.topics?.[identity.topicId]?.surfaceNotifications ?? {}),
      };
    }

    return resolved;
  }

  private async notifyManagedLoopStart(
    target: AgentSessionTarget,
    loop: StoredLoop,
  ) {
    if (!loop.surfaceBinding) {
      return;
    }

    const identity = this.buildLoopChannelIdentity(loop);
    const notifications = this.resolveLoopSurfaceNotifications(identity);
    const text =
      loop.kind === "calendar"
        ? renderLoopStartNotification({
            mode: notifications.loopStart,
            agentId: target.agentId,
            loopId: loop.id,
            promptSummary: loop.promptSummary,
            cadence: loop.cadence,
            dayOfWeek: loop.dayOfWeek,
            localTime: loop.localTime,
            timezone: loop.timezone,
            nextRunAt: loop.nextRunAt,
            remainingRuns: Math.max(0, loop.maxRuns - loop.attemptedRuns),
            maxRuns: loop.maxRuns,
            kind: "calendar",
          })
        : renderLoopStartNotification({
            mode: notifications.loopStart,
            agentId: target.agentId,
            loopId: loop.id,
            promptSummary: loop.promptSummary,
            intervalMs: loop.intervalMs,
            nextRunAt: loop.nextRunAt,
            remainingRuns: Math.max(0, loop.maxRuns - loop.attemptedRuns),
            maxRuns: loop.maxRuns,
          });
    if (!text) {
      return;
    }

    try {
      await this.notifySurface({
        binding: loop.surfaceBinding,
        text,
      });
    } catch (error) {
      console.error("loop start notification failed", error);
    }
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
      void this.runIntervalLoopIteration(loopId, {
        notifyStart: true,
      }).catch((error) => {
        if (this.shouldSuppressLoopShutdownError(error)) {
          return;
        }
        console.error("loop execution failed", error);
      });
    }, delayMs);
    managed.timer = timer;
    this.loopTimers.add(timer);
  }

  private async updateManagedIntervalLoop(
    managed: ManagedIntervalLoop,
    nextLoopState: StoredLoop,
  ) {
    const replaced = await this.sessionState.replaceIntervalLoopIfPresent(
      this.resolveTarget(managed.target),
      nextLoopState,
    );
    if (!replaced) {
      return false;
    }
    managed.loop = nextLoopState;
    return true;
  }

  private shouldSuppressLoopShutdownError(error: unknown) {
    if (!this.stopping) {
      return false;
    }

    const message = error instanceof Error ? error.message : String(error);
    return /Runtime stopped before the active run finished startup|Runtime is stopping and cannot accept a new prompt/i
      .test(message);
  }

  private computeNextManagedLoopRunAtMs(loop: StoredLoop, nowMs: number) {
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

  private async buildManagedLoopPrompt(agentId: string, loop: StoredLoop) {
    if (!loop.canonicalPromptText || !loop.surfaceBinding) {
      return loop.promptText;
    }

    const identity = this.buildLoopChannelIdentity(loop);
    const channelConfig =
      identity.platform === "slack"
        ? resolveSlackBotConfig(
            this.loadedConfig.raw.bots.slack,
            resolveChannelIdentityBotId(identity),
          )
        : resolveTelegramBotConfig(
            this.loadedConfig.raw.bots.telegram,
            resolveChannelIdentityBotId(identity),
          );
    const { responseMode, streaming } = this.resolveLoopSurfaceModes(identity);
    const promptTime = Date.now();
    const promptContext = await buildSurfacePromptContextWithDirectory({
      stateDir: this.loadedConfig.stateDir,
      identity,
      agentId,
      time: promptTime,
      scheduledLoopId: loop.id,
    });

    return buildAgentPromptText({
      text: loop.canonicalPromptText,
      identity,
      config: channelConfig.agentPrompt,
      cliTool: getAgentEntry(this.loadedConfig, agentId)?.cli,
      responseMode,
      streaming,
      protectedControlMutationRule: loop.protectedControlMutationRule,
      agentId,
      time: promptTime,
      promptContext,
      scheduledLoopId: loop.id,
    });
  }

  private buildLoopChannelIdentity(loop: StoredLoop): ChannelIdentity {
    const binding = loop.surfaceBinding!;
    const sender = loop.sender;
    return {
      platform: binding.platform,
      botId: binding.botId ?? binding.accountId,
      conversationKind: binding.conversationKind,
      senderId: sender?.providerId ?? loop.createdBy,
      senderName: sender?.displayName,
      senderHandle: sender?.handle,
      channelId: binding.channelId,
      channelName: binding.channelName,
      chatId: binding.chatId,
      chatName: binding.chatName,
      threadTs: binding.threadTs,
      topicId: binding.topicId,
      topicName: binding.topicName,
    };
  }

  private resolveLoopSurfaceModes(identity: ChannelIdentity) {
    let responseMode: "capture-pane" | "message-tool";
    let streaming: "off" | "latest" | "all";

    if (identity.platform === "slack") {
      const channelConfig = resolveSlackBotConfig(
        this.loadedConfig.raw.bots.slack,
        resolveChannelIdentityBotId(identity),
      );
      responseMode = channelConfig.responseMode;
      streaming = channelConfig.streaming;

      if (identity.conversationKind === "dm") {
        const directMessageConfig = resolveSlackDirectMessageConfig(
          channelConfig,
          identity.senderId,
        );
        responseMode = directMessageConfig?.responseMode ?? responseMode;
        streaming = directMessageConfig?.streaming ?? streaming;
      }
    } else {
      const channelConfig = resolveTelegramBotConfig(
        this.loadedConfig.raw.bots.telegram,
        resolveChannelIdentityBotId(identity),
      );
      responseMode = channelConfig.responseMode;
      streaming = channelConfig.streaming;

      if (identity.conversationKind === "dm") {
        const directMessageConfig = resolveTelegramDirectMessageConfig(
          channelConfig,
          identity.senderId,
        );
        responseMode = directMessageConfig?.responseMode ?? responseMode;
        streaming = directMessageConfig?.streaming ?? streaming;
      }
    }

    try {
      responseMode = resolveConfiguredSurfaceModeTarget(
        this.loadedConfig.raw,
        "responseMode",
        buildConfiguredTargetFromIdentity(identity),
      ).get() ?? responseMode;
    } catch {
      // Fall back to channel-level defaults if the original route no longer exists.
    }

    try {
      streaming = resolveConfiguredSurfaceModeTarget(
        this.loadedConfig.raw,
        "streaming",
        buildConfiguredTargetFromIdentity(identity),
      ).get() ?? streaming;
    } catch {
      // Fall back to channel-level defaults if the original route no longer exists.
    }

    return {
      responseMode,
      streaming,
    };
  }
}
