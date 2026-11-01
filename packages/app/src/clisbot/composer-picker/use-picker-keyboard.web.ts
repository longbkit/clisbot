import { useEffect, useRef } from "react";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { resolvePickerKey } from "./picker-keys";
import { moveHighlight } from "./picker-rows";
import type { PickerKeyboardInput } from "./use-picker-keyboard.types";

/**
 * Where the panel's keys apply: the search field, a model row, a rail entry, or nothing
 * focused. Anywhere else (the footer's Mode dropdown and speed segments, a provider menu, Retry,
 * the Provider settings sheet over the panel) keeps its own keys.
 */
const PICKER_KEY_SCOPE = [
  '[data-testid="composer-picker-search"]',
  '[data-testid^="composer-picker-model-"]',
  '[data-testid^="composer-picker-rail-"]',
].join(", ");

export function isPickerKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target === document.body) return true;
  return target.closest(PICKER_KEY_SCOPE) !== null;
}

/**
 * While the panel is open it takes ⌘1…⌘9, the arrows and Enter from its own scope before
 * anything else on the page (capture phase), so the app's own ⌘N shortcuts do not fire behind
 * it. Escape stays with the Combobox, which closes the panel.
 */
export function usePickerKeyboard(input: PickerKeyboardInput): void {
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    if (!input.enabled) return undefined;
    const handle = (event: KeyboardEvent) => {
      if (!isPickerKeyTarget(event.target)) return;
      const action = resolvePickerKey(event, getShortcutOs());
      const current = latest.current;
      if (!action || current.rowCount === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (action.kind === "pick") {
        if (action.index < current.rowCount) current.onPickIndex(action.index);
        return;
      }
      if (action.kind === "move") {
        current.setHighlight(moveHighlight(current.highlight, current.rowCount, action.key));
        return;
      }
      current.onPickIndex(current.highlight >= 0 ? current.highlight : 0);
    };
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  }, [input.enabled]);
}
