import { expect, test } from "vitest";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { createDeviceKey, googleSignInNonce } from "@clisbot/device-access/proof";
import {
  testHub,
  TEST_HUB_PUBLIC_KEY,
  DEVICE,
  jsonRequest,
  accountCookie,
  readJson,
  googleChallengeSchema,
  loginChallengeSchema,
  credentialSchema,
} from "./test-hub.js";

const CLIENT_ID = "fixture-google-client.apps.googleusercontent.com";
const GOOGLE = { clientId: CLIENT_ID, clientSecret: "fixture-only-not-a-google-secret" };
const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...keyPair.publicKey.export({ format: "jwk" }),
  kid: "fixture-google-key",
  alg: "RS256",
  use: "sig",
};

function token(nonce: string, email: string, overrides: Record<string, unknown> = {}) {
  const { aud, iss, exp, ...claims } = overrides;
  return jwt.sign(
    {
      sub: "google-" + email,
      name: "Google User",
      email,
      email_verified: true,
      nonce,
      ...claims,
      ...(typeof exp === "number" ? { exp } : {}),
    },
    keyPair.privateKey,
    {
      algorithm: "RS256",
      keyid: jwk.kid,
      issuer: typeof iss === "string" ? iss : "https://accounts.google.com",
      audience: typeof aud === "string" ? aud : CLIENT_ID,
      ...(typeof exp === "number" ? {} : { expiresIn: "5m" }),
    },
  );
}

/** What the app derives for the Hub it pinned; the target Hub recomputes it from its identity. */
function boundNonce(hubId: string, transactionId: string, hubPublicKey = TEST_HUB_PUBLIC_KEY) {
  return googleSignInNonce({ hubId, hubPublicKey, transactionId });
}

function mockGoogleCertificates(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return url === "https://www.googleapis.com/oauth2/v3/certs"
      ? Promise.resolve(Response.json({ keys: [jwk] }))
      : original(input, init);
  };
  return () => {
    globalThis.fetch = original;
  };
}

test("Google first-owner setup needs the separate grant; Better Auth verifies nonce, issuer/audience and admission", async () => {
  const restore = mockGoogleCertificates();
  const hub = await testHub({ googleIdToken: { clientId: CLIENT_ID } });
  try {
    const device = await hub.pair();
    const challenge = async () =>
      readJson(
        await hub.auth.handle(
          hub.request(device.key, device.credentialId, DEVICE + "/google/challenge", "POST", {}),
        ),
        googleChallengeSchema,
      );
    const nonce = (transaction: { transactionId: string }) =>
      boundNonce(hub.hubId, transaction.transactionId);
    const signIn = (transaction: { transactionId: string }, idToken: string, setupToken?: string) =>
      hub.auth.handle(
        hub.request(
          device.key,
          device.credentialId,
          DEVICE + "/google/sign-in",
          "POST",
          { transactionId: transaction.transactionId, idToken, intent: "claimInstance" },
          undefined,
          setupToken,
        ),
      );
    let transaction = await challenge();
    expect(
      (await signIn(transaction, token(nonce(transaction), "google-owner@example.test"))).status,
    ).toBe(403);
    expect((await hub.runtime.query(`select * from "user"`)).rowCount).toBe(0);
    for (const overrides of [
      { nonce: "wrong-nonce" },
      { aud: "wrong-client" },
      { iss: "https://not-google.example" },
      { exp: Math.floor(Date.now() / 1000) - 60 },
      { email_verified: false },
    ]) {
      transaction = await challenge();
      const response = await signIn(
        transaction,
        token(nonce(transaction), "google-owner@example.test", overrides),
        device.ownerSetupToken,
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect((await hub.runtime.query(`select * from "user"`)).rowCount).toBe(0);
    }
    transaction = await challenge();
    const response = await signIn(
      transaction,
      token(nonce(transaction), "google-owner@example.test"),
      device.ownerSetupToken,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-clisbot-device-credential")).toBeTruthy();
    expect(
      (await hub.runtime.query(`select * from "user" where is_instance_operator`)).rowCount,
    ).toBe(1);
    const access = await hub.auth.resolveAccount(
      hub.request(
        device.key,
        device.credentialId,
        "/api/auth/clisbot/state",
        "GET",
        undefined,
        accountCookie(response),
      ),
    );
    expect(access.isInstanceOperator).toBe(true);
    expect(
      (
        await signIn(
          transaction,
          token(nonce(transaction), "google-owner@example.test"),
          device.ownerSetupToken,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await hub.auth.handle(
          hub.request(device.key, device.credentialId, "/api/auth/sign-in/social", "POST", {
            provider: "google",
            intent: "claimInstance",
          }),
        )
      ).status,
    ).toBe(403);
  } finally {
    restore();
    await hub.close();
  }
}, 60_000);

test("Google account URL entry reuses organization admission and prevents cross-device transaction replay", async () => {
  const restore = mockGoogleCertificates();
  const hub = await testHub({ bootstrap: true, google: GOOGLE });
  try {
    const create = async () => {
      const key = createDeviceKey(randomBytes(32));
      const challenge = await readJson(
        await hub.auth.handle(
          jsonRequest(DEVICE + "/login-challenge", {
            publicKey: key.publicKey,
            label: "Google phone",
          }),
        ),
        loginChallengeSchema,
      );
      const credentialId = "login:" + challenge.challengeId;
      const transaction = await readJson(
        await hub.auth.handle(
          hub.request(key, credentialId, DEVICE + "/google/challenge", "POST", {}),
        ),
        googleChallengeSchema,
      );
      return { key, credentialId, transaction };
    };
    const device = await create();
    const other = await create();
    const request = {
      transactionId: device.transaction.transactionId,
      idToken: token(
        boundNonce(hub.hubId, device.transaction.transactionId),
        "member@example.test",
      ),
    };
    expect(
      (
        await hub.auth.handle(
          hub.request(other.key, other.credentialId, DEVICE + "/google/sign-in", "POST", request),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await hub.auth.handle(
          hub.request(device.key, device.credentialId, DEVICE + "/google/sign-in", "POST", request),
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(await hub.devices.authority.list()).toHaveLength(0);
    const bootstrap = (
      await hub.runtime.query<{ owner: string; organization: string }>(
        `select owner_user_id as owner, organization_id as organization from instance_bootstrap`,
      )
    ).rows[0]!;
    await hub.runtime.query(
      `insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
      values ($1, $2, 'member@example.test', 'member', 'pending', now() + interval '1 day', $3)`,
      [randomUUID(), bootstrap.organization, bootstrap.owner],
    );
    const admitted = await create();
    const response = await hub.auth.handle(
      hub.request(admitted.key, admitted.credentialId, DEVICE + "/google/sign-in", "POST", {
        transactionId: admitted.transaction.transactionId,
        idToken: token(
          boundNonce(hub.hubId, admitted.transaction.transactionId),
          "member@example.test",
        ),
      }),
    );
    expect(response.status).toBe(200);
    const credential = credentialSchema.parse(
      JSON.parse(response.headers.get("x-clisbot-device-credential")!),
    );
    const access = await hub.auth.resolveOrganizationAccess(
      hub.request(
        admitted.key,
        credential.credentialId,
        "/api/management/organizations",
        "GET",
        undefined,
        accountCookie(response),
      ),
    );
    expect(access.membership.role).toBe("member");
    expect(access.organization.id).toBe(bootstrap.organization);
    expect(await hub.devices.authority.list()).toMatchObject([
      { grant: "login", label: "Google phone" },
    ]);
  } finally {
    restore();
    await hub.close();
  }
}, 60_000);

test("CB-04: a victim's Google token relayed by another Hub cannot obtain a device credential here", async () => {
  const restore = mockGoogleCertificates();
  const hub = await testHub({ bootstrap: true, google: GOOGLE });
  try {
    const bootstrap = (
      await hub.runtime.query<{ owner: string; organization: string }>(
        `select owner_user_id as owner, organization_id as organization from instance_bootstrap`,
      )
    ).rows[0]!;
    await hub.runtime.query(
      `insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
      values ($1, $2, 'victim@example.test', 'member', 'pending', now() + interval '1 day', $3)`,
      [randomUUID(), bootstrap.organization, bootstrap.owner],
    );
    // The operator of Hub X opens an ordinary login entry here (target Hub T) with its own key D.
    const attacker = createDeviceKey(randomBytes(32));
    const login = await readJson(
      await hub.auth.handle(
        jsonRequest(DEVICE + "/login-challenge", {
          publicKey: attacker.publicKey,
          label: "Attacker relay",
        }),
      ),
      loginChallengeSchema,
    );
    const credentialId = "login:" + login.challengeId;
    const challenge = async () => {
      const response = await hub.auth.handle(
        hub.request(attacker, credentialId, DEVICE + "/google/challenge", "POST", {}),
      );
      return (await response.json()) as Record<string, unknown> & {
        transactionId: string;
      };
    };
    const exchange = (transactionId: string, nonce: string) =>
      hub.auth.handle(
        hub.request(attacker, credentialId, DEVICE + "/google/sign-in", "POST", {
          transactionId,
          idToken: token(nonce, "victim@example.test"),
        }),
      );

    // X relays T's transaction and client ID to a victim app connected to X. T no longer hands out
    // a nonce X could relay, so the victim's app never mints a token carrying T's binding.
    const relayed = await challenge();
    expect(relayed).not.toHaveProperty("nonce");
    expect(relayed["hubId"]).toBe(hub.hubId);
    // The victim's app derives the nonce from the Hub it pinned: X, not T.
    const forX = boundNonce(
      "hub-x",
      relayed.transactionId,
      "aHViLXgtZTJlZS1wdWJsaWMta2V5LWZpeHR1cmU=",
    );
    expect((await exchange(relayed.transactionId, forX)).status).toBe(401);
    // Even an old app that still forwards a raw Hub-supplied nonce cannot help: T verifies only
    // its own derivation, never a nonce that merely came from some Hub's challenge.
    expect((await exchange(relayed.transactionId, "x".repeat(43))).status).toBe(401);
    expect(await hub.devices.authority.list()).toHaveLength(0);
    expect(
      (await hub.runtime.query(`select * from "user" where email = 'victim@example.test'`))
        .rowCount,
    ).toBe(0);

    // The same identity signing in while really connected to T is admitted, once.
    const direct = await challenge();
    const nonce = boundNonce(hub.hubId, direct.transactionId);
    const response = await exchange(direct.transactionId, nonce);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-clisbot-device-credential")).toBeTruthy();
    expect((await exchange(direct.transactionId, nonce)).status).toBe(401);
  } finally {
    restore();
    await hub.close();
  }
}, 60_000);

test("missing Google configuration is explicit and never accepts arbitrary ID tokens", async () => {
  const hub = await testHub({ bootstrap: true });
  try {
    const device = await hub.pair();
    const response = await hub.auth.handle(
      hub.request(device.key, device.credentialId, DEVICE + "/google/challenge", "POST", {}),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "google_not_configured" });
  } finally {
    await hub.close();
  }
}, 60_000);
