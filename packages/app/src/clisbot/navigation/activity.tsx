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
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { NAVIGATION_V2_ENABLED } from "./feature";
import { homeBadgeCount, homeRows, type HomeRow } from "./home-feed";
import { selectIssueRecords, useIssueStore } from "./issue-store";
import {
  dismissIssue,
  markIssueSeen,
  markIssueUnread,
  markIssuesSeen,
  observeIssues,
  type IssueSubject,
} from "./issues";
import { resolveOwnership, type Ownership } from "./ownership";
import { useReaderAccounts } from "./reader";

const MINUTE = 60_000;

interface NavigationActivity {
  rows: HomeRow[];
  badge: number;
  now: number;
  ownershipOf: (agent: Pick<AggregatedAgent, "serverId" | "workspaceId" | "labels">) => Ownership;
  /** Author lookup for a workspace, the source of ownership for Work rows and pins. */
  workspaceAuthor: (serverId: string, workspaceId: string) => SessionActor | undefined;
  markSeen: (subject: IssueSubject) => void;
  markUnread: (subject: IssueSubject) => void;
  dismiss: (subject: IssueSubject) => void;
  markAllSeen: (subjects: readonly IssueSubject[]) => void;
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
  const { agents } = useAggregatedAgents({ demand: false });
  const now = useMinuteClock();
  const ownership = useOwnership();
  const scope = useResourcePrincipalScope();
  const records = useIssueStore(selectIssueRecords(scope));
  const update = useIssueStore((state) => state.update);
  useEffect(() => {
    update(scope, (current) => observeIssues(current, agents, Date.now()));
  }, [agents, scope, update]);
  const rows = useMemo(
    () => homeRows({ agents, ownershipOf: ownership.ownershipOf, records, now }),
    [agents, ownership.ownershipOf, records, now],
  );
  const transition = useCallback(
    (apply: (current: typeof records) => typeof records) => update(scope, apply),
    [scope, update],
  );
  const value = useMemo<NavigationActivity>(
    () => ({
      rows,
      badge: homeBadgeCount(rows),
      now,
      ...ownership,
      markSeen: (subject) => transition((current) => markIssueSeen(current, subject, Date.now())),
      markUnread: (subject) =>
        transition((current) => markIssueUnread(current, subject, Date.now())),
      dismiss: (subject) => transition((current) => dismissIssue(current, subject, Date.now())),
      markAllSeen: (subjects) =>
        transition((current) => markIssuesSeen(current, subjects, Date.now())),
    }),
    [rows, now, ownership, transition],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
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
    (agent: Pick<AggregatedAgent, "serverId" | "workspaceId" | "labels">): Ownership => {
      const chatId = getChatIdFromLabels(agent.labels);
      let createdBy: SessionActor | undefined;
      if (chatId) createdBy = chatAuthors.get(`${agent.serverId}:${chatId}`);
      else if (agent.workspaceId) createdBy = workspaceAuthor(agent.serverId, agent.workspaceId);
      return resolveOwnership({ createdBy, accounts });
    },
    [accounts, chatAuthors, workspaceAuthor],
  );
  return useMemo(() => ({ ownershipOf, workspaceAuthor }), [ownershipOf, workspaceAuthor]);
}
