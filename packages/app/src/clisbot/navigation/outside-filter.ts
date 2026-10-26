import type { OutsideFilterReveal, RevealTarget } from "@/clisbot/search-scope/work-navigation";
import { inScope, type Ownership, type OwnershipScope } from "./ownership";
import type { ListSection } from "./store";

/**
 * What a list hides by (docs/features/global-search/README.md, R3): Work's Host and Project
 * filters with its For me / Others scope, or Chats' Host filter with its scope.
 */
export interface ListFilter {
  serverIds: readonly string[];
  projectViewKeys: readonly string[];
  scope: OwnershipScope;
}

/** The list whose filter a revealed item belongs to. */
export function listOfReveal(reveal: OutsideFilterReveal): ListSection {
  return reveal.itemKind === "chat" ? "chats" : "work";
}

/**
 * Whether the reason the list hid the item still holds. Once the reader widens the filter some
 * other way, the notice has nothing left to say.
 */
export function revealStillHidden(reveal: OutsideFilterReveal, filter: ListFilter): boolean {
  if (reveal.reason === "host") {
    return filter.serverIds.length > 0 && !filter.serverIds.includes(reveal.serverId);
  }
  if (reveal.reason === "project") {
    return (
      filter.projectViewKeys.length > 0 &&
      !reveal.projectViewKeys.some((key) => filter.projectViewKeys.includes(key))
    );
  }
  return !inScope(filter.scope, "others");
}

/** The reveal for a chat opened from search, or null when Chats shows it (R3). */
export function chatReveal(
  chat: {
    serverId: string;
    hostLabel: string;
    ownership: Ownership;
    target: RevealTarget;
    alsoTargets?: readonly RevealTarget[];
  },
  filter: Pick<ListFilter, "serverIds" | "scope">,
): OutsideFilterReveal | null {
  let reason: OutsideFilterReveal["reason"] | null = null;
  if (filter.serverIds.length > 0 && !filter.serverIds.includes(chat.serverId)) reason = "host";
  else if (!inScope(filter.scope, chat.ownership)) reason = "others";
  if (!reason) return null;
  return {
    itemKind: "chat",
    serverId: chat.serverId,
    hostLabel: chat.hostLabel,
    projectName: null,
    projectViewKeys: [],
    reason,
    target: chat.target,
    alsoTargets: chat.alsoTargets,
  };
}

/** The notice's second action: switch the hiding dimension to the item's own, when it has one. */
export function switchLabelOf(reveal: OutsideFilterReveal): string | null {
  if (reveal.reason === "host") return reveal.hostLabel;
  if (reveal.reason === "project") return reveal.projectName;
  return null;
}
