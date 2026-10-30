import { useEffect, useState } from "react";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { subscribeToRelativeTimeTick } from "@/utils/relative-time-ticker";

const MINUTE = 60_000;

/**
 * The current time as a render input, updated while a relative-time label is mounted and its
 * retained panel is shown. Showing the panel again catches up a clock that fell a minute behind.
 */
export function useRelativeTimeTick({ enabled }: { enabled: boolean }): number {
  const active = useRetainedPanelActive();
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!enabled || !active) return undefined;
    setNow((previous) => (Date.now() - previous < MINUTE ? previous : Date.now()));
    return subscribeToRelativeTimeTick("minute", () => setNow(Date.now()));
  }, [enabled, active]);
  return now;
}
