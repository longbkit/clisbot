import type { SearchViewContext } from "./candidates";
import type { SearchScopeCatalog } from "./catalog";
import { isInView, type ItemPlacement } from "./items";
import type { ScopeT } from "./rows";
import type { OutsideFilterReveal } from "./work-navigation";

export interface ItemAnnotation {
  /** Muted text after the subtitle: "Outside filter", "Offline · cached 10:42". */
  note: string | null;
  /** Published when the item is opened; null clears an earlier one. */
  reveal: OutsideFilterReveal | null;
}

const NONE: ItemAnnotation = { note: null, reveal: null };

function offlineNote(
  serverId: string,
  catalog: SearchScopeCatalog,
  t: ScopeT,
  formatTime: (iso: string) => string,
) {
  const host = catalog.hostById.get(serverId);
  if (!host || host.status !== "offline") return null;
  return host.lastOnlineAt
    ? t("note.offlineCached", { time: formatTime(host.lastOnlineAt) })
    : t("note.offline");
}

function hiddenBy(
  view: SearchViewContext,
  placement: ItemPlacement,
): OutsideFilterReveal["reason"] {
  return view.serverIds && !view.serverIds.has(placement.serverId) ? "host" : "project";
}

/** How a workspace or session row is labelled, and what opening it tells the list (R3, R7). */
export function annotateItem(input: {
  itemKind: OutsideFilterReveal["itemKind"];
  placement: ItemPlacement;
  catalog: SearchScopeCatalog;
  view: SearchViewContext | null;
  t: ScopeT;
  formatTime(iso: string): string;
}): ItemAnnotation {
  const { placement, catalog, view, t } = input;
  const offline = offlineNote(placement.serverId, catalog, t, input.formatTime);
  const outside = view !== null && !isInView(view, placement);
  if (!offline && !outside) return NONE;
  const note = [outside ? t("note.outsideFilter") : null, offline].filter(Boolean).join(" · ");
  if (!outside || !view) return { note, reveal: null };
  const host = catalog.hostById.get(placement.serverId);
  return {
    note,
    reveal: {
      itemKind: input.itemKind,
      serverId: placement.serverId,
      hostLabel: host?.label ?? placement.serverId,
      projectName: placement.projectKey
        ? (catalog.projectByKey.get(placement.projectKey)?.label ?? null)
        : null,
      reason: hiddenBy(view, placement),
    },
  };
}
