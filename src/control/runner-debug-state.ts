import { resolveAgentTarget } from "../agents/resolved-target.ts";
import { SessionStore, type StoredSessionEntry } from "../agents/session-store.ts";
import { type LoadedConfig, resolveSessionStorePath } from "../config/load-config.ts";
import { TmuxClient } from "../runners/tmux/client.ts";

export type RunnerSessionMetadata = {
  entry: StoredSessionEntry;
  sessionName: string;
};

export type RunnerSessionSummary = {
  sessionName: string;
  live: boolean;
  entry?: StoredSessionEntry;
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

export async function listRunnerSessions(
  loadedConfig: LoadedConfig,
): Promise<RunnerSessionSummary[]> {
  const sessionStore = new SessionStore(resolveSessionStorePath(loadedConfig));
  const metadata = buildRunnerSessionMetadata(loadedConfig, await sessionStore.list());
  const sessionByName = new Map(metadata.map((item) => [item.sessionName, item.entry]));
  const tmux = new TmuxClient(loadedConfig.raw.tmux.socketPath);
  const liveSessionNames = new Set(await tmux.listSessions());

  return [...liveSessionNames]
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
    })
    .map((sessionName) => ({
      sessionName,
      live: true,
      entry: sessionByName.get(sessionName),
    }));
}
