import { afterEach, expect, test, vi } from "vitest";

const clients = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ getSnapshot: (id: string) => ({ client: clients.get(id) }) }),
}));
vi.mock("@/desktop/host", () => ({ getDesktopHost: () => null }));
vi.mock("./hub-profiles", () => ({}));
vi.mock("./hub-transport", () => ({}));
import { findHubHost } from "./hub-routes";

function host(getHubStatus: () => Promise<unknown>) {
  return {
    getLastServerInfoMessage: () => ({ features: { hubDiscovery: true } }),
    getHubStatus,
  };
}
const runsHub = (hubOrigin: string) => async () => ({
  status: { hubOrigin, hubConnection: { hubId: "hub-1" } },
});
afterEach(() => {
  clients.clear();
  vi.useRealTimers();
});

test("a stalled Host does not hold the answer past the short limit", async () => {
  vi.useFakeTimers();
  clients.set(
    "stalled",
    host(() => new Promise(() => undefined)),
  );
  clients.set("runner", host(runsHub("http://127.0.0.1:6870")));
  const found = findHubHost("hub-1", ["stalled", "runner"]);
  await vi.advanceTimersByTimeAsync(3_000);
  await expect(found).resolves.toBe("runner");
});

test("only a loopback enrollment means the Hub runs on that Host", async () => {
  clients.set("enrolled-remotely", host(runsHub("https://hub.example.com")));
  clients.set(
    "failing",
    host(async () => Promise.reject(new Error("offline"))),
  );
  await expect(findHubHost("hub-1", ["enrolled-remotely", "failing"])).resolves.toBeNull();
});
