import { expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { createDeviceKey } from "@clisbot/device-access/proof";
import { EMAIL_REGISTRATION_PATHS } from "../auth/registration-contract.js";
import { testHub, LOGIN, TEST_PASSWORD, credentialSchema } from "./test-hub.js";

test("anonymous signed reads cannot saturate account URL entry", async () => {
  const hub = await testHub({ bootstrap: true });
  try {
    for (let index = 0; index < 2050; index++) {
      const key = createDeviceKey(randomBytes(32));
      const value = hub.devices.loginEntry.create(hub.hubId, key.publicKey);
      const response = await hub.auth.handle(
        hub.request(key, "login:" + value.challengeId, "/api/auth/clisbot/state"),
      );
      expect(response.status).toBe(200);
    }
    expect(await hub.devices.authority.list()).toHaveLength(0);
    const key = createDeviceKey(randomBytes(32));
    const value = hub.devices.loginEntry.create(hub.hubId, key.publicKey);
    const response = await hub.auth.handle(
      hub.request(key, "login:" + value.challengeId, LOGIN, "POST", {
        email: "owner@example.test",
        password: TEST_PASSWORD,
      }),
    );
    expect(response.status).toBe(200);
    expect(await hub.devices.authority.list()).toHaveLength(1);
  } finally {
    await hub.close();
  }
}, 90_000);

test("failed passwords and invalid registration links release ephemeral mutation guards", async () => {
  const hub = await testHub({ bootstrap: true });
  try {
    const key = createDeviceKey(randomBytes(32));
    const value = hub.devices.loginEntry.create(hub.hubId, key.publicKey);
    const id = "login:" + value.challengeId;
    for (let index = 0; index < 40; index++) {
      const incorrect = await hub.auth.handle(
        hub.request(key, id, LOGIN, "POST", {
          email: "owner@example.test",
          password: "wrong-password",
        }),
      );
      expect(incorrect.status).toBe(401);
      expect(await incorrect.json()).not.toMatchObject({ error: "device_access_denied" });
      const link = await hub.auth.handle(
        hub.request(key, id, EMAIL_REGISTRATION_PATHS.complete, "POST", {
          token: "invalid-link-".repeat(4),
          name: "Unadmitted",
          password: TEST_PASSWORD,
        }),
      );
      expect([404, 429]).toContain(link.status);
    }
    expect(await hub.devices.authority.list()).toHaveLength(0);
    const response = await hub.auth.handle(
      hub.request(key, id, LOGIN, "POST", {
        email: "owner@example.test",
        password: TEST_PASSWORD,
      }),
    );
    expect(response.status).toBe(200);
    expect(await hub.devices.authority.list()).toHaveLength(1);
  } finally {
    await hub.close();
  }
}, 90_000);

test("concurrent password login has one authority winner and a successful proof cannot replay", async () => {
  const hub = await testHub({ bootstrap: true });
  try {
    const key = createDeviceKey(randomBytes(32));
    const value = hub.devices.loginEntry.create(hub.hubId, key.publicKey);
    const request = hub.request(key, "login:" + value.challengeId, LOGIN, "POST", {
      email: "owner@example.test",
      password: TEST_PASSWORD,
    });
    const responses = await Promise.all([
      hub.auth.handle(request.clone()),
      hub.auth.handle(request.clone()),
    ]);
    expect(
      responses.map((response) => response.status).sort((first, second) => first - second),
    ).toEqual([200, 409]);
    const success = responses.find((response) => response.ok)!;
    expect(
      credentialSchema.parse(JSON.parse(success.headers.get("x-clisbot-device-credential")!))
        .backendId,
    ).toBe(hub.hubId);
    expect((await hub.runtime.query(`select * from session`)).rowCount).toBe(1);
    expect((await hub.auth.handle(request.clone())).status).toBe(401);
    expect((await hub.runtime.query(`select * from session`)).rowCount).toBe(1);
  } finally {
    await hub.close();
  }
}, 60_000);
