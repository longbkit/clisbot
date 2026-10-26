import type { SearchViewContext } from "./candidates";
import type { SearchScopeCatalog } from "./catalog";
import { hiddenBy, type ItemPlacement } from "./items";
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

/** How a workspace or session row is labelled, and what opening it tells the list (R3, R7). */
export function annotateItem(input: {
  itemKind: OutsideFilterReveal["itemKind"];
  placement: ItemPlacement;
  catalog: SearchScopeCatalog;
  view: SearchViewContext | null;
  t: ScopeT;
  formatTime(iso: string): string;
}): ItemAnnotation {
  const { placement, catalog, t } = input;
  const offline = offlineNote(placement.serverId, catalog, t, input.formatTime);
  const reason = hiddenBy(input.view, placement);
  const outside = reason === "host" || reason === "project";
  const others = placement.ownership === "others";
  if (!offline && !outside && !others) return NONE;
  const note = [outside ? t("note.outsideFilter") : null, others ? t("note.others") : null, offline]
    .filter(Boolean)
    .join(" · ");
  if (!reason) return { note, reveal: null };
  const host = catalog.hostById.get(placement.serverId);
  const project = placement.projectKey ? catalog.projectByKey.get(placement.projectKey) : null;
  return {
    note,
    reveal: {
      itemKind: input.itemKind,
      serverId: placement.serverId,
      hostLabel: host?.label ?? placement.serverId,
      projectName: project?.label ?? null,
      projectViewKeys: project ? [...project.viewKeys] : [],
      reason,
      target: placement.workspaceId
        ? { kind: "workspace", serverId: placement.serverId, id: placement.workspaceId }
        : null,
    },
  };
}
