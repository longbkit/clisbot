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
}
interface RootStateLike {
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

/** How a phone gets back to its tabs from wherever the root stack is. */
export function resolvePhoneTabReturn(root: RootStateLike | undefined): PhoneTabReturn {
  if (!root) return { kind: "replace" };
  for (let index = root.index; index >= 0; index -= 1) {
    if (root.routes[index]?.name !== PHONE_TABS_ROUTE) continue;
    if (index === root.index) return { kind: "switch" };
    return { kind: "pop", target: root.key, count: root.index - index };
  }
  return { kind: "replace" };
}
