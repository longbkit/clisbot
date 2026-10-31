/**
 * Phone peer tabs live in the `app/(tabs)` route group. A group adds no URL segment, so each tab's
 * route name is its path without the leading slash and links keep working unchanged.
 */
export const PHONE_TABS_ROUTE = "(tabs)";

const PHONE_TAB_ROUTE_NAMES = ["open-project", "chat", "work", "schedules", "more"] as const;
export type PhoneTabRouteName = (typeof PHONE_TAB_ROUTE_NAMES)[number];

export function phoneTabRouteName(path: string): PhoneTabRouteName | null {
  const name = path.slice(1);
  return (PHONE_TAB_ROUTE_NAMES as readonly string[]).includes(name)
    ? (name as PhoneTabRouteName)
    : null;
}

export function phoneTabPath(name: string): string {
  return `/${name}`;
}

interface RouteLike {
  name: string;
  key: string;
  state?: unknown;
}
interface StateLike {
  key: string;
  index: number;
  routes: readonly RouteLike[];
}

export type PhoneTabReturn =
  /** The tabs are on screen: switch inside them. */
  | { kind: "switch" }
  /** A detail sits on the retained tabs: pop the root stack back to them. */
  | { kind: "pop"; target: string; count: number }
  /** A cold detail with no tabs underneath: replace it, so the tabs become the stack's base. */
  | { kind: "replace" };

/**
 * How a phone gets back to its tabs from wherever the app's root stack is. `container` is the
 * navigation container's state: Expo Router nests the app's root stack under its own `__root`
 * route, so the stack holding `(tabs)` is found along the focused routes.
 */
export function resolvePhoneTabReturn(container: StateLike | undefined): PhoneTabReturn {
  for (let state = container; state; state = focusedChildState(state)) {
    for (let index = state.index; index >= 0; index -= 1) {
      if (state.routes[index]?.name !== PHONE_TABS_ROUTE) continue;
      if (index === state.index) return { kind: "switch" };
      return { kind: "pop", target: state.key, count: state.index - index };
    }
  }
  return { kind: "replace" };
}

/** True while the phone tab navigator is on screen; desktop's `(tabs)` group is a stack. */
export function arePhoneTabsFocused(container: StateLike | undefined): boolean {
  const found = findFocusedTabsRoute(container);
  return (found?.route.state as { type?: string } | undefined)?.type === "tab";
}

/**
 * A focused `(tabs)` route replaced by a fresh one on the tab it shows. The `(tabs)` layout uses it
 * when the breakpoint changes its navigator kind: a navigator must not inherit the other kind's
 * state. Null while a detail covers the tabs; replacing then would drop the detail.
 */
export function phoneTabsRemountAction(container: StateLike | undefined) {
  const found = findFocusedTabsRoute(container);
  if (!found) return null;
  const tabs = found.route.state as Partial<StateLike> | undefined;
  const shown = tabs?.routes?.[tabs.index ?? 0]?.name ?? "open-project";
  return {
    type: "REPLACE" as const,
    target: found.stackKey,
    payload: { name: PHONE_TABS_ROUTE, params: { screen: shown } },
  };
}

function findFocusedTabsRoute(container: StateLike | undefined) {
  for (let state = container; state; state = focusedChildState(state)) {
    const route = state.routes[state.index];
    if (route?.name === PHONE_TABS_ROUTE) return { route, stackKey: state.key };
  }
  return null;
}

function focusedChildState(state: StateLike): StateLike | undefined {
  const child = state.routes[state.index]?.state as Partial<StateLike> | undefined;
  if (!child?.routes || typeof child.key !== "string") return undefined;
  return { key: child.key, index: child.index ?? child.routes.length - 1, routes: child.routes };
}
