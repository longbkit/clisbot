export type NetworkReachability = "online" | "offline";
export type NetworkReachabilityListener = (state: NetworkReachability) => void;
