import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { getBotIdFromLabels } from "@clisbot/protocol/bots/labels";
import {
  EMPTY_SCOPE_COUNTS,
  inScope,
  resolveOwnership,
  type OwnershipScope,
  type ReaderAccount,
} from "./ownership";
import type { WorkChip } from "./store";

/**
 * A session is Chat iff it carries a Bot label; everything else is Work. Home's mode, the
 * Workspace list's Bots chip, Chats and global search all decide by this one rule, per session —
 * never by the project a session happens to live in, so nothing waits for Bot data to load.
 */
export function isChatSession(session: { labels?: Record<string, unknown> | null }): boolean {
  return getBotIdFromLabels(session.labels) !== null;
}

/** One root session as Work reads it: who started it and the status its dot shows. */
export interface WorkSession {
  id: string;
  labels?: Record<string, unknown> | null;
  createdBy?: SessionActor;
  statusBucket: string;
  /** Its live state was dropped (the source is out of reach): unknown, so not Running or Done. */
  unverified?: boolean;
}

/** The workspace fields Work reads; a subset of the sidebar entry. */
export interface WorkWorkspace {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  statusBucket: string;
  createdBy?: SessionActor;
}

const LIVE_BUCKETS: ReadonlySet<string> = new Set(["running", "needs_input"]);

export const WORK_CHIPS: readonly WorkChip[] = ["all", "needs", "running", "done", "failed"];

/** Work's quick filters (brief C4) over an item's own status, as its dot shows it. */
export function matchesWorkChip(
  item: { statusBucket: string; unverified?: boolean },
  chip: WorkChip,
): boolean {
  // What a cached session was doing is unknown: it is listed, but under no status chip.
  if (item.unverified) return chip === "all";
  if (chip === "needs") return item.statusBucket === "needs_input";
  if (chip === "running") return item.statusBucket === "running";
  if (chip === "failed") return item.statusBucket === "failed";
  if (chip === "done") return item.statusBucket === "done" || item.statusBucket === "attention";
  return true;
}

/**
 * The Workspace list's items. A session's author is its own `createdBy`; a workspace's author
 * covers only the sessions that record none. A workspace with no root session is one item itself.
 * With Bots off, Bot sessions are no items, and a workspace holding only those is not listed.
 */
export interface WorkItem {
  key: string;
  createdBy?: SessionActor;
  statusBucket: string;
  unverified?: boolean;
}

/**
 * A workspace's root sessions: `null` while its Host has not delivered its sessions yet (or never
 * will, offline), so with Bots hidden a workspace that turns out to be all Bot sessions is never
 * shown first and hidden after.
 */
export type WorkSessionsOf = (workspace: WorkWorkspace) => readonly WorkSession[] | null;

export function workItemsOf(
  workspace: WorkWorkspace,
  sessions: readonly WorkSession[] | null,
  showBots: boolean,
  /** The workspace's Host is out of reach, so its own running or approval status is not live. */
  cachedSource = false,
): WorkItem[] {
  // Unknown sessions only matter while Bots are hidden: a workspace that may turn out to be all
  // Bot sessions waits instead of showing and then vanishing. With Bots shown it is listed.
  if (sessions === null && !showBots) return [];
  if (!sessions?.length)
    return [
      {
        key: workspace.workspaceKey,
        createdBy: workspace.createdBy,
        statusBucket: workspace.statusBucket,
        ...(cachedSource && LIVE_BUCKETS.has(workspace.statusBucket) ? { unverified: true } : {}),
      },
    ];
  return sessions.flatMap((session) =>
    !showBots && isChatSession(session)
      ? []
      : [
          {
            key: `${workspace.workspaceKey}:${session.id}`,
            createdBy: session.createdBy ?? workspace.createdBy,
            statusBucket: session.statusBucket,
            ...(session.unverified ? { unverified: true } : {}),
          },
        ],
  );
}

export interface WorkQuery {
  scope: OwnershipScope;
  chip: WorkChip;
  accounts: readonly ReaderAccount[];
  /** The Bots chip: Bot-labelled sessions are listed (the default) or hidden. */
  showBots: boolean;
  /** Hosts out of reach: a workspace with no session list shows no live status either. */
  cachedServerIds?: ReadonlySet<string>;
  /** Hosts whose work may be listed at all (the Host picker's); absent lists every Host. */
  listableServerIds?: ReadonlySet<string>;
}

function isListed(query: Pick<WorkQuery, "listableServerIds">, serverId: string): boolean {
  return query.listableServerIds?.has(serverId) ?? true;
}

/** Scope first, then the chip: an item another member started is never "For me". */
export function workItemPasses(item: WorkItem, query: WorkQuery): boolean {
  const ownership = resolveOwnership({ createdBy: item.createdBy, accounts: query.accounts });
  return inScope(query.scope, ownership) && matchesWorkChip(item, query.chip);
}

/**
 * Whether Work lists a workspace and which of its sessions. Pins, groupings and the floating
 * pinned rows all ask this, so a pin can reorder only what the scope already admits.
 */
export interface WorkFilter {
  workspace(workspace: WorkWorkspace): boolean;
  session(session: WorkSession, workspace: Pick<WorkWorkspace, "createdBy">): boolean;
}

export function createWorkFilter(query: WorkQuery, sessionsOf: WorkSessionsOf): WorkFilter {
  return {
    workspace: (workspace) =>
      isListed(query, workspace.serverId) &&
      workItemsOf(
        workspace,
        sessionsOf(workspace),
        query.showBots,
        query.cachedServerIds?.has(workspace.serverId),
      ).some((item) => workItemPasses(item, query)),
    session: (session, workspace) =>
      (query.showBots || !isChatSession(session)) &&
      workItemPasses(
        {
          key: session.id,
          createdBy: session.createdBy ?? workspace.createdBy,
          statusBucket: session.statusBucket,
          unverified: session.unverified,
        },
        query,
      ),
  };
}

/** For me / Others / All and the chip counts, over items, in one pass. */
export function countWork(
  workspaces: Iterable<WorkWorkspace>,
  sessionsOf: WorkSessionsOf,
  query: Omit<WorkQuery, "chip">,
) {
  const { scope, accounts, showBots, cachedServerIds } = query;
  const chips: Record<WorkChip, number> = { all: 0, needs: 0, running: 0, done: 0, failed: 0 };
  const scopes = { ...EMPTY_SCOPE_COUNTS };
  for (const workspace of workspaces) {
    if (!isListed(query, workspace.serverId)) continue;
    const cachedSource = cachedServerIds?.has(workspace.serverId);
    for (const item of workItemsOf(workspace, sessionsOf(workspace), showBots, cachedSource)) {
      const ownership = resolveOwnership({ createdBy: item.createdBy, accounts });
      scopes[ownership] += 1;
      scopes.all += 1;
      if (!inScope(scope, ownership)) continue;
      for (const chip of WORK_CHIPS) if (matchesWorkChip(item, chip)) chips[chip] += 1;
    }
  }
  return { chips, scopes };
}
