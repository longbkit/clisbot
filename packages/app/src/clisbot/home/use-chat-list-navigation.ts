import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useNavigationContainerRef, usePathname } from "expo-router";
import { isNative } from "@/constants/platform";
import { usePanelStore, type MobilePanelSelection } from "@/stores/panel-store";
import { HOME_V2_ENABLED } from "./feature";
import { rememberChatReturn } from "./mobile-navigation";

interface PresentedRoute {
  key: string;
  name: string;
  params?: object;
}
interface TransitionEvent {
  target?: string;
  data: { closing: boolean };
}

// Query hints (open/pop) can change without presenting a different native screen.
function routeIdentity(route: PresentedRoute): string {
  const params = route.params as Record<string, unknown> | undefined;
  return JSON.stringify([
    route.key,
    route.name,
    params?.serverId,
    params?.workspaceId,
    params?.agentId,
    params?.chatId,
    params?.botId,
  ]);
}

function destinationPath(route: PresentedRoute): string {
  const params = route.params as Record<string, unknown> | undefined;
  const name = route.name.replace(/\/index$/, "");
  const hostLeaf = /^(workspace|agent|chat|bot)\//.test(name);
  const template = hostLeaf ? `h/[serverId]/${name}` : name;
  return (
    "/" +
    template.replace(/\[([^\]]+)\]/g, (_, key: string) =>
      encodeURIComponent(String(params?.[key] ?? "")),
    )
  );
}

/** One outgoing Chat intent, bound to the requested destination BEFORE Expo queues dispatch. */
export function createChatListPresentation() {
  interface Intent {
    panel: MobilePanelSelection;
    destination: string;
    close: () => void;
  }
  let pending: Intent | null = null;
  const appearing = new Map<string, { revision: number; identity: string }>();
  function isPending(panel: MobilePanelSelection) {
    if (pending && (panel.target !== "agent-list" || panel.revision !== pending.panel.revision)) {
      pending = null;
      appearing.clear();
    }
    return pending !== null;
  }
  return {
    begin(panel: MobilePanelSelection, destination: string, close: () => void) {
      if (!pending) appearing.clear();
      isPending(panel);
      const intent: Intent = { panel, destination: destination.split(/[?#]/, 1)[0]!, close };
      pending = intent;
      return () => {
        if (pending === intent) {
          pending = null;
          appearing.clear();
        }
      };
    },
    isPending,
    transitionStart(event: TransitionEvent, current: PresentedRoute | undefined) {
      if (!event.target) return;
      appearing.delete(event.target);
      if (event.data.closing || !pending || current?.key !== event.target) return;
      appearing.set(event.target, {
        revision: pending.panel.revision,
        identity: routeIdentity(current),
      });
    },
    transitionEnd(
      event: TransitionEvent,
      current: PresentedRoute | undefined,
      panel: MobilePanelSelection,
    ) {
      if (!isPending(panel) || !event.target) return;
      const started = appearing.get(event.target);
      appearing.delete(event.target);
      if (
        event.data.closing ||
        !pending ||
        !started ||
        current?.key !== event.target ||
        started.revision !== panel.revision ||
        started.identity !== routeIdentity(current) ||
        destinationPath(current) !== pending.destination
      )
        return;
      const { close } = pending;
      pending = null;
      close();
    },
  };
}

const nativePresentation = createChatListPresentation();

/** Native-stack onAppear owns presentation; a parent navigator appearing cannot reveal a leaf. */
export function useChatListScreenListeners() {
  const navigation = useNavigationContainerRef();
  return useMemo(
    () => ({
      transitionStart: (event: TransitionEvent) => {
        if (HOME_V2_ENABLED && isNative)
          nativePresentation.transitionStart(event, navigation.getCurrentRoute());
      },
      transitionEnd: (event: TransitionEvent) => {
        if (HOME_V2_ENABLED && isNative)
          nativePresentation.transitionEnd(
            event,
            navigation.getCurrentRoute(),
            usePanelStore.getState().mobilePanel,
          );
      },
    }),
    [navigation],
  );
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
      const panel = usePanelStore.getState().mobilePanel;
      const departing =
        HOME_V2_ENABLED && isNative && (path === "/chat" || nativePresentation.isPending(panel));
      if (departing && destination) {
        cancelPending.current = nativePresentation.begin(panel, destination, closeList);
      } else {
        cancelPending.current?.();
        // An overlay over an already presented workspace closes even for another tab in that workspace.
        if (!HOME_V2_ENABLED || isNative || path !== "/chat") closeList();
      }
    },
    [closeList, path],
  );
}
