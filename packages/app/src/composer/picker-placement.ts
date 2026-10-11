import { createContext, useContext } from "react";
import type { ComboboxDesktopPlacement } from "@/components/ui/combobox";

/**
 * Which way the composer's desktop pickers (model, thinking, mode, features) open. A composer at
 * the bottom of a conversation opens them upward; one near the top of the page, as on Home, opens
 * them downward so a tall list is not cut off by the window. Web popovers do not flip on their own.
 */
const ComposerPickerPlacementContext = createContext<ComboboxDesktopPlacement>("top-start");

export const ComposerPickerPlacementProvider = ComposerPickerPlacementContext.Provider;

export function useComposerPickerPlacement(): ComboboxDesktopPlacement {
  return useContext(ComposerPickerPlacementContext);
}
