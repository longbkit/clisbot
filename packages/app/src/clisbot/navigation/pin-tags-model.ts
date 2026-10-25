import type { HomeMode } from "./home-feed";
import type { Ownership } from "./ownership";

/** A pin as Home shows it: a compact tag (brief C8). */
export interface PinTag {
  key: string;
  title: string;
  /** Bot and chat pins are Chat items; projects, workspaces and sessions are Work. */
  area: "chat" | "work";
  ownership: Ownership;
}

export function pinTagMatchesMode(tag: Pick<PinTag, "area">, mode: HomeMode): boolean {
  return mode === "hybrid" || tag.area === mode;
}

/** The reader's own pins by default; other members' pins fold into one `+N · Show` tag. */
export function splitPinTags<T extends PinTag>(tags: readonly T[], mode: HomeMode) {
  const visible = tags.filter((tag) => pinTagMatchesMode(tag, mode) && tag.title);
  return {
    mine: visible.filter((tag) => tag.ownership === "mine"),
    others: visible.filter((tag) => tag.ownership === "others"),
  };
}
