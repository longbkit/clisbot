import { expect, it } from "vitest";
import {
  hostSessionHubManagement,
  hostRequiresSessionAdmission,
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
