import { routeInfoSubscribe } from "expo-router/build/global-state/routeInfoCache";
import { store } from "expo-router/build/global-state/store";
import type { RouteSource } from "./route-source";

/**
 * The store `usePathname` and `useGlobalSearchParams` read. Its route info is cached per value, so
 * a snapshot keeps its identity until the route changes. Expo Router 57 exports no selector over
 * it, so this reads the internal module; check it when upgrading expo-router.
 */
export const expoRouteSource: RouteSource = {
  subscribe: routeInfoSubscribe,
  getSnapshot: () => store.getRouteInfo(),
};
