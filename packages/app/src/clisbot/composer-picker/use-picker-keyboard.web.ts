import { useEffect, useRef } from "react";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { resolvePickerKey } from "./picker-keys";
import { moveHighlight } from "./picker-rows";
import type { PickerKeyboardInput } from "./use-picker-keyboard.types";

/**
 * While the panel is open it takes ⌘1…⌘9, the arrows and Enter before anything else on the page
 * (capture phase), so the app's own ⌘N shortcuts do not fire behind it. Escape stays with the
 * Combobox, which closes the panel.
 */
export function usePickerKeyboard(input: PickerKeyboardInput): void {
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    if (!input.enabled) return undefined;
    const handle = (event: KeyboardEvent) => {
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
