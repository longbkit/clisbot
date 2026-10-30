import type { NetworkReachabilityListener } from "./network-reachability.types";

/**
 * Native has no OS network-change signal here: NetInfo needs a native rebuild. Hosts sweep on
 * AppState foreground (`HostRuntimeStore.setAppVisible`) and when a failed Host connects again
 * (`runtime/reconnect-sweep.ts`), which is the reachability check that costs no extra request.
 */
export function subscribeNetworkReachability(_listener: NetworkReachabilityListener): () => void {
  return () => undefined;
}
