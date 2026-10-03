import { expect, test } from "vitest";
import { z } from "zod";
import { HubGoogleLogin } from "./google-login.js";
import { ProductRequestError } from "../auth/organization-access.js";

const CLIENT = "fixture.apps.googleusercontent.com";
const resultSchema = z.object({
  transactionId: z.string(),
  nonce: z.string(),
  expiresAt: z.number(),
});
const devices = {
  deviceId: (request: Request) =>
    Promise.resolve(request.headers.get("x-fixture-device") ?? "phone"),
  setupStatus: () => Promise.resolve("ready" as const),
  checkOwnerSetupApproval: () => Promise.resolve(),
};
const request = (body: unknown, deviceId = "phone") =>
  new Request("https://hub.test/api/auth/clisbot/device/google/challenge", {
    method: "POST",
    headers: { "x-fixture-device": deviceId },
    body: JSON.stringify(body),
  });
const auth = {
  googleClientId: CLIENT,
  verifyGoogleIdToken: (idToken: string) => Promise.resolve(idToken === "provider-fixture-token"),
  signInGoogleToken: ({ nonce }: { nonce: string }) =>
    Promise.resolve(Response.json({ verifiedNonce: nonce })),
};
async function challenge(login: HubGoogleLogin, deviceId = "phone") {
  const response = await login.handle("/google/challenge", request({}, deviceId), auth, devices);
  const body: unknown = await response.json();
  return resultSchema.parse(body);
}
const signIn = (
  login: HubGoogleLogin,
  transactionId: string,
  deviceId = "phone",
  clientId = CLIENT,
) =>
  login.handle(
    "/google/sign-in",
    request({ transactionId, idToken: "provider-fixture-token" }, deviceId),
    { ...auth, googleClientId: clientId },
    devices,
  );

test("Google challenge creation is stateless; anonymous keys cannot exhaust or evict another sign-in", async () => {
  const login = new HubGoogleLogin();
  const original = await challenge(login);
  for (let index = 0; index < 512; index++) await challenge(login, "unregistered-key-" + index);
  const response = await signIn(login, original.transactionId);
  expect(await response.json()).toEqual({ verifiedNonce: original.nonce });
  await expect(signIn(login, original.transactionId)).rejects.toThrow("google_transaction_invalid");
});

test("Google transaction authenticates device/client/Hub instance and expiry before consuming it", async () => {
  let now = 1_000_000;
  const login = new HubGoogleLogin(() => now);
  const original = await challenge(login);
  await expect(signIn(login, original.transactionId, "other-phone")).rejects.toThrow(
    "google_transaction_invalid",
  );
  await expect(signIn(login, original.transactionId, "phone", "wrong-client")).rejects.toThrow(
    "google_transaction_invalid",
  );
  await expect(signIn(new HubGoogleLogin(() => now), original.transactionId)).rejects.toThrow(
    "google_transaction_invalid",
  );
  const bytes = Buffer.from(original.transactionId, "base64url");
  bytes[8] = (bytes[8] ?? 0) ^ 1;
  await expect(signIn(login, bytes.toString("base64url"))).rejects.toThrow(
    "google_transaction_invalid",
  );
  expect((await signIn(login, original.transactionId)).status).toBe(200);
  const expiring = await challenge(login);
  now += 300_001;
  await expect(signIn(login, expiring.transactionId)).rejects.toThrow("google_transaction_invalid");
});

test("consumed Google transactions fail closed under saturation without forgetting replay protection", async () => {
  let now = 1_000_000;
  const login = new HubGoogleLogin(() => now);
  const original = await challenge(login);
  await signIn(login, original.transactionId);
  for (let index = 1; index < 2048; index++) {
    const value = await challenge(login);
    await signIn(login, value.transactionId);
  }
  const overflow = await challenge(login);
  await expect(signIn(login, overflow.transactionId)).rejects.toMatchObject(
    new ProductRequestError(429, "google_sign_in_limit"),
  );
  await expect(signIn(login, original.transactionId)).rejects.toThrow("google_transaction_invalid");
  now += 300_001;
  const next = await challenge(login);
  expect((await signIn(login, next.transactionId)).status).toBe(200);
});

test("invalid Google tokens cannot allocate or saturate the consumed replay ledger", async () => {
  const login = new HubGoogleLogin();
  const original = await challenge(login);
  for (let index = 0; index < 2050; index++) {
    const value = await challenge(login, "anonymous-" + index);
    await expect(
      login.handle(
        "/google/sign-in",
        request({ transactionId: value.transactionId, idToken: "invalid" }, "anonymous-" + index),
        auth,
        devices,
      ),
    ).rejects.toThrow("google_id_token_invalid");
  }
  expect((await signIn(login, original.transactionId)).status).toBe(200);
});
