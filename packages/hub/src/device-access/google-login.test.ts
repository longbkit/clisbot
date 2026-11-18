import { expect, test } from "vitest";
import { z } from "zod";
import { googleSignInNonce } from "@clisbot/device-access/proof";
import { HubGoogleLogin } from "./google-login.js";
import { ProductRequestError } from "../auth/organization-access.js";

const CLIENT = "fixture.apps.googleusercontent.com";
const HUB = {
  hubId: "hub-target",
  publicKey: "dGFyZ2V0LWh1Yi1wdWJsaWMta2V5LWZpeHR1cmUtMzI=",
};
const OTHER_HUB = {
  hubId: "hub-other",
  publicKey: "b3RoZXItaHViLXB1YmxpYy1rZXktZml4dHVyZS0zMjE=",
};
const resultSchema = z.object({
  transactionId: z.string(),
  clientId: z.string(),
  expiresAt: z.number(),
});
const devices = {
  deviceId: (request: Request) =>
    Promise.resolve(request.headers.get("x-fixture-device") ?? "phone"),
  setupStatus: () => Promise.resolve("ready" as const),
  checkOwnerSetupApproval: () => Promise.resolve(),
  hubIdentity: () => Promise.resolve(HUB),
};
const request = (body: unknown, deviceId = "phone") =>
  new Request("https://hub.test/api/auth/clisbot/device/google/challenge", {
    method: "POST",
    headers: { "x-fixture-device": deviceId },
    body: JSON.stringify(body),
  });
/** An unsigned JWT-shaped fixture; the fake verifier stands in for Google's signature check. */
function idToken(claims: Record<string, unknown>, signature = "provider-fixture-signature") {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.${signature}`;
}
function payload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
}
const auth = {
  googleClientId: CLIENT,
  verifyGoogleIdToken: (token: string, nonce: string) =>
    Promise.resolve(
      token.endsWith(".provider-fixture-signature") &&
        payload(token)["nonce"] === nonce &&
        payload(token)["aud"] === CLIENT,
    ),
  signInGoogleToken: ({ nonce }: { nonce: string }) =>
    Promise.resolve(Response.json({ verifiedNonce: nonce })),
};
async function challenge(login: HubGoogleLogin, deviceId = "phone") {
  const response = await login.handle("/google/challenge", request({}, deviceId), auth, devices);
  const body: unknown = await response.json();
  return resultSchema.parse(body);
}
const boundNonce = (transactionId: string, hub = HUB) =>
  googleSignInNonce({
    hubId: hub.hubId,
    hubPublicKey: hub.publicKey,
    transactionId,
  });
const signIn = (
  login: HubGoogleLogin,
  transactionId: string,
  deviceId = "phone",
  clientId = CLIENT,
  token = idToken({ aud: CLIENT, nonce: boundNonce(transactionId) }),
) =>
  login.handle(
    "/google/sign-in",
    request({ transactionId, idToken: token }, deviceId),
    { ...auth, googleClientId: clientId },
    devices,
  );

test("Google challenge creation is stateless; anonymous keys cannot exhaust or evict another sign-in", async () => {
  const login = new HubGoogleLogin();
  const original = await challenge(login);
  for (let index = 0; index < 512; index++) await challenge(login, "unregistered-key-" + index);
  const response = await signIn(login, original.transactionId);
  expect(await response.json()).toEqual({
    verifiedNonce: boundNonce(original.transactionId),
  });
  await expect(signIn(login, original.transactionId)).rejects.toThrow("google_transaction_invalid");
});

test("Google challenge hands out no nonce; the nonce is derived from the verifying Hub identity", async () => {
  const login = new HubGoogleLogin();
  const response = await login.handle("/google/challenge", request({}), auth, devices);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).not.toHaveProperty("nonce");
  expect(body).toMatchObject({ clientId: CLIENT, hubId: HUB.hubId });
});

test("CB-04: a Google token bound to another Hub cannot be exchanged for this Hub's transaction", async () => {
  const login = new HubGoogleLogin();
  // Hub X relays this Hub's transaction and client ID to a victim app connected to X. The app
  // derives the nonce from X's pinned identity, so the token it obtains carries X's binding.
  const relayed = await challenge(login, "attacker-device");
  await expect(
    signIn(
      login,
      relayed.transactionId,
      "attacker-device",
      CLIENT,
      idToken({
        aud: CLIENT,
        nonce: boundNonce(relayed.transactionId, OTHER_HUB),
      }),
    ),
  ).rejects.toMatchObject(new ProductRequestError(401, "google_id_token_invalid"));
  // A failed exchange does not consume the transaction; the right binding still works once.
  expect((await signIn(login, relayed.transactionId, "attacker-device")).status).toBe(200);
});

test("Google ID token audience must be this Hub's client ID before provider verification", async () => {
  const login = new HubGoogleLogin();
  let verified = 0;
  const counting = {
    ...auth,
    verifyGoogleIdToken: (token: string, nonce: string) => {
      verified++;
      return auth.verifyGoogleIdToken(token, nonce);
    },
  };
  for (const aud of ["other-hub.apps.googleusercontent.com", [CLIENT, "other"], undefined]) {
    const value = await challenge(login);
    await expect(
      login.handle(
        "/google/sign-in",
        request({
          transactionId: value.transactionId,
          idToken: idToken({ aud, nonce: boundNonce(value.transactionId) }),
        }),
        counting,
        devices,
      ),
    ).rejects.toMatchObject(new ProductRequestError(401, "google_id_token_invalid"));
  }
  expect(verified).toBe(0);
});

test("Google sign-in is unavailable without a pinned Hub identity", async () => {
  const login = new HubGoogleLogin();
  const response = await login.handle("/google/challenge", request({}), auth, {
    ...devices,
    hubIdentity: () => Promise.resolve(undefined),
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "google_not_configured" });
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
        request(
          {
            transactionId: value.transactionId,
            idToken: idToken({ aud: CLIENT, nonce: boundNonce(value.transactionId) }, "forged"),
          },
          "anonymous-" + index,
        ),
        auth,
        devices,
      ),
    ).rejects.toThrow("google_id_token_invalid");
  }
  expect((await signIn(login, original.transactionId)).status).toBe(200);
});
