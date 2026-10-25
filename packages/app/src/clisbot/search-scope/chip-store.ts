import { addSearchScopeChips, removeSearchScopeChip, type SearchScopeChip } from "./model";
import { createValueStore, useValueStore } from "./value-store";

/** Reopening search this soon after closing it brings the chips back (R5). */
export const CHIP_RESTORE_WINDOW_MS = 10_000;

const EMPTY: readonly SearchScopeChip[] = [];
const chips = createValueStore<readonly SearchScopeChip[]>(EMPTY);
let closedAt: number | null = null;

/** The chips in render. */
export function useSearchScopeChips(): readonly SearchScopeChip[] {
  return useValueStore(chips);
}

/** Session-only scope chips. Never persisted: they belong to one search, not to the device. */
export const searchScopeChips = {
  get: chips.get,
  subscribe: chips.subscribe,
  add(added: readonly SearchScopeChip[]) {
    chips.set(addSearchScopeChips(chips.get(), added));
  },
  remove(id: string) {
    chips.set(removeSearchScopeChip(chips.get(), id));
  },
  /** Backspace on an empty input. False when there was nothing to remove. */
  removeLast(): boolean {
    const current = chips.get();
    if (current.length === 0) return false;
    chips.set(current.slice(0, -1));
    return true;
  },
  /** Drop every chip of one kind (the empty state's "Remove Host filter"). */
  removeKind(kinds: readonly SearchScopeChip["kind"][]) {
    chips.set(chips.get().filter((chip) => !kinds.includes(chip.kind)));
  },
  clear() {
    chips.set(EMPTY);
  },
  opened(now: number) {
    if (closedAt === null || now - closedAt > CHIP_RESTORE_WINDOW_MS) chips.set(EMPTY);
    closedAt = null;
  },
  closed(now: number) {
    closedAt = now;
  },
};
