import { createSessionId } from "./session-identity.ts";
import type { AgentSessionState } from "./session-state.ts";
import type { ResolvedAgentTarget } from "../routing/resolved-target.ts";
import type { StoredSessionRuntime } from "./run-observation.ts";

export type PreparedSessionMapping = {
  storedSessionId?: string;
  sessionId?: string;
  resume: boolean;
};

export class SessionMapping {
  constructor(private readonly sessionState: AgentSessionState) {}

  async listEntries() {
    return this.sessionState.listEntries();
  }

  async get(sessionKey: string) {
    return this.sessionState.getEntry(sessionKey);
  }

  async prepareStartup(resolved: ResolvedAgentTarget): Promise<PreparedSessionMapping> {
    const entry = await this.sessionState.getEntry(resolved.sessionKey);
    const storedSessionId = entry?.sessionId?.trim() || undefined;
    if (storedSessionId) {
      return {
        storedSessionId,
        sessionId: storedSessionId,
        resume: true,
      };
    }

    if (resolved.runner.sessionId.create.mode !== "explicit") {
      return {
        resume: false,
      };
    }

    return {
      sessionId: createSessionId(),
      resume: false,
    };
  }

  async setActive(
    resolved: ResolvedAgentTarget,
    params: {
      sessionId: string;
      runnerCommand?: string;
      runtime?: StoredSessionRuntime;
    },
  ) {
    return this.sessionState.touchSessionEntry(resolved, {
      sessionId: params.sessionId,
      runnerCommand: params.runnerCommand,
      runtime: params.runtime,
    });
  }

  async clearActive(
    resolved: ResolvedAgentTarget,
    params: {
      runnerCommand?: string;
      preserveRuntime?: boolean;
    } = {},
  ) {
    return this.sessionState.clearSessionIdEntry(resolved, params);
  }

  async touch(
    resolved: ResolvedAgentTarget,
    params: {
      runnerCommand?: string;
      runtime?: StoredSessionRuntime;
    } = {},
  ) {
    return this.sessionState.touchSessionEntry(resolved, params);
  }
}
