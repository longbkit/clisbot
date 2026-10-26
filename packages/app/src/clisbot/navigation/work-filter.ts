import { useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  deriveSessionStatusBucket,
  type WorkspaceSessionSource,
} from "@/clisbot/workspace-sessions/select-sessions";
import { useHosts, getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/workspace-root-policy";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import { useResourcePins } from "@/clisbot/bots/sidebar/pins";
import { NAVIGATION_V2_ENABLED } from "./feature";
import { useReaderAccounts } from "./reader";
import { useNavigationStore } from "./store";
import {
  createWorkFilter,
  type WorkFilter,
  type WorkSession,
  type WorkSessionsOf,
} from "./work-items";

export {
  countWork,
  isChatSession,
  matchesWorkChip,
  WORK_CHIPS,
  type WorkFilter,
} from "./work-items";

type Source = WorkspaceSessionSource;

const NONE: readonly WorkSession[] = [];

/** `serverId:workspaceId` → its unarchived root sessions, with the status each dot shows. */
export function indexWorkSessions(
  sources: ReadonlyMap<string, Source>,
): ReadonlyMap<string, WorkSession[]> {
  const index = new Map<string, WorkSession[]>();
  for (const [serverId, source] of sources) {
    for (const agent of source.agents.values()) {
      const workspaceId = normalizeWorkspaceOpaqueId(agent.workspaceId);
      if (agent.archivedAt || !workspaceId) continue;
      const parent = agent.parentAgentId ? source.agents.get(agent.parentAgentId) : undefined;
      if (!isWorkspaceRootAgent(agent, parent)) continue;
      const key = `${serverId}:${workspaceId}`;
      const list = index.get(key) ?? [];
      list.push({
        id: agent.id,
        labels: agent.labels,
        createdBy: agent.createdBy,
        statusBucket: deriveSessionStatusBucket(agent, source),
      });
      index.set(key, list);
    }
  }
  return index;
}

/** Hosts whose session directory has arrived at least once; their workspaces can be judged. */
function useLoadedSessionHosts(serverIds: readonly string[]): ReadonlySet<string> {
  const store = getHostRuntimeStore();
  const read = () =>
    serverIds
      .filter((serverId) => store.getSnapshot(serverId)?.hasEverLoadedAgentDirectory)
      .join("\n");
  const loaded = useSyncExternalStore((onChange) => store.subscribeAll(onChange), read, read);
  return useMemo(() => new Set(loaded ? loaded.split("\n") : []), [loaded]);
}

/** Every Host's root sessions by workspace, rebuilt once per agents or submissions change. */
export function useWorkSessionsOf(): WorkSessionsOf {
  const hosts = useHosts();
  // Outside Navigation V2 nothing reads the index; it subscribes to no Host.
  const serverIds = useMemo(
    () => (NAVIGATION_V2_ENABLED ? hosts.map((host) => host.serverId) : []),
    [hosts],
  );
  const agentMaps = useSessionStore(
    useShallow((state) => serverIds.map((id) => state.sessions[id]?.agents ?? null)),
  );
  const submissionMaps = useSessionStore(
    useShallow((state) => serverIds.map((id) => state.sessions[id]?.messageSubmissions ?? null)),
  );
  const loaded = useLoadedSessionHosts(serverIds);
  const index = useMemo(() => {
    const sources = new Map<string, Source>();
    serverIds.forEach((serverId, i) => {
      const agents = agentMaps[i];
      const messageSubmissions = submissionMaps[i];
      if (agents && messageSubmissions) sources.set(serverId, { agents, messageSubmissions });
    });
    return indexWorkSessions(sources);
  }, [agentMaps, serverIds, submissionMaps]);
  return useMemo<WorkSessionsOf>(
    () => (workspace) => {
      const sessions = index.get(
        `${workspace.serverId}:${normalizeWorkspaceOpaqueId(workspace.workspaceId)}`,
      );
      if (sessions) return sessions;
      return loaded.has(workspace.serverId) ? NONE : null;
    },
    [index, loaded],
  );
}

/** The Workspace list's query: its scope, chip and Bots chip, for the signed-in reader. */
export function useWorkQuery() {
  const scope = useNavigationStore((state) => state.scopes.work);
  const chip = useNavigationStore((state) => state.workChip);
  const showBots = useNavigationStore((state) => state.workShowBots);
  const accounts = useReaderAccounts();
  return useMemo(() => ({ scope, chip, accounts, showBots }), [scope, chip, accounts, showBots]);
}

/**
 * The Workspace list's one filter for the shared sidebar model: which workspaces it lists and
 * which sessions under them. Null outside Navigation V2, where the Home V2 sidebar lists all.
 */
export function useWorkListFilter(): {
  filter: WorkFilter;
  sessionsOf: WorkSessionsOf;
  /** `serverId:agentId` of pinned sessions: they float above the list instead of sitting in it. */
  pinnedSessions: ReadonlySet<string>;
} | null {
  const query = useWorkQuery();
  const sessionsOf = useWorkSessionsOf();
  const { pins } = useResourcePins();
  const pinnedSessions = useMemo(
    () =>
      new Set(pins.flatMap((pin) => (pin.kind === "session" ? [`${pin.serverId}:${pin.id}`] : []))),
    [pins],
  );
  return useMemo(
    () =>
      NAVIGATION_V2_ENABLED
        ? { filter: createWorkFilter(query, sessionsOf), sessionsOf, pinnedSessions }
        : null,
    [query, sessionsOf, pinnedSessions],
  );
}
