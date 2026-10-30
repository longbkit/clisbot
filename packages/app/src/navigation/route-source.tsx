import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";
import { useStableEvent } from "@/hooks/use-stable-event";

/**
 * The focused route, which changes on every push, pop and tab switch. Expo Router's
 * `usePathname` and `useGlobalSearchParams` re-render their caller on each of those; on a phone
 * that re-rendered Home, the hidden tabs, the tab bar and the chrome in the commit that pushed a
 * chat (docs/expo-router.md#route-reads).
 */
export interface RouteSnapshot {
  readonly pathname: string;
  readonly params: Readonly<Record<string, string | string[] | undefined>>;
}

/** `getSnapshot` returns the same object until the route changes. */
export interface RouteSource {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => RouteSnapshot;
}

export class MissingRouteSourceError extends Error {
  constructor() {
    super("Route reads must be rendered inside a RouteSourceProvider");
  }
}

const RouteSourceContext = createContext<RouteSource | null>(null);

export function RouteSourceProvider({
  source,
  children,
}: {
  source: RouteSource;
  children: ReactNode;
}) {
  return <RouteSourceContext.Provider value={source}>{children}</RouteSourceContext.Provider>;
}

/**
 * Reads one fact of the route. The caller re-renders only when `select`'s result changes under
 * `isEqual`, not on every navigation. Select a boolean, an id or a string; an object built per
 * call needs an `isEqual` that compares it.
 */
export function useRouteSelector<T>(
  select: (route: RouteSnapshot) => T,
  isEqual?: (left: T, right: T) => boolean,
): T {
  const source = useRouteSource();
  return useSyncExternalStoreWithSelector(
    source.subscribe,
    source.getSnapshot,
    source.getSnapshot,
    select,
    isEqual,
  );
}

/** `useRouteSelector` over the pathname alone. */
export function useRoutePath<T>(
  select: (pathname: string) => T,
  isEqual?: (left: T, right: T) => boolean,
): T {
  return useRouteSelector((route) => select(route.pathname), isEqual);
}

/** The pathname when called, for handlers and async results. Never re-renders its caller. */
export function useReadRoutePath(): () => string {
  const { getSnapshot } = useRouteSource();
  return useCallback(() => getSnapshot().pathname, [getSnapshot]);
}

/**
 * Calls `onChange` with the pathname on mount and after each navigation that changes it, without
 * re-rendering the caller: for effects that react to navigation but render nothing from it.
 */
export function useRoutePathEffect(onChange: (pathname: string) => void): void {
  const source = useRouteSource();
  const notify = useStableEvent(onChange);
  useEffect(() => {
    let last = source.getSnapshot().pathname;
    notify(last);
    return source.subscribe(() => {
      const next = source.getSnapshot().pathname;
      if (next === last) return;
      last = next;
      notify(next);
    });
  }, [notify, source]);
}

function useRouteSource(): RouteSource {
  const source = useContext(RouteSourceContext);
  if (!source) throw new MissingRouteSourceError();
  return source;
}
