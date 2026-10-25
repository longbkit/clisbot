// TypeScript fallback; Metro resolves network-reachability.native.ts or .web.ts first.
export { subscribeNetworkReachability } from "./network-reachability.native";
export type {
  NetworkReachability,
  NetworkReachabilityListener,
} from "./network-reachability.types";
