import { useEffect, useState, type ReactNode } from "react";

/** Runs `run` in a later JS task; returns a cancel. */
export type ScheduleAfterPaint = (run: () => void) => () => void;

// React Native mounts every commit of a JS task at the end of that task, so the shell's commit
// reaches the screen before a render scheduled for a later task starts.
const scheduleAfterPaint: ScheduleAfterPaint = (run) => {
  const timer = setTimeout(run, 0);
  return () => clearTimeout(timer);
};

/**
 * Shows `shell` in the commit that mounts it and renders `children` in a later task. A push
 * renders the pushed screen inside the press's own commit, so a heavy screen held the press's
 * frame until all of it had rendered. Leaving before that task (Back) cancels it: the screen
 * never renders. Once shown, `children` stays. `enabled` is read at mount: off renders `children`
 * at once, in the same tree position, so it never remounts them.
 */
export function WorkspaceOpenGate({
  enabled,
  shell,
  children,
  schedule = scheduleAfterPaint,
}: {
  enabled: boolean;
  shell: ReactNode;
  children: ReactNode;
  schedule?: ScheduleAfterPaint;
}) {
  const [opened, setOpened] = useState(!enabled);
  useEffect(() => {
    if (opened) return;
    return schedule(() => setOpened(true));
  }, [opened, schedule]);
  return opened ? children : shell;
}
