import { expect, test } from "vitest";
import { testHub, LOGIN, DEVICE, TEST_PASSWORD, accountCookie } from "./test-hub.js";
import { CLISBOT_CLIENT_ID } from "../auth/client-authorization.js";
import { MASTER_PASSWORD_RESET_PATH } from "../auth/master-password-reset.js";
import { GoogleAccountLinking } from "../auth/google-sign-in.js";

async function sessions(hub: Awaited<ReturnType<typeof testHub>>) {
  const device = await hub.pair();
  const login = () =>
    hub.auth.handle(
      hub.request(device.key, device.credentialId, LOGIN, "POST", {
        email: "owner@example.test",
        password: TEST_PASSWORD,
      }),
    );
  const cookie1 = accountCookie(await login());
  const cookie2 = accountCookie(await login());
  const request = (cookie: string, path: string, method = "GET", body?: unknown) =>
    hub.request(device.key, device.credentialId, path, method, body, cookie);
  const first = await hub.auth.resolveAccount(request(cookie1, DEVICE + "/account/sessions"));
  const second = await hub.auth.resolveAccount(request(cookie2, DEVICE + "/account/sessions"));
  for (const [id, account] of [
    ["first", first],
    ["second", second],
  ] as const) {
    await hub.runtime.query(
      `insert into oauth_refresh_token (id, token, client_id, session_id, user_id, expires_at, created_at, scopes)
      values ($1, $2, $3, $4, $5, now() + interval '1 day', now(), '{hub:access}')`,
      [id, "fixture-" + id, CLISBOT_CLIENT_ID, account.session.id, account.account.id],
    );
  }
  let closedFirst = 0;
  let closedSecond = 0;
  await hub.auth.deviceSocket!(request(cookie1, DEVICE + "/capabilities"), "first", () => {
    closedFirst++;
  });
  await hub.auth.deviceSocket!(request(cookie2, DEVICE + "/capabilities"), "second", () => {
    closedSecond++;
  });
  return {
    first,
    second,
    request,
    cookie1,
    cookie2,
    closed: () => ({ first: closedFirst, second: closedSecond }),
  };
}

test("successful password change atomically revokes other sessions/refresh tokens and leaves current session usable", async () => {
  const hub = await testHub({ bootstrap: true });
  try {
    const state = await sessions(hub);
    const path = "/api/auth/change-password";
    const body = { currentPassword: TEST_PASSWORD, newPassword: "new-correct-owner-password" };
    expect(
      (
        await hub.auth.handle(
          state.request(state.cookie2, path, "POST", {
            ...body,
            currentPassword: "wrong-password",
          }),
        )
      ).status,
    ).toBe(400);
    expect(state.closed()).toEqual({ first: 0, second: 0 });
    expect((await hub.runtime.query(`select * from oauth_refresh_token`)).rowCount).toBe(2);
    expect((await hub.auth.handle(state.request(state.cookie2, path, "POST", body))).status).toBe(
      200,
    );
    expect(state.closed()).toEqual({ first: 1, second: 0 });
    expect((await hub.runtime.query(`select id from oauth_refresh_token`)).rows).toEqual([
      { id: "second" },
    ]);
    expect(
      (await hub.auth.handle(state.request(state.cookie1, DEVICE + "/account/sessions"))).status,
    ).toBe(401);
    expect(
      (await hub.auth.handle(state.request(state.cookie2, DEVICE + "/account/sessions"))).status,
    ).toBe(200);
    for (const bypass of [
      "revoke-sessions",
      "revoke-session",
      "revoke-other-sessions",
      "delete-user",
      "reset-password",
    ])
      expect(
        (await hub.auth.handle(state.request(state.cookie2, "/api/auth/" + bypass, "POST", {})))
          .status,
      ).toBe(404);
  } finally {
    await hub.close();
  }
}, 60_000);

test("configured password recovery revokes all protected account sessions and their sockets", async () => {
  const masterPassword = "fixture-recovery-secret-at-least-32-characters";
  const hub = await testHub({ bootstrap: true, masterPassword });
  try {
    const state = await sessions(hub);
    const request = state.request(state.cookie2, MASTER_PASSWORD_RESET_PATH, "POST", {
      email: "owner@example.test",
      newPassword: "recovered-owner-password",
    });
    request.headers.set("authorization", "Bearer " + masterPassword);
    expect((await hub.auth.handle(request)).status).toBe(200);
    expect(state.closed()).toEqual({ first: 1, second: 1 });
    expect((await hub.runtime.query(`select * from session`)).rowCount).toBe(0);
    expect((await hub.runtime.query(`select * from oauth_refresh_token`)).rowCount).toBe(0);
    expect(
      (await hub.auth.handle(state.request(state.cookie2, DEVICE + "/account/sessions"))).status,
    ).toBe(401);
  } finally {
    await hub.close();
  }
}, 60_000);

test("server-action password change uses paired request binding and applies the same session cleanup", async () => {
  const hub = await testHub({ bootstrap: true });
  try {
    const state = await sessions(hub);
    const body = { currentPassword: TEST_PASSWORD, newPassword: "server-action-owner-password" };
    const request = state.request(state.cookie2, "/api/auth/change-password", "POST", body);
    await hub.auth.changePassword!(body, request.headers);
    expect(state.closed()).toEqual({ first: 1, second: 0 });
    expect((await hub.runtime.query(`select id from oauth_refresh_token`)).rows).toEqual([
      { id: "second" },
    ]);
  } finally {
    await hub.close();
  }
}, 60_000);

test("Google linking revokes the authority of an existing unverified password account", async () => {
  const hub = await testHub({ bootstrap: true });
  try {
    const state = await sessions(hub);
    // Represents an invited member's unverified password account, never an instance operator.
    await hub.runtime.query(
      `update "user" set is_instance_operator = false, email_verified = false where id = $1`,
      [state.first.account.id],
    );
    await new GoogleAccountLinking(hub.runtime, hub.devices.accountSessions).beforeLink(
      state.first.account.id,
    );
    expect(state.closed()).toEqual({ first: 1, second: 1 });
    expect((await hub.runtime.query(`select * from session`)).rowCount).toBe(0);
    expect((await hub.runtime.query(`select * from oauth_refresh_token`)).rowCount).toBe(0);
    expect(
      (await hub.runtime.query(`select * from account where provider_id = 'credential'`)).rowCount,
    ).toBe(0);
  } finally {
    await hub.close();
  }
}, 60_000);
