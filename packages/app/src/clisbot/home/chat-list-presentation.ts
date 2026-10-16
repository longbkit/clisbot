import type { MobilePanelSelection } from "@/stores/panel-store";

export interface PresentedRoute {
  key: string;
  name: string;
  params?: object;
}
export interface TransitionEvent {
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
    returning?: boolean;
  }
  let pending: Intent | null = null;
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  const appearing = new Map<string, { revision: number; identity: string }>();
  function cancel() {
    if (!pending) return;
    pending = null;
    appearing.clear();
    publish();
  }
  function isPending(panel: MobilePanelSelection) {
    if (pending && (panel.target !== "agent-list" || panel.revision !== pending.panel.revision)) {
      pending = null;
      appearing.clear();
      publish();
    }
    return pending !== null;
  }
  return {
    cancel,
    didReturnToList() {
      if (pending?.returning) cancel();
    },
    returnToList() {
      if (!pending) return;
      pending.returning = true;
      appearing.clear();
      // Keep the outgoing projection until /chat commits or its panel generation changes.
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getPendingDestination() {
      return pending?.destination ?? null;
    },
    getPendingRevision() {
      return pending?.panel.revision ?? null;
    },
    begin(panel: MobilePanelSelection, destination: string, close: () => void) {
      if (!pending) appearing.clear();
      isPending(panel);
      const intent: Intent = { panel, destination: destination.split(/[?#]/, 1)[0]!, close };
      pending = intent;
      publish();
      return () => {
        if (pending === intent) {
          cancel();
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
        pending.returning ||
        !started ||
        current?.key !== event.target ||
        started.revision !== panel.revision ||
        started.identity !== routeIdentity(current) ||
        destinationPath(current) !== pending.destination
      )
        return;
      const { close } = pending;
      pending = null;
      publish();
      close();
    },
  };
}

export const nativePresentation = createChatListPresentation();
