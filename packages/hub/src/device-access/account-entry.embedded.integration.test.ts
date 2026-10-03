import { expect, test } from "vitest";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { createDeviceKey } from "@clisbot/device-access/proof";
import {
  testHub,
  DEVICE,
  LOGIN,
  TEST_ORIGIN,
  TEST_PASSWORD,
  accountCookie,
  jsonRequest,
  loginChallengeSchema,
  credentialSchema,
  readJson,
} from "./test-hub.js";

test("owner-ready account URL entry proves a device key without anonymous device registration or owner grants", async () => {
  const hub = await testHub({ bootstrap: true });
  try {
    const identity = await hub.auth.handle(
      new Request(TEST_ORIGIN + DEVICE + "/identity", {
        headers: { Origin: "https://app.clisbot.com" },
      }),
    );
    expect(identity.headers.get("access-control-allow-origin")).toBe("*");
    expect(await identity.json()).toMatchObject({
      entry: "account",
      setupStatus: "ready",
      providers: { google: { enabled: false } },
    });
    const key = createDeviceKey(randomBytes(32));
    const challenge = await readJson(
      await hub.auth.handle(
        jsonRequest(DEVICE + "/login-challenge", { publicKey: key.publicKey, label: "Phone" }),
      ),
      loginChallengeSchema,
    );
    expect(await hub.devices.authority.list()).toHaveLength(0);
    const credential = "login:" + challenge.challengeId;
    const wrongKey = createDeviceKey(randomBytes(32));
    expect(
      (
        await hub.auth.handle(
          hub.request(wrongKey, credential, LOGIN, "POST", {
            email: "owner@example.test",
            password: TEST_PASSWORD,
          }),
        )
      ).status,
    ).toBe(401);
    expect((await hub.auth.handle(hub.request(key, credential, DEVICE + "/devices"))).status).toBe(
      401,
    );
    const incorrect = hub.request(key, credential, LOGIN, "POST", {
      email: "owner@example.test",
      password: "wrong-password",
    });
    expect((await hub.auth.handle(incorrect.clone())).status).toBe(401);
    expect((await hub.auth.handle(incorrect.clone())).status).toBe(401);
    expect(await hub.devices.authority.list()).toHaveLength(0);
    const response = await hub.auth.handle(
      hub.request(key, credential, LOGIN, "POST", {
        email: "owner@example.test",
        password: TEST_PASSWORD,
      }),
    );
    expect(response.status).toBe(200);
    const registered = credentialSchema.parse(
      JSON.parse(response.headers.get("x-clisbot-device-credential")!),
    );
    const devices = await hub.devices.authority.list();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: registered.credentialId,
      grant: "login",
      label: "Phone",
    });
    expect(
      (
        await hub.auth.handle(
          hub.request(key, credential, LOGIN, "POST", {
            email: "owner@example.test",
            password: TEST_PASSWORD,
          }),
        )
      ).status,
    ).toBe(401);
    const cookie = accountCookie(response);
    const account = await hub.auth.resolveAccount(
      hub.request(
        key,
        registered.credentialId,
        "/api/auth/clisbot/state",
        "GET",
        undefined,
        cookie,
      ),
    );
    expect(account.isInstanceOperator).toBe(true);
    expect(
      (
        await hub.auth.handle(hub.request(key, registered.credentialId, DEVICE + "/capabilities"))
      ).headers.get("access-control-allow-origin"),
    ).toBeNull();
    const second = await hub.pair("Other device");
    await expect(
      hub.auth.resolveAccount(
        hub.request(
          second.key,
          second.credentialId,
          "/api/auth/clisbot/state",
          "GET",
          undefined,
          cookie,
        ),
      ),
    ).rejects.toThrow();
  } finally {
    await hub.close();
  }
}, 60_000);

test("personal Hub remains pairing-only; an incomplete owner requires separate operator approval", async () => {
  const personal = await testHub({ personal: true });
  try {
    const key = createDeviceKey(randomBytes(32));
    expect(
      (
        await personal.auth.handle(
          jsonRequest(DEVICE + "/login-challenge", { publicKey: key.publicKey }),
        )
      ).status,
    ).toBe(403);
    expect(
      await (await personal.auth.handle(new Request(TEST_ORIGIN + DEVICE + "/identity"))).json(),
    ).toMatchObject({ entry: "pairing" });
  } finally {
    await personal.close();
  }
  const hub = await testHub();
  try {
    const device = await hub.pair();
    expect(device.ownerSetupToken).toBeTruthy();
    const body = { email: "owner@example.test", password: TEST_PASSWORD };
    const path = "/api/auth/clisbot/claim-instance";
    expect(
      (await hub.auth.handle(hub.request(device.key, device.credentialId, path, "POST", body)))
        .status,
    ).toBe(403);
    expect((await hub.runtime.query(`select * from "user"`)).rowCount).toBe(0);
    const other = await hub.pair("Other");
    expect(
      (
        await hub.auth.handle(
          hub.request(
            other.key,
            other.credentialId,
            path,
            "POST",
            body,
            undefined,
            device.ownerSetupToken,
          ),
        )
      ).status,
    ).toBe(403);
    const serialized = JSON.stringify((await hub.runtime.query(`select * from verification`)).rows);
    expect(serialized).not.toContain(device.ownerSetupToken);
    await hub.runtime.query(`update verification set expires_at = now() - interval '1 second'`);
    expect(
      (
        await hub.auth.handle(
          hub.request(
            device.key,
            device.credentialId,
            path,
            "POST",
            body,
            undefined,
            device.ownerSetupToken,
          ),
        )
      ).status,
    ).toBe(403);
    const approval = await hub.devices.ownerSetup.create({
      hubId: hub.hubId,
      deviceId: device.credentialId,
    });
    const response = await hub.auth.handle(
      hub.request(
        device.key,
        device.credentialId,
        path,
        "POST",
        body,
        undefined,
        approval.ownerSetupToken,
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "claimed" });
    expect(
      (
        await hub.runtime.query(
          `select * from verification where identifier like 'clisbot:owner-setup:%' and expires_at > now()`,
        )
      ).rowCount,
    ).toBe(0);
    expect(
      await (await hub.auth.handle(new Request(TEST_ORIGIN + DEVICE + "/identity"))).json(),
    ).toMatchObject({ entry: "account", setupStatus: "ready" });
  } finally {
    await hub.close();
  }
}, 60_000);

test("owner setup claims serialize and token authority never comes from pairing alone", async () => {
  const hub = await testHub();
  try {
    const first = await hub.pair("First");
    const second = await hub.pair("Second");
    const responses = await Promise.all(
      [first, second].map((device, index) =>
        hub.auth.handle(
          hub.request(
            device.key,
            device.credentialId,
            "/api/auth/clisbot/claim-instance",
            "POST",
            { email: `owner${index}@example.test`, password: TEST_PASSWORD },
            undefined,
            device.ownerSetupToken,
          ),
        ),
      ),
    );
    const states = await Promise.all(
      responses.map((response) => readJson(response, z.object({ state: z.string() }))),
    );
    expect(states.map((state) => state.state).sort()).toEqual(["claimed", "unavailable"]);
    expect(
      (await hub.runtime.query(`select * from "user" where is_instance_operator`)).rowCount,
    ).toBe(1);
    expect((await hub.runtime.query(`select * from organization`)).rowCount).toBe(1);
  } finally {
    await hub.close();
  }
}, 60_000);
