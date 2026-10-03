import { expect, test } from "vitest";
import {
  testHub,
  jsonRequest,
  LOGIN,
  DEVICE,
  TEST_ORIGIN,
  TEST_PASSWORD,
  accountCookie,
} from "./test-hub.js";

test("feature-off preserves existing unpaired password setup/login and ignores public ID-token configuration", async () => {
  const hub = await testHub({
    featureOff: true,
    googleIdToken: { clientId: "ignored.apps.googleusercontent.com" },
  });
  try {
    expect(hub.auth.googleClientId).toBeUndefined();
    expect((await hub.auth.handle(new Request(TEST_ORIGIN + DEVICE + "/identity"))).status).toBe(
      404,
    );
    const body = { email: "owner@example.test", password: TEST_PASSWORD };
    const claimed = await hub.auth.handle(jsonRequest("/api/auth/clisbot/claim-instance", body));
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ state: "claimed" });
    const account = await hub.auth.resolveAccount(
      new Request(TEST_ORIGIN + "/api/auth/clisbot/state", {
        headers: { cookie: accountCookie(claimed) },
      }),
    );
    expect(account.isInstanceOperator).toBe(true);
    const response = await hub.auth.handle(jsonRequest(LOGIN, body));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-clisbot-device-credential")).toBeNull();
    expect(await hub.devices.authority.list()).toHaveLength(0);
  } finally {
    await hub.close();
  }
}, 60_000);
