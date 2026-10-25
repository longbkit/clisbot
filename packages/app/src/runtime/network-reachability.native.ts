import type { NetworkReachabilityListener } from "./network-reachability.types";

/**
 * Native has no OS network-change signal here yet: Hosts re-check on AppState foreground
 * (`HostRuntimeStore.setAppVisible`). NetInfo needs a native rebuild and is deferred to O2.
 */
export function subscribeNetworkReachability(_listener: NetworkReachabilityListener): () => void {
  return () => undefined;
}
