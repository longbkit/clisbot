import { traceTimelinePhase } from "@/performance/timeline-trace";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useIsChatListDeparting } from "@/clisbot/home/use-chat-list-departure";

/** Runs `run` in a later JS task; returns a cancel. */
export type SchedulePreparation = (run: () => void) => () => void;

// React Native mounts every commit of a JS task at the end of that task, so the placeholder's
// commit reaches the screen before a render scheduled for a later task starts.
const scheduleInNextTask: SchedulePreparation = (run) => {
  const timer = setTimeout(run, 0);
  return () => clearTimeout(timer);
};

/** Separate the first native pane commit from the already usable header/Back surface. */
export function WorkspaceEntryContent({
  nativeCompact,
  focused,
  placeholder,
  children,
  serverId,
  agentId,
  schedule = scheduleInNextTask,
}: {
  nativeCompact: boolean;
  focused: boolean;
  placeholder: ReactNode;
  children: ReactNode;
  serverId?: string;
  agentId?: string;
  schedule?: SchedulePreparation;
}) {
  return nativeCompact ? (
    <NativeWorkspaceEntryContent
      focused={focused}
      placeholder={placeholder}
      serverId={serverId}
      agentId={agentId}
      schedule={schedule}
    >
      {children}
    </NativeWorkspaceEntryContent>
  ) : (
    children
  );
}

/**
 * The body renders in a later task as one ordinary render, never as a deferred (transition)
 * render. A transition render is interruptible: every store update that lands while it runs
 * throws its progress away. Opening a session while Hosts connect delivers updates every few
 * frames, so the body restarted until React's 5 s transition expiry and the session showed the
 * placeholder spinner for seconds (docs/features/offline/offline-cache.md#the-open-shell).
 */
function NativeWorkspaceEntryContent({
  focused,
  placeholder,
  children,
  serverId,
  agentId,
  schedule,
}: {
  focused: boolean;
  placeholder: ReactNode;
  children: ReactNode;
  serverId?: string;
  agentId?: string;
  schedule: SchedulePreparation;
}) {
  const departing = useIsChatListDeparting();
  const wanted = focused && !departing;
  const [prepared, setPrepared] = useState(false);
  // Back or a new destination before the scheduled task cancels it: the body never renders.
  useEffect(() => {
    if (!wanted || prepared) return;
    return schedule(() => setPrepared(true));
  }, [wanted, prepared, schedule]);
  const committed = useRef(false);
  const bodyVisible = committed.current || (wanted && prepared);
  useLayoutEffect(() => {
    if (bodyVisible) committed.current = true;
  }, [bodyVisible]);
  useLayoutEffect(() => {
    if (serverId && agentId)
      traceTimelinePhase("body.commit", serverId, agentId, {
        body: String(bodyVisible),
        focused: String(focused),
        departing: String(departing),
      });
  }, [serverId, agentId, bodyVisible, focused, departing]);
  // Once committed, existing retained panels keep their drafts, scroll and subscriptions;
  // their own activity/demand rules still apply. Never remount them just to prepare again.
  return bodyVisible ? children : placeholder;
}
