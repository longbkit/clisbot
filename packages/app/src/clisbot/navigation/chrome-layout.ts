import { NAVIGATION_V2_ENABLED } from "./feature";

/**
 * Who owns the desktop's left edge. With Navigation V2 the rail stays beside the content, owns the
 * top-left window corner and toggles the list pane itself; otherwise the sidebar decides as before.
 */
export function resolveNavigationChrome(input: {
  compact: boolean;
  chromeEnabled: boolean;
  sidebarMounted: boolean;
  sidebarVisible: boolean;
  focusMode: boolean;
}) {
  if (!NAVIGATION_V2_ENABLED)
    return {
      railVisible: false,
      leftChromeRendered: input.sidebarVisible,
      sidebarControlsEnabled: input.chromeEnabled && !input.focusMode,
    };
  const railVisible = !input.compact && input.chromeEnabled && input.sidebarMounted;
  return { railVisible, leftChromeRendered: railVisible, sidebarControlsEnabled: false };
}
