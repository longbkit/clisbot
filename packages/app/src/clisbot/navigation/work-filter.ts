import equal from "fast-deep-equal";
import { useMemo, useRef, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  deriveSessionStatus,
  type WorkspaceSessionSource,
} from "@/clisbot/workspace-sessions/select-sessions";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { workspaceRootAgentsOf } from "@/stores/workspace-root-agents";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import { useResourcePins } from "@/clisbot/bots/sidebar/pins";
import { NAVIGATION_V2_ENABLED } from "./feature";
import { participationKeyOf } from "./ownership-key";
import { useOwnershipHosts } from "./use-ownership-hosts";
import { useReaderAccounts } from "./reader";
import { useSourceLiveness } from "./use-source-liveness";
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

/**
 * `serverId:workspaceId` → its unarchived root sessions, with the status each dot shows. Reads the
 * store's per-workspace root-agent lists, and keeps `previous`'s list for a workspace whose
 * sessions say the same, and `previous` itself when every list does.
 */
export function indexWorkSessions(
  sources: ReadonlyMap<string, Source>,
  previous?: ReadonlyMap<string, WorkSession[]>,
): ReadonlyMap<string, WorkSession[]> {
  const index = new Map<string, WorkSession[]>();
  let changed = false;
  for (const [serverId, source] of sources) {
    for (const [workspaceId, agents] of workspaceRootAgentsOf(source.agents)) {
      const key = `${serverId}:${workspaceId}`;
      const before = previous?.get(key);
      const sessions = workSessionsOf(agents, source, before);
      if (sessions !== before) changed = true;
      index.set(key, sessions);
    }
  }
  if (!previous || changed || previous.size !== index.size) return index;
  return previous;
}

interface WorkSessionsMemo {
  source: Source;
  sessions: WorkSession[];
}

// One entry per root-agent list: its sessions only change with the list or the Host's submissions.
const workSessionsMemo = new WeakMap<readonly Agent[], WorkSessionsMemo>();

function workSessionsOf(
  agents: readonly Agent[],
  source: Source,
  previous: WorkSession[] | undefined,
): WorkSession[] {
  const memo = workSessionsMemo.get(agents);
  if (
    memo &&
    memo.source.messageSubmissions === source.messageSubmissions &&
    memo.source.cached === source.cached
  ) {
    return memo.sessions;
  }
  const built = agents.map((agent) => workSessionOf(agent, source));
  const sessions = previous && equal(previous, built) ? previous : built;
  workSessionsMemo.set(agents, { source, sessions });
  return sessions;
}

function workSessionOf(agent: Agent, source: Source): WorkSession {
  const status = deriveSessionStatus(agent, source);
  return {
    id: agent.id,
    labels: agent.labels,
    createdBy: agent.createdBy,
    participationKey: participationKeyOf(agent),
    statusBucket: status.bucket,
    ...(status.unverified ? { unverified: true } : {}),
  };
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
  const { listable, cached } = useSourceLiveness();
  // Outside Navigation V2 nothing reads the index; it subscribes to no Host.
  const serverIds = useMemo(() => (NAVIGATION_V2_ENABLED ? [...listable] : []), [listable]);
  const agentMaps = useSessionStore(
    useShallow((state) => serverIds.map((id) => state.sessions[id]?.agents ?? null)),
  );
  const submissionMaps = useSessionStore(
    useShallow((state) => serverIds.map((id) => state.sessions[id]?.messageSubmissions ?? null)),
  );
  const loaded = useLoadedSessionHosts(serverIds);
  // The last index, so an agent update that changes no session hands the Work tree the same one.
  const previous = useRef<ReadonlyMap<string, WorkSession[]> | undefined>(undefined);
  const index = useMemo(() => {
    const sources = new Map<string, Source>();
    serverIds.forEach((serverId, i) => {
      const agents = agentMaps[i];
      const messageSubmissions = submissionMaps[i];
      if (agents && messageSubmissions)
        sources.set(serverId, { agents, messageSubmissions, cached: cached.has(serverId) });
    });
    previous.current = indexWorkSessions(sources, previous.current);
    return previous.current;
  }, [agentMaps, cached, serverIds, submissionMaps]);
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
  const hostKinds = useOwnershipHosts();
  const { listable, cached } = useSourceLiveness();
  return useMemo(
    () => ({
      scope,
      chip,
      accounts,
      hostKinds,
      showBots,
      cachedServerIds: cached,
      listableServerIds: listable,
    }),
    [scope, chip, accounts, hostKinds, showBots, cached, listable],
  );
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
