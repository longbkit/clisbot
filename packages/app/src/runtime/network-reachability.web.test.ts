import { expect, it } from "vitest";
import { subscribeNetworkReachability } from "./network-reachability.web";

it("reports window online and offline events until unsubscribed", () => {
  const target = new EventTarget();
  const seen: string[] = [];
  const unsubscribe = subscribeNetworkReachability((state) => seen.push(state), target as never);
  target.dispatchEvent(new Event("offline"));
  target.dispatchEvent(new Event("online"));
  unsubscribe();
  target.dispatchEvent(new Event("online"));
  expect(seen).toEqual(["offline", "online"]);
});

it("is inert without a window", () => {
  const unsubscribe = subscribeNetworkReachability(() => undefined, undefined);
  expect(unsubscribe()).toBeUndefined();
});
