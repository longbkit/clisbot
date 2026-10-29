import { expect, it } from "vitest";
import type { CachedHubDaemonList } from "@/clisbot/hub/hub-daemon-list-cache";
import { hubServerIds } from "./hub";

type HubDaemon = CachedHubDaemonList["daemons"][number];

function daemon(id: string, serverId: string | null): HubDaemon {
  return {
    id,
    slug: id,
    status: "active",
    presence: "online",
    connectedAt: null,
    lastSeenAt: "2026-10-30T08:00:00.000Z",
    canManage: false,
    managedAccessMode: "off",
    connectionOffer:
      serverId === null
        ? null
        : {
            v: 2,
            serverId,
            daemonPublicKeyB64: "key",
            relay: { endpoint: "relay.example:443" },
          },
  };
}

it("lists the Hosts a remembered Hub list can reach", () => {
  expect(
    hubServerIds({
      origin: "https://hub.example",
      accountId: "account",
      organizationId: "org",
      syncedAt: "2026-10-30T08:00:00.000Z",
      daemons: [daemon("a", "srv-a"), daemon("b", null), daemon("c", "srv-c")],
    }),
  ).toEqual(["srv-a", "srv-c"]);
  expect(hubServerIds(undefined)).toEqual([]);
});
