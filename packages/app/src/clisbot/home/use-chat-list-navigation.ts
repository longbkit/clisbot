import { useCallback, useLayoutEffect, useRef } from "react";
import { usePathname } from "expo-router";
import { HOME_V2_ENABLED } from "./feature";
import { rememberChatReturn } from "./mobile-navigation";

/** Keep the Chat page in view until its destination commits, rather than exposing its backdrop. */
export function useChatListNavigation(closeList: () => void): () => void {
  const path = usePathname();
  const previousPath = useRef(path);
  useLayoutEffect(() => {
    if (HOME_V2_ENABLED && previousPath.current === "/chat" && path !== "/chat") {
      closeList();
    }
    previousPath.current = path;
  }, [closeList, path]);

  return useCallback(() => {
    if (HOME_V2_ENABLED) rememberChatReturn("/chat");
    // An overlay opened over the current workspace must still close when choosing another
    // agent in that workspace: preparing that tab need not change the route's pathname.
    if (!HOME_V2_ENABLED || path !== "/chat") closeList();
  }, [closeList, path]);
}
