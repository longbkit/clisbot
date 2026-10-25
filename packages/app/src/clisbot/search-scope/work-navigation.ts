import { usePanelStore } from "@/stores/panel-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { createValueStore } from "./value-store";

/**
 * The seam between search and the list a filter belongs to (docs/features/global-search). Search
 * owns chips; the Work list owns its view filter. On `main` the Work list is the sidebar, so the
 * defaults below drive the sidebar filters. Navigation V2 replaces them with its own handlers.
 */

/** A view filter as a section publishes it: names, never internal keys. */
export interface PublishedViewFilter {
  /** What the suggestion chip calls it, e.g. "sandbox-12" or "sandbox-12 · clisbot". */
  label: string;
  serverIds: readonly string[] | null;
  projectNames: readonly string[] | null;
}

const publishedViewFilter = createValueStore<PublishedViewFilter | null>(null);

/** The opening section publishes its filter; null falls back to the sidebar filters on `main`. */
export function setSearchViewContext(filter: PublishedViewFilter | null): void {
  publishedViewFilter.set(filter);
}

export const usePublishedViewFilter = publishedViewFilter.use;

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

/** R4 on `main`: replace the sidebar's Host and Project filters, open the sidebar. */
const sidebarOpenInWork: OpenInWorkHandler = (target, layout) => {
  const store = useSidebarViewStore;
  const previous = {
    hostFilters: store.getState().hostFilters,
    projectFilters: store.getState().projectFilters,
  };
  // Replace only the dimensions the target names; the other keeps what the user set.
  store.setState({
    ...(target.serverIds.length > 0 ? { hostFilters: [...target.serverIds] } : {}),
    ...(target.projectViewKeys.length > 0 ? { projectFilters: [...target.projectViewKeys] } : {}),
  });
  usePanelStore.getState().openAgentListForLayout(layout);
  return () => store.setState(previous);
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

/**
 * Opening an item the view filter hides (R3). The list keeps its filter and renders, while this
 * is set, one notice row: "This session is outside your filter · Show all · Switch to {host}".
 */
export interface OutsideFilterReveal {
  itemKind: "workspace" | "session";
  serverId: string;
  hostLabel: string;
  projectName: string | null;
  /** Which filter dimension hides it; "others" is Navigation V2's For me / Others scope. */
  reason: "host" | "project" | "others";
}

const outsideFilterReveal = createValueStore<OutsideFilterReveal | null>(null);

export function setOutsideFilterReveal(reveal: OutsideFilterReveal | null): void {
  outsideFilterReveal.set(reveal);
}

export function dismissOutsideFilterReveal(): void {
  outsideFilterReveal.set(null);
}

export const useOutsideFilterReveal = outsideFilterReveal.use;
export const getOutsideFilterReveal = outsideFilterReveal.get;
