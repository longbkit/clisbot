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

/**
 * The reader's own pins by default; every other pin, including one nobody can place yet, folds
 * into one `+N · Show` tag.
 */
export function splitPinTags<T extends PinTag>(tags: readonly T[], mode: HomeMode) {
  const visible = tags.filter((tag) => pinTagMatchesMode(tag, mode) && tag.title);
  return {
    mine: visible.filter((tag) => tag.ownership === "mine"),
    others: visible.filter((tag) => tag.ownership !== "mine"),
  };
}

/**
 * How many tags fit on `lines` wrapped lines of `width`, leaving room on the last line for the
 * "+N" tag when some do not fit. Tags keep their order; a tag wider than a line takes a line.
 */
export function fitPinTags(
  widths: readonly number[],
  layout: { width: number; gap: number; moreWidth: number; lines?: number },
): number {
  const lines = layout.lines ?? 2;
  const fits = (count: number, reserve: number) => {
    let line = 1;
    let used = 0;
    for (let i = 0; i < count + (reserve ? 1 : 0); i += 1) {
      const next = i < count ? widths[i]! : reserve;
      const needed = used === 0 ? next : used + layout.gap + next;
      if (needed <= layout.width || used === 0) used = needed;
      else {
        line += 1;
        used = next;
      }
      if (line > lines) return false;
    }
    return true;
  };
  if (fits(widths.length, 0)) return widths.length;
  let count = widths.length - 1;
  while (count > 0 && !fits(count, layout.moreWidth)) count -= 1;
  return count;
}
