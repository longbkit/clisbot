import type { FollowUpMode, StoredFollowUpState } from "../commands/follow-up-policy.ts";
import type { IntervalLoopStatus, StoredLoop } from "../loops/loop-state.ts";
import type { QueuedPromptStatus, StoredQueueItem, StoredQueueStatus } from "../queue/queue-state.ts";
import type { ResolvedAgentTarget } from "../routing/resolved-target.ts";
import type { StoredSessionRuntime } from "./run-observation.ts";
import type { SessionRuntimeInfo } from "./session-runtime.ts";
import {
  appendRecentConversationMessage,
  collectRecentConversationReplayMessages,
  markRecentConversationProcessed,
  type StoredRecentConversationMessage,
  type StoredRecentConversationState,
} from "../routing/recent-message-context.ts";
import { SessionStore } from "./session-store.ts";

export type LiveSessionRuntimeInfo = SessionRuntimeInfo & {
  state: "running" | "detached";
};

export type ConversationReplyKind = "reply" | "progress" | "final";
export type ConversationReplySource = "channel" | "message-tool";

type SessionEntryUpdate = (existing: {
  sessionId?: string;
  lastAdmittedPromptAt?: number;
  followUp?: StoredFollowUpState;
  runnerCommand?: string;
  runtime?: StoredSessionRuntime;
  loops?: StoredLoop[];
  intervalLoops?: StoredLoop[];
  queues?: StoredQueueItem[];
  recentConversation?: StoredRecentConversationState;
} | null) => {
  sessionId?: string;
  lastAdmittedPromptAt?: number;
  followUp?: StoredFollowUpState;
  runnerCommand?: string;
  runtime?: StoredSessionRuntime;
  loops?: StoredLoop[];
  queues?: StoredQueueItem[];
  recentConversation?: StoredRecentConversationState;
};

function preserveReplyMarkers(
  existing: StoredSessionRuntime | undefined,
  next: StoredSessionRuntime,
): StoredSessionRuntime {
  return {
    ...next,
    finalReplyAt: next.finalReplyAt ?? existing?.finalReplyAt,
    lastMessageToolReplyAt: next.lastMessageToolReplyAt ?? existing?.lastMessageToolReplyAt,
    messageToolFinalReplyAt: next.messageToolFinalReplyAt ?? existing?.messageToolFinalReplyAt,
  };
}

export class AgentSessionState {
  constructor(private readonly sessionStore: SessionStore) {}

  async getEntry(sessionKey: string) {
    return this.sessionStore.get(sessionKey);
  }

  async listEntries() {
    return this.sessionStore.list();
  }

  async touchSessionEntry(
    resolved: ResolvedAgentTarget,
    params: {
      sessionId?: string | null;
      runnerCommand?: string;
      runtime?: StoredSessionRuntime;
    } = {},
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: params.sessionId?.trim() || existing?.sessionId,
      lastAdmittedPromptAt: existing?.lastAdmittedPromptAt,
      followUp: existing?.followUp,
      runnerCommand: params.runnerCommand ?? existing?.runnerCommand ?? resolved.runner.command,
      runtime: params.runtime ?? existing?.runtime,
      loops: getStoredLoops(existing),
      recentConversation: existing?.recentConversation,
    }));
  }

  async clearSessionIdEntry(
    resolved: ResolvedAgentTarget,
    params: {
      runnerCommand?: string;
      preserveRuntime?: boolean;
    } = {},
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: undefined,
      lastAdmittedPromptAt: existing?.lastAdmittedPromptAt,
      followUp: existing?.followUp,
      runnerCommand: params.runnerCommand ?? existing?.runnerCommand ?? resolved.runner.command,
      runtime: params.preserveRuntime ? existing?.runtime : { state: "idle" },
      loops: getStoredLoops(existing),
      recentConversation: existing?.recentConversation,
    }));
  }

  async setSessionRuntime(
    resolved: ResolvedAgentTarget,
    runtime: StoredSessionRuntime,
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      lastAdmittedPromptAt: existing?.lastAdmittedPromptAt,
      followUp: existing?.followUp,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime: preserveReplyMarkers(existing?.runtime, runtime),
      loops: getStoredLoops(existing),
      recentConversation: existing?.recentConversation,
    }));
  }

  async markPromptAdmitted(
    resolved: ResolvedAgentTarget,
    admittedAt = Date.now(),
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      lastAdmittedPromptAt: admittedAt,
      followUp: existing?.followUp,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime: existing?.runtime,
      loops: getStoredLoops(existing),
      recentConversation: existing?.recentConversation,
    }));
  }

  async getConversationFollowUpState(target: { sessionKey: string }): Promise<StoredFollowUpState> {
    const entry = await this.sessionStore.get(target.sessionKey);
    return entry?.followUp ?? {};
  }

  async getSessionRuntime(target: {
    sessionKey: string;
    agentId: string;
  }): Promise<SessionRuntimeInfo> {
    const entry = await this.sessionStore.get(target.sessionKey);
    return {
      state: entry?.runtime?.state ?? "idle",
      startedAt: entry?.runtime?.startedAt,
      detachedAt: entry?.runtime?.detachedAt,
      finalReplyAt: entry?.runtime?.finalReplyAt,
      lastMessageToolReplyAt: entry?.runtime?.lastMessageToolReplyAt,
      messageToolFinalReplyAt: entry?.runtime?.messageToolFinalReplyAt,
      sessionKey: target.sessionKey,
      agentId: target.agentId,
    };
  }

  async listIntervalLoops(params?: {
    sessionKey?: string;
  }): Promise<IntervalLoopStatus[]> {
    const entries = await this.sessionStore.list();
    return entries.flatMap((entry) =>
      getStoredLoops(entry)
        .filter((loop) => !params?.sessionKey || entry.sessionKey === params.sessionKey)
        .map((loop) => ({
          ...loop,
          agentId: entry.agentId,
          sessionKey: entry.sessionKey,
          remainingRuns: Math.max(0, loop.maxRuns - loop.attemptedRuns),
        })),
    ).sort((left, right) => left.nextRunAt - right.nextRunAt);
  }

  async setIntervalLoop(
    resolved: ResolvedAgentTarget,
    loop: StoredLoop,
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      followUp: existing?.followUp,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime: existing?.runtime,
      loops: [...getStoredLoops(existing).filter((item) => item.id !== loop.id), loop],
      recentConversation: existing?.recentConversation,
    }));
  }

  async replaceIntervalLoopIfPresent(
    resolved: ResolvedAgentTarget,
    loop: StoredLoop,
  ) {
    let replaced = false;
    await this.sessionStore.update(resolved.sessionKey, (existing) => {
      const currentLoops = getStoredLoops(existing);
      if (!currentLoops.some((item) => item.id === loop.id)) {
        return existing;
      }

      replaced = true;
      return {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
        sessionId: existing?.sessionId,
        workspacePath: resolved.workspacePath,
        runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
        lastAdmittedPromptAt: existing?.lastAdmittedPromptAt,
        followUp: existing?.followUp,
        runtime: existing?.runtime,
        loops: currentLoops.map((item) => (item.id === loop.id ? loop : item)),
        queues: getStoredQueues(existing),
        recentConversation: existing?.recentConversation,
        updatedAt: Date.now(),
      };
    });
    return replaced;
  }

  async removeIntervalLoop(
    resolved: ResolvedAgentTarget,
    loopId: string,
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      followUp: existing?.followUp,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime: existing?.runtime,
      loops: getStoredLoops(existing).filter((item) => item.id !== loopId),
      recentConversation: existing?.recentConversation,
    }));
  }

  async clearIntervalLoops(resolved: ResolvedAgentTarget) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      followUp: existing?.followUp,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime: existing?.runtime,
      loops: [],
      recentConversation: existing?.recentConversation,
    }));
  }

  async removeIntervalLoopById(loopId: string) {
    const entries = await this.sessionStore.list();
    for (const entry of entries) {
      if (!getStoredLoops(entry).some((loop) => loop.id === loopId)) {
        continue;
      }

      await this.sessionStore.update(entry.sessionKey, (existing) => {
        if (!existing) {
          return existing;
        }
        const { intervalLoops: _legacyLoops, ...rest } = existing;

        return {
          ...rest,
          lastAdmittedPromptAt: rest.lastAdmittedPromptAt,
          loops: getStoredLoops(existing).filter((loop) => loop.id !== loopId),
          updatedAt: Date.now(),
        };
      });
      return true;
    }

    return false;
  }

  async clearAllIntervalLoops() {
    const entries = await this.sessionStore.list();
    let cleared = 0;

    for (const entry of entries) {
      const loopCount = getStoredLoops(entry).length;
      if (loopCount === 0) {
        continue;
      }

      cleared += loopCount;
      await this.sessionStore.update(entry.sessionKey, (existing) => {
        if (!existing) {
          return existing;
        }
        const { intervalLoops: _legacyLoops, ...rest } = existing;

        return {
          ...rest,
          lastAdmittedPromptAt: rest.lastAdmittedPromptAt,
          loops: [],
          updatedAt: Date.now(),
        };
      });
    }

    return cleared;
  }

  async setConversationFollowUpMode(
    resolved: ResolvedAgentTarget,
    mode: FollowUpMode,
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      lastAdmittedPromptAt: existing?.lastAdmittedPromptAt,
      followUp: {
        ...existing?.followUp,
        overrideMode: mode,
      },
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      loops: getStoredLoops(existing),
      recentConversation: existing?.recentConversation,
    }));
  }

  async resetConversationFollowUpMode(resolved: ResolvedAgentTarget) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      lastAdmittedPromptAt: existing?.lastAdmittedPromptAt,
      followUp: existing?.followUp
        ? {
            ...existing.followUp,
            overrideMode: undefined,
          }
        : undefined,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      loops: getStoredLoops(existing),
      recentConversation: existing?.recentConversation,
    }));
  }

  async reactivateConversationFollowUp(resolved: ResolvedAgentTarget) {
    const existing = await this.sessionStore.get(resolved.sessionKey);
    if (existing?.followUp?.overrideMode !== "paused") {
      return existing;
    }
    return this.resetConversationFollowUpMode(resolved);
  }

  async recordConversationReply(
    resolved: ResolvedAgentTarget,
    kind: ConversationReplyKind = "reply",
    source: ConversationReplySource = "channel",
  ) {
    const repliedAt = Date.now();
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      lastAdmittedPromptAt: existing?.lastAdmittedPromptAt,
      followUp: {
        ...existing?.followUp,
        lastBotReplyAt: repliedAt,
      },
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime:
        existing?.runtime
          ? {
              ...existing.runtime,
              ...(kind === "final"
                ? {
                    finalReplyAt: repliedAt,
                  }
                : {}),
              ...(source === "message-tool"
                ? {
                    lastMessageToolReplyAt: repliedAt,
                    ...(kind === "final"
                      ? {
                          messageToolFinalReplyAt: repliedAt,
                        }
                      : {}),
                  }
                : {}),
            }
          : existing?.runtime,
      loops: getStoredLoops(existing),
      recentConversation: existing?.recentConversation,
    }));
  }

  async listQueuedItems(params?: {
    sessionKey?: string;
    statuses?: StoredQueueStatus[];
  }): Promise<QueuedPromptStatus[]> {
    const statuses = params?.statuses ? new Set(params.statuses) : undefined;
    const entries = await this.sessionStore.list();
    return entries.flatMap((entry) =>
      getStoredQueues(entry)
        .filter((item) => !params?.sessionKey || entry.sessionKey === params.sessionKey)
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !statuses || statuses.has(item.status))
        .map(({ item, index }) => ({
          ...item,
          agentId: entry.agentId,
          sessionKey: entry.sessionKey,
          positionAhead: index,
        })),
    ).sort((left, right) => left.createdAt - right.createdAt);
  }

  async countPendingQueuedItemsForSessionKey(
    sessionKey: string,
    params: { excludeId?: string } = {},
  ) {
    const entry = await this.sessionStore.get(sessionKey);
    return getStoredQueues(entry).filter((item) =>
      item.status === "pending" && item.id !== params.excludeId
    ).length;
  }

  async setQueuedItem(resolved: ResolvedAgentTarget, item: StoredQueueItem) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      lastAdmittedPromptAt: existing?.lastAdmittedPromptAt,
      followUp: existing?.followUp,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime: existing?.runtime,
      loops: getStoredLoops(existing),
      queues: [...getStoredQueues(existing).filter((current) => current.id !== item.id), item],
      recentConversation: existing?.recentConversation,
    }));
  }

  async replaceQueuedItemIfPresent(resolved: ResolvedAgentTarget, item: StoredQueueItem) {
    let replaced = false;
    await this.sessionStore.update(resolved.sessionKey, (existing) => {
      if (!existing || !getStoredQueues(existing).some((current) => current.id === item.id)) {
        return existing;
      }
      replaced = true;
      const { intervalLoops: _legacyLoops, ...rest } = existing;
      return {
        ...rest,
        runnerCommand: rest.runnerCommand ?? resolved.runner.command,
        loops: getStoredLoops(existing),
        queues: getStoredQueues(existing).map((current) =>
          current.id === item.id ? item : current
        ),
        updatedAt: Date.now(),
      };
    });
    return replaced;
  }

  async removeQueuedItem(resolved: ResolvedAgentTarget, queueId: string) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      lastAdmittedPromptAt: existing?.lastAdmittedPromptAt,
      followUp: existing?.followUp,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime: existing?.runtime,
      loops: getStoredLoops(existing),
      queues: getStoredQueues(existing).filter((item) => item.id !== queueId),
      recentConversation: existing?.recentConversation,
    }));
  }

  async clearPendingQueuedItemsForSessionKey(sessionKey: string) {
    let cleared: StoredQueueItem[] = [];
    await this.sessionStore.update(sessionKey, (existing) => {
      if (!existing) {
        return existing;
      }
      cleared = getStoredQueues(existing).filter((item) => item.status === "pending");
      if (cleared.length === 0) {
        return existing;
      }
      const { intervalLoops: _legacyLoops, ...rest } = existing;
      return {
        ...rest,
        loops: getStoredLoops(existing),
        queues: getStoredQueues(existing).filter((item) => item.status !== "pending"),
        updatedAt: Date.now(),
      };
    });
    return cleared;
  }

  async clearAllPendingQueuedItems() {
    const entries = await this.sessionStore.list();
    let cleared: StoredQueueItem[] = [];
    for (const entry of entries) {
      cleared = cleared.concat(await this.clearPendingQueuedItemsForSessionKey(entry.sessionKey));
    }
    return cleared;
  }

  async hasQueuedItemsForSession(sessionKey: string) {
    const entry = await this.sessionStore.get(sessionKey);
    return getStoredQueues(entry).some((item) =>
      item.status === "pending" || item.status === "running"
    );
  }

  async hasQueuedItem(sessionKey: string, queueId: string) {
    const entry = await this.sessionStore.get(sessionKey);
    return getStoredQueues(entry).some((item) => item.id === queueId);
  }

  async resetStaleRunningQueuedItems(activeSessionKeys: Set<string>) {
    const entries = await this.sessionStore.list();
    let reset = 0;
    for (const entry of entries) {
      if (activeSessionKeys.has(entry.sessionKey)) {
        continue;
      }
      const running = getStoredQueues(entry).filter((item) => item.status === "running");
      if (running.length === 0) {
        continue;
      }
      reset += running.length;
      await this.sessionStore.update(entry.sessionKey, (existing) => {
        if (!existing) {
          return existing;
        }
        const now = Date.now();
        const { intervalLoops: _legacyLoops, ...rest } = existing;
        return {
          ...rest,
          loops: getStoredLoops(existing),
          queues: getStoredQueues(existing).map((item) =>
            item.status === "running"
              ? { ...item, status: "pending" as const, startedAt: undefined, updatedAt: now }
              : item
          ),
          updatedAt: now,
        };
      });
    }
    return reset;
  }

  async appendRecentConversationMessage(
    resolved: ResolvedAgentTarget,
    message: StoredRecentConversationMessage,
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      lastAdmittedPromptAt: existing?.lastAdmittedPromptAt,
      followUp: existing?.followUp,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime: existing?.runtime,
      loops: getStoredLoops(existing),
      recentConversation: appendRecentConversationMessage(existing?.recentConversation, message),
    }));
  }

  async getRecentConversationReplayMessages(
    target: { sessionKey: string },
    params: {
      excludeMarker?: string;
    } = {},
  ) {
    const entry = await this.sessionStore.get(target.sessionKey);
    return collectRecentConversationReplayMessages(entry?.recentConversation, params);
  }

  async markRecentConversationProcessed(
    resolved: ResolvedAgentTarget,
    marker: string,
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      lastAdmittedPromptAt: existing?.lastAdmittedPromptAt,
      followUp: existing?.followUp,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime: existing?.runtime,
      loops: getStoredLoops(existing),
      recentConversation: markRecentConversationProcessed(existing?.recentConversation, marker),
    }));
  }

  private async upsertSessionEntry(
    resolved: ResolvedAgentTarget,
    update: SessionEntryUpdate,
  ) {
    return this.sessionStore.update(resolved.sessionKey, (existing) => {
      const next = update(existing);
      return {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
        sessionId: next.sessionId,
        workspacePath: resolved.workspacePath,
        runnerCommand: next.runnerCommand ?? existing?.runnerCommand ?? resolved.runner.command,
        lastAdmittedPromptAt: next.lastAdmittedPromptAt ?? existing?.lastAdmittedPromptAt,
        followUp: next.followUp,
        runtime: next.runtime ?? existing?.runtime,
        loops: next.loops ?? getStoredLoops(existing),
        queues: next.queues ?? getStoredQueues(existing),
        recentConversation: next.recentConversation ?? existing?.recentConversation,
        updatedAt: Date.now(),
      };
    });
  }
}

function getStoredLoops(entry: {
  loops?: StoredLoop[];
  intervalLoops?: StoredLoop[];
} | null | undefined) {
  return entry?.loops ?? entry?.intervalLoops ?? [];
}

function getStoredQueues(entry: {
  queues?: StoredQueueItem[];
} | null | undefined) {
  return entry?.queues ?? [];
}
