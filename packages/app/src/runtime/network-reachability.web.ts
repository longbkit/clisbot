import type { NetworkReachabilityListener } from "./network-reachability.types";

/** Browser and Electron report OS network changes through `online` / `offline` window events. */
export function subscribeNetworkReachability(
  listener: NetworkReachabilityListener,
  target: Pick<Window, "addEventListener" | "removeEventListener"> | undefined = typeof window ===
  "undefined"
    ? undefined
    : window,
): () => void {
  if (!target) return () => undefined;
  const online = () => listener("online");
  const offline = () => listener("offline");
  target.addEventListener("online", online);
  target.addEventListener("offline", offline);
  return () => {
    target.removeEventListener("online", online);
    target.removeEventListener("offline", offline);
  };
}
