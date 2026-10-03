import { expect, test } from "vitest";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { testHub, DEVICE, LOGIN, TEST_PASSWORD, accountCookie, readJson } from "./test-hub.js";
import { AccessStore } from "../access/store.js";
import { AccessTicketService } from "../managed-access/tickets.js";
import { CLISBOT_CLIENT_ID } from "../auth/client-authorization.js";
import { currentAccountSession } from "./account-sessions.js";

test("Account Sessions lists only the signed-in account and revokes exactly its session/tickets/leases/sockets", async () => {
  const hub = await testHub({ bootstrap: true });
  try {
    const device = await hub.pair("Phone");
    const login = () =>
      hub.auth.handle(
        hub.request(device.key, device.credentialId, LOGIN, "POST", {
          email: "owner@example.test",
          password: TEST_PASSWORD,
        }),
      );
    const cookie1 = accountCookie(await login());
    const cookie2 = accountCookie(await login());
    const request = (path: string, method = "GET", cookie = cookie2) =>
      hub.request(device.key, device.credentialId, path, method, undefined, cookie);
    const account1 = await hub.auth.resolveAccount(
      request("/api/auth/clisbot/state", "GET", cookie1),
    );
    const account2 = await hub.auth.resolveAccount(request("/api/auth/clisbot/state"));
    expect(account1.session.id).not.toBe(account2.session.id);
    await hub.auth.handle(request("/api/auth/clisbot/state"));
    const access = await hub.auth.resolveOrganizationAccess(
      request("/api/management/organizations"),
    );
    const foreignUser = randomUUID();
    await hub.runtime.query(
      `insert into "user" (id, name, email) values ($1, 'Other', 'other@example.test')`,
      [foreignUser],
    );
    await hub.runtime.query(
      `insert into session (id, user_id, token, expires_at) values ('foreign-session', $1, 'foreign-token', now() + interval '1 day')`,
      [foreignUser],
    );
    const path = DEVICE + "/account/sessions";
    const listed = await readJson(
      await hub.auth.handle(request(path)),
      z.object({
        currentSessionId: z.string(),
        sessions: z.array(
          z.object({ id: z.string(), label: z.string(), isCurrent: z.boolean() }).passthrough(),
        ),
      }),
    );
    expect(listed.currentSessionId).toBe(account2.session.id);
    expect(listed.sessions).toHaveLength(2);
    expect(
      listed.sessions.filter((session: { isCurrent: boolean }) => session.isCurrent),
    ).toHaveLength(1);
    expect(listed.sessions.every((session: { label: string }) => session.label === "Phone")).toBe(
      true,
    );
    expect(JSON.stringify(listed)).not.toContain("foreign-session");
    expect(JSON.stringify(listed)).not.toContain("token");
    expect((await hub.auth.handle(request(path + "/foreign-session", "DELETE"))).status).toBe(404);
    const daemonId = randomUUID();
    const machineId = randomUUID();
    await hub.runtime.query(
      `insert into machines (id, org_id, source, status) values ($1, $2, '{"kind":"manual"}', 'alive')`,
      [machineId, access.organization.id],
    );
    await hub.runtime.query(
      `insert into daemons (id, idempotency_key, enrollment_verifier, slug, machine_id,
      organization_id, server_id, daemon_public_key, credential_verifier, scopes, status)
      values ($1, $2, $3, 'workstation', $4, $5, 'server', 'key', 'verifier', '["hub.execute"]', 'active')`,
      [daemonId, randomUUID(), randomUUID(), machineId, access.organization.id],
    );
    const tickets = new AccessTicketService(hub.runtime, new AccessStore(hub.runtime));
    const issue = (sessionId: string, clientId: string) =>
      tickets.issue({
        organizationId: access.organization.id,
        daemonId,
        userId: account1.account.id,
        membershipId: access.membership.id,
        clientId,
        deviceId: device.credentialId,
        accountAuthenticated: true,
        accountSessionId: sessionId,
      });
    const firstTicket = await issue(account1.session.id, "first-client");
    const firstLease = await tickets.consume({
      daemonId,
      accessTicket: firstTicket.accessTicket,
      clientId: "first-client",
    });
    const pendingTicket = await issue(account1.session.id, "pending-client");
    const secondTicket = await issue(account2.session.id, "second-client");
    const secondLease = await tickets.consume({
      daemonId,
      accessTicket: secondTicket.accessTicket,
      clientId: "second-client",
    });
    await hub.runtime.query(
      `insert into oauth_refresh_token (id, token, client_id, session_id, user_id, expires_at, created_at, scopes)
      values ('refresh-first', 'secret-first', $1, $2, $3, now() + interval '1 day', now(), '{hub:access}')`,
      [CLISBOT_CLIENT_ID, account1.session.id, account1.account.id],
    );
    let closed1 = 0;
    let closed2 = 0;
    await hub.auth.deviceSocket!(
      request(DEVICE + "/capabilities", "GET", cookie1),
      "socket1",
      () => {
        closed1++;
      },
    );
    await hub.auth.deviceSocket!(request(DEVICE + "/capabilities"), "socket2", () => {
      closed2++;
    });
    expect(
      (await hub.auth.handle(request(path + "/" + account1.session.id, "DELETE"))).status,
    ).toBe(200);
    expect(closed1).toBe(1);
    expect(closed2).toBe(0);
    expect(await currentAccountSession(hub.runtime, account1.account.id, account1.session.id)).toBe(
      false,
    );
    expect(
      (await hub.runtime.query(`select * from oauth_refresh_token where id = 'refresh-first'`))
        .rowCount,
    ).toBe(0);
    await expect(tickets.refresh({ daemonId, leaseId: firstLease.leaseId })).rejects.toThrow();
    await expect(
      tickets.consume({
        daemonId,
        accessTicket: pendingTicket.accessTicket,
        clientId: "pending-client",
      }),
    ).rejects.toThrow();
    expect((await tickets.refresh({ daemonId, leaseId: secondLease.leaseId })).leaseId).toBe(
      secondLease.leaseId,
    );
    expect((await hub.auth.handle(request(path, "GET", cookie1))).status).toBe(401);
    expect((await hub.auth.handle(request(path))).status).toBe(200);
    expect((await hub.devices.authority.list())[0]?.revokedAt).toBeNull();
    await hub.devices.revoke(device.credentialId);
    expect(closed2).toBe(1);
    expect((await hub.auth.handle(request(path))).status).toBe(401);
    expect(
      (await hub.runtime.query(`select * from session where id = $1`, [account2.session.id]))
        .rowCount,
    ).toBe(0);
    await expect(tickets.refresh({ daemonId, leaseId: secondLease.leaseId })).rejects.toThrow();
  } finally {
    await hub.close();
  }
}, 60_000);

test("personal pairing has paired devices but no account sessions surface", async () => {
  const hub = await testHub({ personal: true });
  try {
    const device = await hub.pair();
    const response = await hub.auth.handle(
      hub.request(device.key, device.credentialId, DEVICE + "/account/sessions"),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "account_session_required" });
  } finally {
    await hub.close();
  }
}, 60_000);
