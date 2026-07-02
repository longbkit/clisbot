// Shared pane-state comparison helpers used by paste/submit settlement and
// post-status settle polling.

import type { TmuxPaneState } from "./client.ts";

export function hasPaneStateChanged(left: TmuxPaneState, right: TmuxPaneState) {
  return (
    left.cursorX !== right.cursorX ||
    left.cursorY !== right.cursorY ||
    left.historySize !== right.historySize
  );
}

export function arePaneStatesEqual(left: TmuxPaneState, right: TmuxPaneState) {
  return (
    left.cursorX === right.cursorX &&
    left.cursorY === right.cursorY &&
    left.historySize === right.historySize
  );
}
