import { expect, test } from "vitest";
import { testHub, LOGIN, DEVICE, TEST_ORIGIN, TEST_PASSWORD, accountCookie } from "./test-hub.js";
import { DeviceProofSchema } from "@clisbot/protocol/device-access";
import { httpBinding } from "@clisbot/device-access/proof";
import { HubDeviceAccess } from "./index.js";
import { CLISBOT_CLIENT_ID } from "../auth/client-authorization.js";

test("protected Hub refuses an unbound account cookie even when another device is paired", async () => {
  const hub = await testHub({ bootstrap: true });
  try {
    const device = await hub.pair();
    const response = await hub.auth.handle(
      hub.request(device.key, device.credentialId, LOGIN, "POST", {
        email: "owner@example.test",
        password: TEST_PASSWORD,
      }),
    );
    const cookie = accountCookie(response);
    const request = () =>
      hub.request(
        device.key,
        device.credentialId,
        DEVICE + "/account/sessions",
        "GET",
        undefined,
        cookie,
      );
    expect((await hub.auth.handle(request())).status).toBe(200);
    await hub.runtime.query(
      `delete from verification where identifier like 'clisbot:session-device:%'`,
    );
    expect((await hub.auth.handle(request())).status).toBe(401);
  } finally {
    await hub.close();
  }
}, 60_000);

test("server actions bind successful account sessions and cannot claim an owner without approval", async () => {
  const hub = await testHub();
  try {
    const device = await hub.pair();
    const body = { email: "owner@example.test", password: TEST_PASSWORD };
    const path = "/api/auth/clisbot/claim-instance";
    const forbidden = hub.request(device.key, device.credentialId, path, "POST", body);
    await expect(hub.auth.claimInstance!(body, forbidden.headers)).rejects.toThrow(
      "owner_setup_approval_required",
    );
    expect((await hub.runtime.query(`select * from "user"`)).rowCount).toBe(0);
    const approved = hub.request(
      device.key,
      device.credentialId,
      path,
      "POST",
      body,
      undefined,
      device.ownerSetupToken,
    );
    expect((await hub.auth.claimInstance!(body, approved.headers)).status).toBe("claimed");
    const sessions = await hub.runtime.query(`select id from session`);
    expect(sessions.rowCount).toBe(1);
    expect(
      (
        await hub.runtime.query(`select value from verification where identifier = $1`, [
          "clisbot:session-device:" + sessions.rows[0]?.["id"],
        ])
      ).rows[0]?.["value"],
    ).toContain(device.credentialId);
  } finally {
    await hub.close();
  }
}, 60_000);

test("ordinary sign-out deletes refresh tokens before session deletion and closes only that session", async () => {
  const hub = await testHub({ bootstrap: true });
  try {
    const device = await hub.pair();
    const login = () =>
      hub.auth.handle(
        hub.request(device.key, device.credentialId, LOGIN, "POST", {
          email: "owner@example.test",
          password: TEST_PASSWORD,
        }),
      );
    const firstCookie = accountCookie(await login());
    const secondCookie = accountCookie(await login());
    const request = (cookie: string, path = DEVICE + "/account/sessions", method = "GET") =>
      hub.request(device.key, device.credentialId, path, method, undefined, cookie);
    const first = await hub.auth.resolveAccount(request(firstCookie));
    const second = await hub.auth.resolveAccount(request(secondCookie));
    await hub.runtime.query(
      `insert into oauth_refresh_token (id, token, client_id, session_id, user_id, expires_at, created_at, scopes)
      values ('logout-refresh', 'secret', $1, $2, $3, now() + interval '1 day', now(), '{hub:access}')`,
      [CLISBOT_CLIENT_ID, first.session.id, first.account.id],
    );
    let closedFirst = 0;
    let closedSecond = 0;
    await hub.auth.deviceSocket!(request(firstCookie), "first", () => {
      closedFirst++;
    });
    await hub.auth.deviceSocket!(request(secondCookie), "second", () => {
      closedSecond++;
    });
    expect((await hub.auth.handle(request(firstCookie, "/api/auth/sign-out", "POST"))).status).toBe(
      200,
    );
    expect(closedFirst).toBe(1);
    expect(closedSecond).toBe(0);
    expect(
      (await hub.runtime.query(`select * from oauth_refresh_token where id = 'logout-refresh'`))
        .rowCount,
    ).toBe(0);
    expect(
      (await hub.runtime.query(`select * from session where id = $1`, [first.session.id])).rowCount,
    ).toBe(0);
    expect(
      (await hub.runtime.query(`select * from session where id = $1`, [second.session.id]))
        .rowCount,
    ).toBe(1);
    expect((await hub.auth.handle(request(firstCookie))).status).toBe(401);
    expect((await hub.auth.handle(request(secondCookie))).status).toBe(200);
    expect((await hub.devices.authority.list())[0]?.revokedAt).toBeNull();
  } finally {
    await hub.close();
  }
}, 60_000);

test("security review: wrong Hub, modified body, mixed device/session and persisted replay cannot mint authority", async () => {
  const first = await testHub({ bootstrap: true });
  const second = await testHub({ bootstrap: true });
  try {
    const device = await first.pair("Authorized phone");
    const other = await first.pair("Other phone");
    const login = first.request(device.key, device.credentialId, LOGIN, "POST", {
      email: "owner@example.test",
      password: TEST_PASSWORD,
    });
    const changed = new Request(TEST_ORIGIN + LOGIN, {
      method: "POST",
      headers: login.headers,
      body: JSON.stringify({ email: "owner@example.test", password: "tampered-password" }),
    });
    expect((await first.auth.handle(changed)).status).toBe(401);
    expect((await second.auth.handle(login.clone())).status).toBe(401);
    expect((await second.runtime.query("select id from session")).rowCount).toBe(0);
    // Invalid signatures and wrong backends did not burn the valid request's nonce.
    const response = await first.auth.handle(login.clone());
    expect(response.status).toBe(200);
    const cookie = accountCookie(response);
    const path = DEVICE + "/account/sessions";
    expect(
      (
        await first.auth.handle(
          first.request(other.key, other.credentialId, path, "GET", undefined, cookie),
        )
      ).status,
    ).toBe(401);
    const authorized = first.request(
      device.key,
      device.credentialId,
      path,
      "GET",
      undefined,
      cookie,
    );
    expect((await first.auth.handle(authorized.clone())).status).toBe(200);
    // A new authority object backed by the same database must retain the replay tombstone.
    const headers = authorized.headers.get("x-clisbot-device-proof")!;
    const proof = DeviceProofSchema.parse(JSON.parse(headers));
    await expect(
      new HubDeviceAccess(first.runtime).authority.authenticate(proof, {
        purpose: "http",
        binding: httpBinding({ method: "GET", path, body: "" }),
      }),
    ).rejects.toThrow("Proof already used");
    expect((await first.auth.handle(login.clone())).status).toBe(401);
    expect((await first.runtime.query("select id from session")).rowCount).toBe(1);
  } finally {
    await second.close();
    await first.close();
  }
}, 60_000);
