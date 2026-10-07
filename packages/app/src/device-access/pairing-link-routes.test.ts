import { expect, test, vi } from "vitest";
vi.mock("@/desktop/host", () => ({ isElectronRuntime: () => false }));
vi.mock("@/desktop/daemon/desktop-daemon", () => ({}));
vi.mock("./hub-transport", () => ({}));
vi.mock("./hub-capabilities", () => ({}));
import { pairingLinkRoutes } from "./pairing-offer";

function link(offer: object): string {
  return `https://app.clisbot.com/#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`;
}
const base = {
  v: 3,
  serverId: "srv",
  daemonPublicKeyB64: "key",
  pairing: { backendId: "srv", token: "t".repeat(43), expiresAt: 1 },
};

test("names the routes a pairing link carries", () => {
  expect(
    pairingLinkRoutes(
      link({
        ...base,
        direct: { endpoint: "mac.tail1.ts.net:8443", useTls: true },
        relay: { endpoint: "relay.clisbot.com:443" },
      }),
    ),
  ).toEqual(["tailscale", "relay"]);
  expect(
    pairingLinkRoutes(link({ ...base, direct: { endpoint: "127.0.0.1:6868", useTls: false } })),
  ).toEqual(["thisComputer"]);
  expect(pairingLinkRoutes("https://app.clisbot.com/")).toEqual([]);
  expect(pairingLinkRoutes("https://app.clisbot.com/#offer=not-json")).toEqual([]);
});

test("a Hub-only link names its HTTPS origin and relay", () => {
  const hub = {
    hubId: "hub",
    publicKey: "key",
    origin: "https://mac.tail1.ts.net:8443",
    relay: { endpoint: "relay.clisbot.com:443" },
    pairing: { backendId: "hub", token: "t".repeat(43), expiresAt: 1 },
  };
  expect(pairingLinkRoutes(link({ v: 4, hub }))).toEqual(["tailscale", "relay"]);
});
