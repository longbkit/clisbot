import { traceTimelinePhase } from "@/performance/timeline-trace";
import { useDeferredValue, useLayoutEffect, useRef, type ReactNode } from "react";
import { useIsChatListDeparting } from "@/clisbot/home/use-chat-list-departure";

/** Separate the first native pane commit from the already usable header/Back surface. */
export function WorkspaceEntryContent({
  nativeCompact,
  focused,
  placeholder,
  children,
  serverId,
  agentId,
}: {
  nativeCompact: boolean;
  focused: boolean;
  placeholder: ReactNode;
  children: ReactNode;
  serverId?: string;
  agentId?: string;
}) {
  return nativeCompact ? (
    <NativeWorkspaceEntryContent
      focused={focused}
      placeholder={placeholder}
      serverId={serverId}
      agentId={agentId}
    >
      {children}
    </NativeWorkspaceEntryContent>
  ) : (
    children
  );
}

function NativeWorkspaceEntryContent({
  focused,
  placeholder,
  children,
  serverId,
  agentId,
}: {
  focused: boolean;
  placeholder: ReactNode;
  children: ReactNode;
  serverId?: string;
  agentId?: string;
}) {
  const departing = useIsChatListDeparting();
  const prepared = useDeferredValue(focused && !departing, false);
  const committed = useRef(false);
  useLayoutEffect(() => {
    if (focused && prepared) committed.current = true;
  }, [focused, prepared]);
  const bodyVisible = committed.current || (focused && prepared);
  useLayoutEffect(() => {
    if (serverId && agentId)
      traceTimelinePhase("body.commit", serverId, agentId, {
        body: String(bodyVisible),
        focused: String(focused),
        departing: String(departing),
      });
  }, [serverId, agentId, bodyVisible, focused, departing]);
  // An urgent Back/new destination can abandon background preparation before it commits.
  // Once committed, existing retained panels keep their drafts, scroll and subscriptions;
  // their own activity/demand rules still apply. Never remount them just to prepare again.
  return bodyVisible ? children : placeholder;
}
