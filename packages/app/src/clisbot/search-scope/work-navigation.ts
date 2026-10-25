import type { OwnershipScope } from "@/clisbot/navigation/ownership";
import { parseChatRouteFromPathname } from "@/clisbot/bots/routes";
import { usePanelStore } from "@/stores/panel-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { createValueStore, useValueStore } from "./value-store";

/**
 * The seam between search and the list a filter belongs to (docs/features/global-search). Search
 * owns chips; the Work list owns its view filter. On `main` the Work list is the sidebar, so the
 * defaults below drive the sidebar filters. Navigation V2 replaces them with its own handlers.
 */

/** A view filter as a list publishes it: Host ids, and projects by name or by view key. */
export interface PublishedViewFilter {
  /** What the suggestion chip calls it; defaults to the Host and project names. */
  label?: string;
  serverIds?: readonly string[] | null;
  projectNames?: readonly string[] | null;
  /** Upstream project view keys, as the sidebar's (and V2 Work's) project filter holds them. */
  projectViewKeys?: readonly string[] | null;
  /** For me / Others / All; omitted where the layout has no ownership scope. */
  ownership?: OwnershipScope | null;
  /** Offer "Only current filter" (R1): search was opened from this list. Defaults to true. */
  suggest?: boolean;
}

const publishedViewFilter = createValueStore<PublishedViewFilter | null>(null);

/** The Work list publishes its filter; null falls back to the sidebar filters on `main`. */
export function setSearchViewContext(filter: PublishedViewFilter | null): void {
  publishedViewFilter.set(filter);
}

export function usePublishedViewFilter(): PublishedViewFilter | null {
  return useValueStore(publishedViewFilter);
}

export interface OpenInWorkTarget {
  serverIds: readonly string[];
  projectNames: readonly string[];
  /** Upstream project view keys for those names, for list filters keyed that way. */
  projectViewKeys: readonly string[];
}

/** Applies the target as the view filter and returns the function that restores the old one. */
export type OpenInWorkHandler = (
  target: OpenInWorkTarget,
  layout: { isCompact: boolean },
) => () => void;

/** The sidebar's Host and Project filters, which Navigation V2's Work list also reads. */
export function replaceSidebarFilters(target: OpenInWorkTarget): () => void {
  const store = useSidebarViewStore;
  const previous = {
    hostFilters: store.getState().hostFilters,
    projectFilters: store.getState().projectFilters,
  };
  // Replace only the dimensions the target names; the other keeps what the user set (R4).
  store.setState({
    ...(target.serverIds.length > 0 ? { hostFilters: [...target.serverIds] } : {}),
    ...(target.projectViewKeys.length > 0 ? { projectFilters: [...target.projectViewKeys] } : {}),
  });
  return () => store.setState(previous);
}

/** R4 on `main`: replace the sidebar's Host and Project filters, open the sidebar. */
const sidebarOpenInWork: OpenInWorkHandler = (target, layout) => {
  const restore = replaceSidebarFilters(target);
  usePanelStore.getState().openAgentListForLayout(layout);
  return restore;
};

let openInWorkHandler: OpenInWorkHandler = sidebarOpenInWork;

/** Navigation V2 installs the Work pane's handler; the returned function restores the default. */
export function setOpenInWorkHandler(handler: OpenInWorkHandler): () => void {
  openInWorkHandler = handler;
  return () => {
    if (openInWorkHandler === handler) openInWorkHandler = sidebarOpenInWork;
  };
}

export function openInWork(target: OpenInWorkTarget, layout: { isCompact: boolean }): () => void {
  return openInWorkHandler(target, layout);
}

/** A page an opened item lives on; the notice holds only while one of them is showing. */
export interface RevealTarget {
  kind: "workspace" | "chat" | "bot";
  serverId: string;
  id: string;
}

/**
 * Opening an item its list's filter hides (R3). The list keeps its filter and renders, until the
 * reader opens another item, one notice row: "This session is outside your filter · Show
 * all · Switch to {host}", or "Shown from Others" when only For me / Others hides it.
 */
export interface OutsideFilterReveal {
  /** workspace and session belong to Work; chat to Chats. */
  itemKind: "workspace" | "session" | "chat";
  serverId: string;
  hostLabel: string;
  projectName: string | null;
  /** The project's view keys, so "Switch to {project}" can set a filter keyed that way. */
  projectViewKeys: readonly string[];
  /** Which filter dimension hides it; "others" is Navigation V2's For me / Others scope. */
  reason: "host" | "project" | "others";
  /** Null when the item has no page of its own to recognise (a session outside a workspace). */
  target: RevealTarget | null;
  /** Further pages that are the same item, such as a Bot's direct chat. */
  alsoTargets?: readonly RevealTarget[];
}

const BOT_ROUTE = /^\/h\/([^/]+)\/bot\/([^/?#]+)\/?(?:[?#].*)?$/;

/** The item page at `pathname`, read with the same parsers the routes use. */
export function revealTargetOfPath(pathname: string): RevealTarget | null {
  const workspace = parseHostWorkspaceRouteFromPathname(pathname);
  if (workspace)
    return { kind: "workspace", serverId: workspace.serverId, id: workspace.workspaceId };
  const chat = parseChatRouteFromPathname(pathname);
  if (chat) return { kind: "chat", serverId: chat.serverId, id: chat.chatId };
  const bot = BOT_ROUTE.exec(pathname);
  if (bot) {
    return { kind: "bot", serverId: decodeURIComponent(bot[1]!), id: decodeURIComponent(bot[2]!) };
  }
  return null;
}

/**
 * Whether opening the page at `pathname` ends the reveal: it is another item. List, Home and
 * settings pages keep it, because on a phone the list is its own page the reader goes back to.
 */
export function revealEndsOnPath(reveal: OutsideFilterReveal, pathname: string): boolean {
  const page = revealTargetOfPath(pathname);
  if (!page) return false;
  return ![reveal.target, ...(reveal.alsoTargets ?? [])].some(
    (target) =>
      target !== null &&
      target.kind === page.kind &&
      target.serverId === page.serverId &&
      target.id === page.id,
  );
}

const outsideFilterReveal = createValueStore<OutsideFilterReveal | null>(null);

export function setOutsideFilterReveal(reveal: OutsideFilterReveal | null): void {
  outsideFilterReveal.set(reveal);
}

export function dismissOutsideFilterReveal(): void {
  outsideFilterReveal.set(null);
}

export function useOutsideFilterReveal(): OutsideFilterReveal | null {
  return useValueStore(outsideFilterReveal);
}
export const getOutsideFilterReveal = outsideFilterReveal.get;
