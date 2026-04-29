import type { FollowUpMode, StoredFollowUpState } from "./follow-up-policy.ts";
import type { IntervalLoopStatus, StoredLoop } from "./loop-state.ts";
import type { ResolvedAgentTarget } from "./resolved-target.ts";
import type { StoredSessionRuntime } from "./run-observation.ts";
import type { SessionRuntimeInfo } from "./session-runtime.ts";
import {
  appendRecentConversationMessage,
  collectRecentConversationReplayMessages,
  markRecentConversationProcessed,
  type StoredRecentConversationMessage,
  type StoredRecentConversationState,
} from "../shared/recent-message-context.ts";
import { SessionStore } from "./session-store.ts";

export type ActiveSessionRuntimeInfo = SessionRuntimeInfo & {
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
  recentConversation?: StoredRecentConversationState;
} | null) => {
  sessionId?: string;
  lastAdmittedPromptAt?: number;
  followUp?: StoredFollowUpState;
  runnerCommand?: string;
  runtime?: StoredSessionRuntime;
  loops?: StoredLoop[];
  recentConversation?: StoredRecentConversationState;
};

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
    params: { runnerCommand?: string } = {},
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: undefined,
      lastAdmittedPromptAt: existing?.lastAdmittedPromptAt,
      followUp: existing?.followUp,
      runnerCommand: params.runnerCommand ?? existing?.runnerCommand ?? resolved.runner.command,
      runtime: {
        state: "idle",
      },
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
      runtime,
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

  async listActiveSessionRuntimes(): Promise<ActiveSessionRuntimeInfo[]> {
    const entries = await this.sessionStore.list();
    return entries
      .filter(hasActiveRuntime)
      .map((entry) => ({
        state: entry.runtime.state,
        startedAt: entry.runtime.startedAt,
        detachedAt: entry.runtime.detachedAt,
        finalReplyAt: entry.runtime.finalReplyAt,
        lastMessageToolReplyAt: entry.runtime.lastMessageToolReplyAt,
        messageToolFinalReplyAt: entry.runtime.messageToolFinalReplyAt,
        sessionKey: entry.sessionKey,
        agentId: entry.agentId,
      }));
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

function hasActiveRuntime(
  entry: Awaited<ReturnType<SessionStore["list"]>>[number],
): entry is Awaited<ReturnType<SessionStore["list"]>>[number] & {
  runtime: StoredSessionRuntime & { state: "running" | "detached" };
} {
  return entry.runtime?.state === "running" || entry.runtime?.state === "detached";
}
