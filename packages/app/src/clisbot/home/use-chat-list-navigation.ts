import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useNavigationContainerRef, usePathname } from "expo-router";
import { traceInstant } from "@/performance/native-trace";
import { isNative } from "@/constants/platform";
import { usePanelStore } from "@/stores/panel-store";
import { HOME_V2_ENABLED } from "./feature";
import { rememberChatReturn } from "./mobile-navigation";

import {
  nativePresentation,
  type PresentedRoute,
  type TransitionEvent,
} from "./chat-list-presentation";
export { createChatListPresentation } from "./chat-list-presentation";

/** Native-stack onAppear owns presentation; a parent navigator appearing cannot reveal a leaf. */
export function useChatListScreenListeners() {
  const navigation = useNavigationContainerRef();
  return useMemo(
    () => ({
      state: () => {
        if (HOME_V2_ENABLED && isNative && navigation.getCurrentRoute()?.name === "chat")
          nativePresentation.didReturnToList();
      },
      transitionStart: (event: TransitionEvent) => {
        if (HOME_V2_ENABLED && isNative) {
          traceInstant("clisbot.list.native", {
            event: event.data.closing ? "willHide" : "willShow",
            key: event.target ?? "none",
          });
          nativePresentation.transitionStart(
            event,
            navigation.getCurrentRoute(),
            usePanelStore.getState().mobilePanel,
          );
        }
      },
      transitionEnd: (event: TransitionEvent) => {
        if (HOME_V2_ENABLED && isNative) {
          traceInstant("clisbot.list.native", {
            event: event.data.closing ? "didHide" : "didShow",
            key: event.target ?? "none",
          });
          nativePresentation.transitionEnd(
            event,
            navigation.getCurrentRoute(),
            usePanelStore.getState().mobilePanel,
          );
        }
      },
    }),
    [navigation],
  );
}

/** A focused native leaf can change params while its native screen remains presented. */
export function useChatListPresentedLeaf(route: PresentedRoute, focused: boolean) {
  useLayoutEffect(() => {
    if (!HOME_V2_ENABLED || !isNative || !focused) return;
    const release = nativePresentation.commitLeaf(route, usePanelStore.getState().mobilePanel);
    traceInstant("clisbot.list.leaf", {
      key: route.key,
      pending: String(nativePresentation.getPendingRevision()),
    });
    return release;
  }, [focused, route]);
}

/** Keep Chat visible until its destination commits (web) or appears (native). */
export function useChatListNavigation(closeList: () => void): (destination?: string) => void {
  const path = usePathname();
  const previousPath = useRef(path);
  const cancelPending = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    if (HOME_V2_ENABLED && !isNative && previousPath.current === "/chat" && path !== "/chat")
      closeList();
    if (path === "/chat" && previousPath.current !== "/chat") cancelPending.current?.();
    previousPath.current = path;
  }, [closeList, path]);
  useLayoutEffect(() => () => cancelPending.current?.(), []);
  return useCallback(
    (destination?: string) => {
      if (HOME_V2_ENABLED) rememberChatReturn("/chat");
      // Read the last committed path: Expo may still have a newer intent queued for dispatch.
      const committedPath = previousPath.current;
      const panel = usePanelStore.getState().mobilePanel;
      const departing =
        HOME_V2_ENABLED &&
        isNative &&
        (committedPath === "/chat" || nativePresentation.isPending(panel));
      if (departing && destination) {
        cancelPending.current = nativePresentation.begin(panel, destination, closeList);
      } else {
        cancelPending.current?.();
        // An overlay over an already presented workspace closes even for another tab in that workspace.
        if (!HOME_V2_ENABLED || isNative || committedPath !== "/chat") closeList();
      }
    },
    [closeList],
  );
}
