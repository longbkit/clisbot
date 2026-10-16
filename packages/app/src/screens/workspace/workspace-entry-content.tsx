import { useDeferredValue, useLayoutEffect, useRef, type ReactNode } from "react";
import { useIsChatListDeparting } from "@/clisbot/home/use-chat-list-departure";

/** Separate the first native pane commit from the already usable header/Back surface. */
export function WorkspaceEntryContent({
  nativeCompact,
  focused,
  placeholder,
  children,
}: {
  nativeCompact: boolean;
  focused: boolean;
  placeholder: ReactNode;
  children: ReactNode;
}) {
  return nativeCompact ? (
    <NativeWorkspaceEntryContent focused={focused} placeholder={placeholder}>
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
}: {
  focused: boolean;
  placeholder: ReactNode;
  children: ReactNode;
}) {
  const departing = useIsChatListDeparting();
  const prepared = useDeferredValue(focused && !departing, false);
  const committed = useRef(false);
  useLayoutEffect(() => {
    if (focused && prepared) committed.current = true;
  }, [focused, prepared]);
  // An urgent Back/new destination can abandon background preparation before it commits.
  // Once committed, existing retained panels keep their drafts, scroll and subscriptions;
  // their own activity/demand rules still apply. Never remount them just to prepare again.
  return committed.current || (focused && prepared) ? children : placeholder;
}
