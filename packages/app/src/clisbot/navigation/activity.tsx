import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { getChatIdFromLabels } from "@clisbot/protocol/bots/labels";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { useResourcePrincipalScope } from "@/clisbot/bots/data/resource-principal-scope";
import { useBotCatalog } from "@/clisbot/bots/data/runtime";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { NAVIGATION_V2_ENABLED } from "./feature";
import { createHomeRowCache, homeBadgeCount, type HomeRow } from "./home-feed";
import { selectIssueRecords, useIssueStore } from "./issue-store";
import {
  dismissIssue,
  markIssueSeen,
  markIssueUnread,
  markIssuesSeen,
  observeIssues,
  type IssueRecords,
  type IssueSubject,
} from "./issues";
import { usePathname } from "expo-router";
import { parseChatRouteFromPathname } from "@/clisbot/bots/routes";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { resolveOwnership, type Ownership } from "./ownership";
import { useReaderAccounts, useRememberVerifiedReaders } from "./reader";
import { useNavigationAgents } from "./use-navigation-agents";

const MINUTE = 60_000;

interface NavigationActivity {
  rows: HomeRow[];
  badge: number;
  now: number;
  ownershipOf: (agent: Pick<AggregatedAgent, "serverId" | "workspaceId" | "labels">) => Ownership;
  /** Author lookup for a workspace, the source of ownership for Work rows and pins. */
  workspaceAuthor: (serverId: string, workspaceId: string) => SessionActor | undefined;
  markSeen: (agent: AggregatedAgent) => void;
  markUnread: (agent: AggregatedAgent) => void;
  dismiss: (agent: AggregatedAgent) => void;
  markAllSeen: (agents: readonly AggregatedAgent[]) => void;
}

const Context = createContext<NavigationActivity | null>(null);

/**
 * One passive observer for Navigation V2: who owns each session, which issue it shows, and the
 * Home badge. It adds no directory demand; Home, Chats and Work read the same rows (brief 1.3).
 */
export function NavigationActivityProvider({ children }: { children: ReactNode }) {
  if (!NAVIGATION_V2_ENABLED) return children;
  return <ObservedNavigationActivity>{children}</ObservedNavigationActivity>;
}

function ObservedNavigationActivity({ children }: { children: ReactNode }) {
  // `observed` feeds the issue records (an out-of-reach Host keeps its approvals); `agents` is
  // what may be drawn as live (source-liveness.ts).
  const { observed, display: agents } = useNavigationAgents();
  useRememberVerifiedReaders();
  const now = useMinuteClock();
  const ownership = useOwnership();
  const scope = useResourcePrincipalScope();
  const records = useIssueStore(selectIssueRecords(scope));
  const update = useIssueStore((state) => state.update);
  const subjectOf = useIssueSubjects();
  useEffect(() => {
    // Only a session with pending requests needs its request ids spread onto its subject.
    const subjects = observed.map((agent) =>
      (agent.pendingPermissionCount ?? 0) > 0 ? subjectOf(agent) : agent,
    );
    update(scope, (current) => observeIssues(current, subjects, Date.now()));
  }, [observed, scope, subjectOf, update]);
  const rowsOf = useMemo(createHomeRowCache, []);
  const rows = useMemo(
    () => rowsOf({ agents, ownershipOf: ownership.ownershipOf, records, now, subjectOf }),
    [agents, ownership.ownershipOf, records, now, rowsOf, subjectOf],
  );
  const transition = useCallback(
    (apply: (current: typeof records) => typeof records) => update(scope, apply),
    [scope, update],
  );
  useMarkOpenedSeen(rows, subjectOf, transition);
  const value = useMemo<NavigationActivity>(
    () => ({
      rows,
      badge: homeBadgeCount(rows),
      now,
      ...ownership,
      markSeen: (agent) =>
        transition((current) => markIssueSeen(current, subjectOf(agent), Date.now())),
      markUnread: (agent) =>
        transition((current) => markIssueUnread(current, subjectOf(agent), Date.now())),
      dismiss: (agent) =>
        transition((current) => dismissIssue(current, subjectOf(agent), Date.now())),
      markAllSeen: (list) =>
        transition((current) => markIssuesSeen(current, list.map(subjectOf), Date.now())),
    }),
    [rows, now, ownership, subjectOf, transition],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** A session's issue subject: its directory entry plus the ids of its pending requests. */
function useIssueSubjects(): (agent: AggregatedAgent) => IssueSubject {
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const agentMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) => serverIds.map((id) => state.sessions[id]?.agents ?? null),
    shallow,
  );
  return useCallback(
    (agent: AggregatedAgent) => {
      const source = agentMaps[serverIds.indexOf(agent.serverId)]?.get(agent.id);
      const ids = source?.pendingPermissions.map((request) => request.id) ?? [];
      return { ...agent, requestKey: ids.length ? [...ids].sort().join(",") : null };
    },
    [agentMaps, serverIds],
  );
}

/**
 * Opening a session sees its issues (brief 3.1c): the route of an open workspace or Chat marks
 * the issues of the sessions it shows. The daemon clears a failure's attention on its own; a
 * request has no daemon signal, so this is what sees it.
 */
function useMarkOpenedSeen(
  rows: readonly HomeRow[],
  subjectOf: (agent: AggregatedAgent) => IssueSubject,
  transition: (apply: (current: IssueRecords) => IssueRecords) => void,
) {
  const pathname = usePathname();
  const routeServerId = parseHostWorkspaceRouteFromPathname(pathname)?.serverId;
  // A workspace holds many sessions; only the one on screen has been opened.
  const focusedAgentId = useSessionStore((state) =>
    routeServerId ? (state.sessions[routeServerId]?.focusedAgentId ?? null) : null,
  );
  useEffect(() => {
    const workspace = parseHostWorkspaceRouteFromPathname(pathname);
    const chat = parseChatRouteFromPathname(pathname);
    if (!workspace && !chat) return;
    const opened = rows.filter(({ agent, issue }) => {
      if (issue?.state !== "unseen") return false;
      if (workspace)
        return (
          agent.serverId === workspace.serverId &&
          agent.workspaceId === workspace.workspaceId &&
          agent.id === focusedAgentId
        );
      return (
        agent.serverId === chat!.serverId && getChatIdFromLabels(agent.labels) === chat!.chatId
      );
    });
    if (!opened.length) return;
    transition((current) =>
      markIssuesSeen(
        current,
        opened.map(({ agent }) => subjectOf(agent)),
        Date.now(),
      ),
    );
  }, [focusedAgentId, pathname, rows, subjectOf, transition]);
}

export function useNavigationActivity(): NavigationActivity {
  const value = useContext(Context);
  if (!value) throw new Error("Navigation V2 activity requires its provider");
  return value;
}

/** Seen failures age out after seven days; a coarse clock is enough to notice. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function useOwnership() {
  const accounts = useReaderAccounts();
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const workspaceMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) => serverIds.map((id) => state.sessions[id]?.workspaces ?? null),
    shallow,
  );
  const { chats } = useBotCatalog();
  const chatAuthors = useMemo(() => {
    const map = new Map<string, SessionActor | undefined>();
    if (chats.loadState.status !== "loaded") return map;
    for (const chat of chats.loadState.data)
      map.set(`${chat.serverId}:${chat.id}`, chat.record?.createdBy);
    return map;
  }, [chats.loadState]);
  const workspaceAuthor = useCallback(
    (serverId: string, workspaceId: string) => {
      const index = serverIds.indexOf(serverId);
      return index === -1 ? undefined : workspaceMaps[index]?.get(workspaceId)?.createdBy;
    },
    [serverIds, workspaceMaps],
  );
  const ownershipOf = useCallback(
    (
      agent: Pick<AggregatedAgent, "serverId" | "workspaceId" | "labels" | "createdBy">,
    ): Ownership => {
      // A session's own author decides; its chat's or workspace's author only stands in for a
      // session that records none (the same rule the Workspace list scopes by).
      const chatId = getChatIdFromLabels(agent.labels);
      let createdBy: SessionActor | undefined = agent.createdBy;
      if (!createdBy && chatId) createdBy = chatAuthors.get(`${agent.serverId}:${chatId}`);
      else if (!createdBy && agent.workspaceId)
        createdBy = workspaceAuthor(agent.serverId, agent.workspaceId);
      return resolveOwnership({ createdBy, accounts });
    },
    [accounts, chatAuthors, workspaceAuthor],
  );
  return useMemo(() => ({ ownershipOf, workspaceAuthor }), [ownershipOf, workspaceAuthor]);
}
