import type { FollowUpMode, StoredFollowUpState } from "./follow-up-policy.ts";
import type { ResolvedAgentTarget } from "./resolved-target.ts";
import type { StoredSessionRuntime } from "./run-observation.ts";
import type { SessionRuntimeInfo } from "./session-runtime.ts";
import { SessionStore } from "./session-store.ts";

export type ActiveSessionRuntimeInfo = SessionRuntimeInfo & {
  state: "running" | "detached";
};

type SessionEntryUpdate = (existing: {
  sessionId?: string;
  followUp?: StoredFollowUpState;
  runnerCommand?: string;
  runtime?: StoredSessionRuntime;
} | null) => {
  sessionId?: string;
  followUp?: StoredFollowUpState;
  runnerCommand?: string;
  runtime?: StoredSessionRuntime;
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
      followUp: existing?.followUp,
      runnerCommand: params.runnerCommand ?? existing?.runnerCommand ?? resolved.runner.command,
      runtime: params.runtime ?? existing?.runtime,
    }));
  }

  async clearSessionIdEntry(
    resolved: ResolvedAgentTarget,
    params: { runnerCommand?: string } = {},
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: undefined,
      followUp: existing?.followUp,
      runnerCommand: params.runnerCommand ?? existing?.runnerCommand ?? resolved.runner.command,
      runtime: {
        state: "idle",
      },
    }));
  }

  async setSessionRuntime(
    resolved: ResolvedAgentTarget,
    runtime: StoredSessionRuntime,
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      followUp: existing?.followUp,
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime,
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
        sessionKey: entry.sessionKey,
        agentId: entry.agentId,
      }));
  }

  async setConversationFollowUpMode(
    resolved: ResolvedAgentTarget,
    mode: FollowUpMode,
  ) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      followUp: {
        ...existing?.followUp,
        overrideMode: mode,
      },
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
    }));
  }

  async resetConversationFollowUpMode(resolved: ResolvedAgentTarget) {
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

  async reactivateConversationFollowUp(resolved: ResolvedAgentTarget) {
    const existing = await this.sessionStore.get(resolved.sessionKey);
    if (existing?.followUp?.overrideMode !== "paused") {
      return existing;
    }
    return this.resetConversationFollowUpMode(resolved);
  }

  async recordConversationReply(resolved: ResolvedAgentTarget) {
    return this.upsertSessionEntry(resolved, (existing) => ({
      sessionId: existing?.sessionId,
      followUp: {
        ...existing?.followUp,
        lastBotReplyAt: Date.now(),
      },
      runnerCommand: existing?.runnerCommand ?? resolved.runner.command,
      runtime: existing?.runtime,
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
        followUp: next.followUp,
        runtime: next.runtime ?? existing?.runtime,
        updatedAt: Date.now(),
      };
    });
  }
}

function hasActiveRuntime(
  entry: Awaited<ReturnType<SessionStore["list"]>>[number],
): entry is Awaited<ReturnType<SessionStore["list"]>>[number] & {
  runtime: StoredSessionRuntime & { state: "running" | "detached" };
} {
  return entry.runtime?.state === "running" || entry.runtime?.state === "detached";
}
