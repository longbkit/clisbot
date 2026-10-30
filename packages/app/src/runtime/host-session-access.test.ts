import { offerConnections } from "@/device-access/host-profile";
import { normalizeStoredHostProfile } from "@/types/host-connection";
import { expect, it } from "vitest";
import {
  hostSessionHubManagement,
  hostAdvertisedConnections,
  matchesAdvertisedHostConnection,
  hostRequiresSessionAdmission,
  prefetchedAccessTicket,
  registerHostAccessTicketResolver,
  resolveHostAccessTicket,
  subscribeHostSessionAccess,
} from "./host-session-access";

it("resolves admission credentials only while a Host authority is registered", async () => {
  const serverId = "server-managed-access";
  const unregister = registerHostAccessTicketResolver(
    serverId,
    async (clientId) => `ticket:${clientId}`,
  );

  expect(hostRequiresSessionAdmission(serverId)).toBe(true);
  await expect(resolveHostAccessTicket(serverId, "client-1")).resolves.toBe("ticket:client-1");

  unregister();
  expect(hostRequiresSessionAdmission(serverId)).toBe(false);
  await expect(resolveHostAccessTicket(serverId, "client-1")).resolves.toBeUndefined();
});

it("does not let an older registration remove a newer resolver", async () => {
  const serverId = "server-replaced-authority";
  const unregisterFirst = registerHostAccessTicketResolver(serverId, async () => "first");
  const unregisterSecond = registerHostAccessTicketResolver(serverId, async () => "second");

  unregisterFirst();
  await expect(resolveHostAccessTicket(serverId, "client-1")).resolves.toBe("second");

  unregisterSecond();
});

it("projects transient Hub management for an existing manual Host", () => {
  const serverId = "server-manual-host";
  const management = {
    kind: "hub" as const,
    hubOrigin: "https://hub.example.test",
    organizationId: "organization-1",
    daemonId: "daemon-1",
  };
  let changes = 0;
  const unsubscribe = subscribeHostSessionAccess(() => {
    changes += 1;
  });
  const unregister = registerHostAccessTicketResolver(serverId, async () => "ticket", management);

  expect(hostSessionHubManagement(serverId)).toEqual(management);
  unregister();
  expect(hostSessionHubManagement(serverId)).toBeUndefined();
  expect(changes).toBe(2);
  unsubscribe();
});

it("asks a Hub Host without its Hub's sign-in for a login, unless this device has its own", async () => {
  const management = {
    kind: "hub" as const,
    hubOrigin: "hub://hub-1",
    organizationId: "organization-1",
    daemonId: "daemon-1",
  };
  // The Hub is stopped or signed out, so no binding is registered for the Host.
  await expect(resolveHostAccessTicket("server-hub-down", "client-1", management)).rejects.toThrow(
    "Sign in to the Hub managing this Host to connect.",
  );
  await expect(
    resolveHostAccessTicket("server-hub-down", "client-1", management, true),
  ).resolves.toBeUndefined();
});

it("keeps the newest advertised routes when an older binding cleans up", () => {
  const serverId = "route-inventory";
  const direct = { id: "direct", type: "directTcp" as const, endpoint: "localhost:1234" };
  const alternate = { ...direct, id: "alternate", endpoint: "localhost:1235" };
  const first = registerHostAccessTicketResolver(serverId, async () => undefined, undefined, [
    direct,
    alternate,
  ]);
  const second = registerHostAccessTicketResolver(serverId, async () => undefined, undefined, [
    direct,
  ]);
  first();
  expect(hostAdvertisedConnections(serverId)).toEqual([direct]);
  second();
  expect(hostAdvertisedConnections(serverId)).toBeUndefined();
});

it("recognizes a hydrated v5 direct route without trusting its stored ID", () => {
  const offered = offerConnections({
    direct: { endpoint: "127.0.0.1:1234", useTls: false },
    daemonPublicKeyB64: "test-key",
  })[0]!;
  const stored = normalizeStoredHostProfile({ serverId: "hydrated", connections: [offered] })!
    .connections[0]!;
  expect(stored.id).not.toBe(offered.id);
  expect(matchesAdvertisedHostConnection(stored, offered)).toBe(true);
  expect(
    matchesAdvertisedHostConnection(stored, { ...offered, useTls: true } as typeof offered),
  ).toBe(false);
});

it("does not authorize a changed Relay endpoint or pinned key just because the ID matches", () => {
  const relay = {
    id: "same-id",
    type: "relay" as const,
    relayEndpoint: "relay.example.test:443",
    useTls: true,
    daemonPublicKeyB64: "first-key",
  };
  expect(matchesAdvertisedHostConnection(relay, { ...relay })).toBe(true);
  expect(
    matchesAdvertisedHostConnection(relay, { ...relay, relayEndpoint: "other.example.test:443" }),
  ).toBe(false);
  expect(
    matchesAdvertisedHostConnection(relay, { ...relay, daemonPublicKeyB64: "changed-key" }),
  ).toBe(false);
});

it("hands the ticket requested with the attempt to the first hello, and asks again after", async () => {
  const requested: string[] = [];
  const takeTicket = prefetchedAccessTicket(async () => {
    requested.push(`ticket-${requested.length + 1}`);
    return requested.at(-1);
  });

  expect(requested).toEqual(["ticket-1"]);
  await expect(takeTicket()).resolves.toBe("ticket-1");
  await expect(takeTicket()).resolves.toBe("ticket-2");
});

it("leaves a prefetched ticket failure to the hello that takes it", async () => {
  const takeTicket = prefetchedAccessTicket(async () => {
    throw new Error("Hub unreachable");
  });
  // Nothing awaited it yet; it must not surface as an unhandled rejection.
  await Promise.resolve();
  await expect(takeTicket()).rejects.toThrow("Hub unreachable");
});
