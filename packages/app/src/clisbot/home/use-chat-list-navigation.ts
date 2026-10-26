import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useNavigationContainerRef, usePathname } from "expo-router";
import { startArmedHermesSampling, traceInstant } from "@/performance/native-trace";
import { isNative } from "@/constants/platform";
import { usePanelStore } from "@/stores/panel-store";
import { HOME_V2_ENABLED } from "./feature";
import { currentListTabPath, isListTabPath, rememberChatReturn } from "./mobile-navigation";

import {
  nativePresentation,
  type PresentedRoute,
  type TransitionEvent,
} from "./chat-list-presentation";
export { createChatListPresentation } from "./chat-list-presentation";

/** The list tabs' route names: Chat, and Navigation V2's Work. */
function isListRouteName(name: string | undefined): boolean {
  return name !== undefined && isListTabPath(`/${name}`);
}

/** Native-stack onAppear owns presentation; a parent navigator appearing cannot reveal a leaf. */
export function useChatListScreenListeners() {
  const navigation = useNavigationContainerRef();
  return useMemo(
    () => ({
      state: () => {
        if (
          HOME_V2_ENABLED &&
          isNative &&
          isListRouteName((navigation.getCurrentRoute() as PresentedRoute | undefined)?.name)
        )
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
            navigation.getCurrentRoute() as PresentedRoute | undefined,
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
            navigation.getCurrentRoute() as PresentedRoute | undefined,
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

/** A row's pre-navigation hook; true means it now owns the `go` route dispatch. */
export type ChatListAdmission = (destination?: string, go?: () => void) => boolean | void;

/**
 * Keep Chat visible until its destination commits (web) or appears (native).
 *
 * A caller that passes its route dispatch as `go` hands it to this owner, which returns true. A
 * native admission then runs `go` in a later JS task: React Native mounts a task's commits together
 * at its end, and React Navigation renders the pushed screen synchronously, so dispatching in the
 * press task would hold the Back/loading shell until the whole destination had rendered. Without
 * `go`, or when false is returned, the caller dispatches itself as before.
 */
export function useChatListNavigation(
  closeList: () => void,
): (destination?: string, go?: () => void) => boolean {
  const path = usePathname();
  const previousPath = useRef(path);
  const cancelPending = useRef<(() => void) | undefined>(undefined);
  // Destinations this owner already dispatched: Expo may commit one after a newer row was admitted.
  const dispatched = useRef(new Set<string>());
  useLayoutEffect(() => {
    if (HOME_V2_ENABLED && !isNative && isListTabPath(previousPath.current) && !isListTabPath(path))
      closeList();
    if (isListTabPath(path) && !isListTabPath(previousPath.current)) cancelPending.current?.();
    if (isListTabPath(path)) dispatched.current.clear();
    previousPath.current = path;
  }, [closeList, path]);
  useLayoutEffect(() => () => cancelPending.current?.(), []);
  return useCallback(
    (destination?: string, go?: () => void) => {
      // Exact route must match the external one-shot arm; production/profile-off is a no-op.
      if (isNative && destination) startArmedHermesSampling(destination);
      // Read the last committed path: Expo may still have a newer intent queued for dispatch.
      const committedPath = previousPath.current;
      if (HOME_V2_ENABLED)
        rememberChatReturn(isListTabPath(committedPath) ? committedPath : currentListTabPath());
      const panel = usePanelStore.getState().mobilePanel;
      const departing =
        HOME_V2_ENABLED &&
        isNative &&
        (isListTabPath(committedPath) || nativePresentation.isPending(panel));
      if (departing && destination) {
        cancelPending.current = nativePresentation.begin(panel, destination, closeList, {
          dispatched: !go,
        });
        if (!go) return false;
        const id = nativePresentation.getPendingSnapshot()?.id;
        const requested = destination.split(/[?#]/, 1)[0]!;
        setTimeout(() => {
          if (id === undefined) return;
          // A newer global route (Settings, a Home tab) committed while this push waited. Only
          // Chat itself or an earlier admission's own destination may have landed since.
          const current = previousPath.current;
          if (current !== committedPath && !dispatched.current.has(current)) {
            if (nativePresentation.getPendingSnapshot()?.id === id) nativePresentation.cancel();
            return;
          }
          // Back, a newer row or another panel generation may have replaced this admission.
          if (!nativePresentation.dispatch(id, usePanelStore.getState().mobilePanel)) return;
          dispatched.current.add(requested);
          go();
        }, 0);
        return true;
      }
      cancelPending.current?.();
      // An overlay over an already presented workspace closes even for another tab in that workspace.
      if (!HOME_V2_ENABLED || isNative || !isListTabPath(committedPath)) closeList();
      return false;
    },
    [closeList],
  );
}
