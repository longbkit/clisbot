import type { MobilePanelSelection } from "@/stores/panel-store";

export interface PresentedRoute {
  key: string;
  name: string;
  params?: object;
}
export interface PendingChatIntent {
  readonly id: number;
  readonly revision: number;
  readonly destination: string;
  readonly returning: boolean;
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
    id: number;
    panel: MobilePanelSelection;
    destination: string;
    close: () => void;
    returning?: boolean;
  }
  let pending: Intent | null = null;
  let nextIntent = 0;
  let snapshot: PendingChatIntent | null = null;
  const listeners = new Set<() => void>();
  const publish = () => {
    snapshot = pending
      ? {
          id: pending.id,
          revision: pending.panel.revision,
          destination: pending.destination,
          returning: !!pending.returning,
        }
      : null;
    for (const listener of listeners) listener();
  };
  const appearing = new Map<string, { revision: number; identity: string }>();
  // Native visibility belongs to the screen key, not its changing workspace params.
  // A Back/re-entry can update the same native screen without another onAppear.
  const visibility = new Map<
    string,
    { shown: boolean; phase: "opening" | "presented" | "closing" }
  >();
  let committedLeaf: PresentedRoute | undefined;
  function complete(current: PresentedRoute, panel: MobilePanelSelection) {
    if (
      !isPending(panel) ||
      !pending ||
      pending.returning ||
      destinationPath(current) !== pending.destination
    )
      return;
    const { close } = pending;
    pending = null;
    publish();
    close();
  }
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
    returnToList(expectedIntent?: number) {
      if (!pending || (expectedIntent !== undefined && pending.id !== expectedIntent)) return false;
      pending.returning = true;
      appearing.clear();
      publish();
      return true;
    },
    getPendingSnapshot() {
      return snapshot;
    },
    isLatestIntent(id: number) {
      return nextIntent === id;
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
      const intent: Intent = {
        id: ++nextIntent,
        panel,
        destination: destination.split(/[?#]/, 1)[0]!,
        close,
      };
      pending = intent;
      publish();
      return () => {
        if (pending === intent) {
          cancel();
        }
      };
    },
    isPending,
    commitLeaf(current: PresentedRoute, panel: MobilePanelSelection) {
      committedLeaf = current;
      const native = visibility.get(current.key);
      if (native?.shown && native.phase !== "closing") complete(current, panel);
      return () => {
        if (committedLeaf === current) committedLeaf = undefined;
      };
    },
    transitionStart(
      event: TransitionEvent,
      current: PresentedRoute | undefined,
      panel: MobilePanelSelection,
    ) {
      if (!event.target) return;
      appearing.delete(event.target);
      const previous = visibility.get(event.target);
      visibility.set(event.target, {
        shown: previous?.shown ?? false,
        phase: event.data.closing ? "closing" : "opening",
      });
      if (event.data.closing) return;
      // Android independently deduplicates DID_APPEAR and WILL_APPEAR. Reversing
      // WILL_DISAPPEAR without DID_DISAPPEAR can emit WILL_APPEAR but no new
      // DID_APPEAR: the same already-shown view never actually disappeared.
      if (previous?.shown && committedLeaf?.key === event.target) complete(committedLeaf, panel);
      if (!pending || current?.key !== event.target) return;
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
      if (!event.target) return;
      if (event.data.closing) {
        // Only the current closing phase may revoke visibility. An old closing
        // end after a newer opening/appearance cannot undo that newer phase.
        if (visibility.get(event.target)?.phase === "closing") {
          visibility.delete(event.target);
          appearing.delete(event.target);
        }
        return;
      }
      if (visibility.get(event.target)?.phase === "closing") return;
      const started = appearing.get(event.target);
      appearing.delete(event.target);
      // The focused owning leaf's committed params are independent of Expo's lagging
      // global route publication. Parent appearances never certify this leaf's key.
      const ownLeaf = committedLeaf?.key === event.target ? committedLeaf : undefined;
      if (ownLeaf || current?.key === event.target)
        visibility.set(event.target, { shown: true, phase: "presented" });
      if (ownLeaf) {
        complete(ownLeaf, panel);
        return;
      }
      if (
        !started ||
        current?.key !== event.target ||
        started.revision !== panel.revision ||
        started.identity !== routeIdentity(current)
      )
        return;
      complete(current, panel);
    },
  };
}

export const nativePresentation = createChatListPresentation();
