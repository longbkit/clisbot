import { resolveAgentTarget } from "../../agents/routing/resolved-target.ts";
import { parseRunnerSessionId } from "../../agents/session/session-identity.ts";
import { SessionStore, type StoredSessionEntry } from "../../agents/session/session-store.ts";
import { type LoadedConfig, resolveSessionStorePath } from "../../config/core/load-config.ts";
import { TmuxClient } from "../../runners/tmux/client.ts";

export type RunnerSessionMetadata = {
  entry: StoredSessionEntry;
  sessionName: string;
};

export type RunnerSessionSummary = {
  index?: number;
  sessionName: string;
  live: boolean;
  entry?: StoredSessionEntry;
  identity?: RunnerSessionIdentity;
};

export type RunnerSessionIdentity = {
  sessionId?: string;
  sessionIdPersistence?: "persisted" | "not-persisted-yet";
  storedSessionId?: string;
};

export function buildRunnerSessionMetadata(
  loadedConfig: LoadedConfig,
  entries: StoredSessionEntry[],
): RunnerSessionMetadata[] {
  return entries.map((entry) => ({
    entry,
    sessionName: resolveAgentTarget(loadedConfig, {
      agentId: entry.agentId,
      sessionKey: entry.sessionKey,
    }).sessionName,
  }));
}

export function sortRunnerSessionMetadataNewestFirst(
  entries: RunnerSessionMetadata[],
) {
  return [...entries].sort((left, right) => {
    const leftPromptAt = left.entry.lastAdmittedPromptAt ?? 0;
    const rightPromptAt = right.entry.lastAdmittedPromptAt ?? 0;
    if (rightPromptAt !== leftPromptAt) {
      return rightPromptAt - leftPromptAt;
    }
    if (right.entry.updatedAt !== left.entry.updatedAt) {
      return right.entry.updatedAt - left.entry.updatedAt;
    }
    return left.sessionName.localeCompare(right.sessionName);
  });
}

export function deriveRunnerSessionIdentity(params: {
  entry?: StoredSessionEntry;
  liveSessionId?: string;
}) {
  const storedSessionId = params.entry?.sessionId?.trim() || undefined;
  const liveSessionId = params.liveSessionId?.trim() || undefined;
  const sessionId = liveSessionId ?? storedSessionId;
  return {
    sessionId,
    sessionIdPersistence:
      sessionId && sessionId === storedSessionId ? "persisted" : sessionId ? "not-persisted-yet" : undefined,
    storedSessionId,
  } satisfies RunnerSessionIdentity;
}

export function parseRunnerSessionIdFromSnapshot(
  loadedConfig: LoadedConfig,
  entry: StoredSessionEntry | undefined,
  snapshot: string,
) {
  if (!entry) {
    return undefined;
  }

  const resolved = resolveAgentTarget(loadedConfig, {
    agentId: entry.agentId,
    sessionKey: entry.sessionKey,
  });
  const pattern = resolved.runner.sessionId.capture.pattern?.trim();
  if (!pattern) {
    return undefined;
  }
  return parseRunnerSessionId(snapshot, pattern) ?? undefined;
}

export async function listRunnerSessions(
  loadedConfig: LoadedConfig,
): Promise<RunnerSessionSummary[]> {
  const sessionStore = new SessionStore(resolveSessionStorePath(loadedConfig));
  const metadata = buildRunnerSessionMetadata(loadedConfig, await sessionStore.list());
  const sessionByName = new Map(metadata.map((item) => [item.sessionName, item.entry]));
  const tmux = new TmuxClient(loadedConfig.raw.tmux.socketPath);
  const liveSessionNames = new Set(await tmux.listSessions());

  const orderedSessionNames = [...liveSessionNames]
    .sort((left, right) => {
      const leftEntry = sessionByName.get(left);
      const rightEntry = sessionByName.get(right);
      const leftPromptAt = leftEntry?.lastAdmittedPromptAt ?? 0;
      const rightPromptAt = rightEntry?.lastAdmittedPromptAt ?? 0;
      if (rightPromptAt !== leftPromptAt) {
        return rightPromptAt - leftPromptAt;
      }
      const leftUpdatedAt = leftEntry?.updatedAt ?? 0;
      const rightUpdatedAt = rightEntry?.updatedAt ?? 0;
      if (rightUpdatedAt !== leftUpdatedAt) {
        return rightUpdatedAt - leftUpdatedAt;
      }
      return left.localeCompare(right);
    });

  return orderedSessionNames.map((sessionName, index) => {
    const entry = sessionByName.get(sessionName);
    return {
      index: index + 1,
      sessionName,
      live: true,
      entry,
      identity: deriveRunnerSessionIdentity({
        entry,
      }),
    };
  });
}
