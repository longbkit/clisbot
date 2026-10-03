import { expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDeviceKey,
  digest,
  httpBinding,
  signDeviceProof,
} from "@clisbot/device-access/proof";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import { createDatabase } from "../db/pg.js";
import { createCredentialCipher } from "../credentials/credential-cipher.js";
import { composeEntitlements } from "../auth/entitlements.js";
import { createAuthServer } from "../auth/server.js";
import { HubDeviceAccess } from "./index.js";
import { createFetchServer } from "../http/node-server.js";
import { mountHubDeviceIngress } from "./ingress.js";
import { generateKeyPair, exportPublicKey } from "@clisbot/relay/e2ee";
import { HubDeviceTransport } from "@clisbot/client/internal/hub-device-transport";
import { WebSocket } from "ws";
import type { WebSocketLike } from "@clisbot/client/internal/daemon-client-transport-types";

test("personal Hub uses existing organization authority; pairing cannot bypass newly required login", async () => {
  const home = await mkdtemp(join(tmpdir(), "clisbot-hub-devices-"));
  const bundle = await embeddedDatabaseRuntime(join(home, "db"));
  const { runtime, locks } = bundle;
  try {
    await runtime.migrate();
    const database = createDatabase(
      runtime,
      locks,
      createCredentialCipher({ keyId: "test", masterKey: randomBytes(32) }),
    );
    const entitlements = composeEntitlements(database, runtime);
    const devices = new HubDeviceAccess(runtime, false);
    const origin = "http://hub.test";
    const auth = createAuthServer({
      database: runtime,
      locks,
      entitlements: entitlements.service,
      secret: "device-access-test-secret-32-characters",
      baseURL: origin,
      deviceAccess: devices,
    });
    await auth.initialize?.();
    const identity = await (
      await auth.handle(new Request(`${origin}/api/auth/clisbot/device/identity`))
    ).json();
    const hubId = identity.hubId as string;
    expect(identity.loginRequired).toBe(false);
    expect((await runtime.query(`select * from account`)).rowCount).toBe(0);
    const invitation = await devices.authority.createInvitation({ label: "iPhone" });
    const key = createDeviceKey(randomBytes(32));
    const pairingProof = signDeviceProof({
      key,
      proof: {
        backendId: hubId,
        credentialId: "pair",
        timestamp: Date.now(),
        nonce: randomBytes(24).toString("base64url"),
      },
      context: { purpose: "pair", binding: digest(invitation.token) },
    });
    const redeem = await auth.handle(
      new Request(`${origin}/api/auth/clisbot/device/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: invitation.token,
          publicKey: key.publicKey,
          proof: pairingProof,
        }),
      }),
    );
    expect(redeem.status).toBe(200);
    const { credentialId } = (await redeem.json()) as { credentialId: string };
    const request = (path: string, method = "GET", value?: unknown, cookie?: string) => {
      const body = value === undefined ? "" : JSON.stringify(value);
      const proof = signDeviceProof({
        key,
        proof: {
          backendId: hubId,
          credentialId,
          timestamp: Date.now(),
          nonce: randomBytes(24).toString("base64url"),
        },
        context: { purpose: "http", binding: httpBinding({ method, path, body }) },
      });
      return new Request(`${origin}${path}`, {
        method,
        headers: {
          "X-Clisbot-Device-Proof": JSON.stringify(proof),
          Origin: origin,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body ? { body } : {}),
      });
    };
    const capabilitiesPath = "/api/auth/clisbot/device/capabilities";
    expect((await auth.handle(new Request(`${origin}${capabilitiesPath}`))).status).toBe(401);
    const personal = await (await auth.handle(request(capabilitiesPath))).json();
    expect(personal.accountAuthentication).toBe("personal");
    expect(personal.ownerLoginConfigured).toBe(false);
    expect(personal.capabilities.manageResources).toBe(true);
    const server = createFetchServer((value) => auth.handle(value));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const ingressKey = generateKeyPair();
    const ingress = mountHubDeviceIngress({
      server,
      origin,
      hubId,
      key: ingressKey,
      fetch: (value) => auth.handle(value),
      deviceSocket: auth.deviceSocket!,
      error: (error) => {
        throw error;
      },
    });
    const encrypted = new HubDeviceTransport({
      url: `ws://127.0.0.1:${address.port}/api/auth/clisbot/device/socket`,
      publicKey: exportPublicKey(ingressKey.publicKey),
      webSocketFactory: (url, options) =>
        new WebSocket(url, options?.protocols) as unknown as WebSocketLike,
    });
    try {
      const proofRequest = request(capabilitiesPath);
      const response = await encrypted.request({
        path: capabilitiesPath,
        method: "GET",
        headers: Object.fromEntries(proofRequest.headers),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).hubId).toBe(hubId);
      expect(
        (await encrypted.request({ path: capabilitiesPath, method: "GET", headers: {} })).status,
      ).toBe(401);
      await expect(
        encrypted.request({
          path: "https://evil.test/api/auth/clisbot/state",
          method: "GET",
          headers: {},
        }),
      ).rejects.toThrow("Unsupported");
    } finally {
      encrypted.close();
      ingress.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const access = await auth.resolveOrganizationAccess(request("/api/management/organizations"));
    expect(access.membership.role).toBe("owner");
    const policyPath = "/api/auth/clisbot/device/login-policy";
    expect((await auth.handle(request(policyPath, "PUT", { required: true }))).status).toBe(409);
    // Operator-approved upgrade attaches an explicit login method to the SAME owner.
    const ownerLogin = await auth.handle(
      request("/api/auth/clisbot/device/owner-login", "POST", {
        email: "Review.Owner@Example.TEST",
        password: "explicit-owner-password",
      }),
    );
    expect(ownerLogin.status).toBe(200);
    expect((await (await auth.handle(request(capabilitiesPath))).json()).ownerLoginConfigured).toBe(
      true,
    );
    expect(
      (await runtime.query(`select email from "user" where id = $1`, [access.account.id]))
        .rows[0]?.["email"],
    ).toBe("review.owner@example.test");
    expect((await runtime.query(`select user_id from account`)).rows[0]?.["user_id"]).toBe(
      access.account.id,
    );
    expect(
      (await runtime.query(`select email_verified from "user" where id = $1`, [access.account.id]))
        .rows[0]?.["email_verified"],
    ).toBe(false);
    expect((await auth.handle(request(policyPath, "PUT", { required: true }))).status).toBe(200);
    expect(await new HubDeviceAccess(runtime, false).authority.info()).toMatchObject({
      backendId: hubId,
      loginRequired: true,
    });
    const locked = await (await auth.handle(request(capabilitiesPath))).json();
    expect(locked).toMatchObject({ accountAuthentication: "required", capabilities: null });
    expect(locked).not.toHaveProperty("ownerLoginConfigured");
    await expect(
      auth.resolveOrganizationAccess(request("/api/management/organizations")),
    ).rejects.toThrow();
    expect(
      (
        await auth.handle(
          new Request(`${origin}/api/auth/sign-in/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify({
              email: "review.owner@example.test",
              password: "explicit-owner-password",
            }),
          }),
        )
      ).status,
    ).toBe(401);
    const login = await auth.handle(
      request("/api/auth/sign-in/email", "POST", {
        email: "Review.Owner@Example.TEST",
        password: "explicit-owner-password",
      }),
    );
    expect(login.status).toBe(200);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    await runtime.query(`update session set active_organization_id = $1 where user_id = $2`, [
      access.organization.id,
      access.account.id,
    ]);
    const signedIn = await (
      await auth.handle(request(capabilitiesPath, "GET", undefined, cookie))
    ).json();
    expect(signedIn.accountAuthentication).toBe("signedIn");
    await expect(
      auth.signInEmail!(
        { email: "review.owner@example.test", password: "explicit-owner-password" },
        new Headers(),
      ),
    ).rejects.toThrow("Paired device");
    await devices.revoke(credentialId);
    expect((await auth.handle(request(capabilitiesPath, "GET", undefined, cookie))).status).toBe(
      401,
    );
    await runtime.query(
      `update device_authority set state = state - 'loginRequired' where singleton = true`,
    );
    await expect(new HubDeviceAccess(runtime, false).authority.info()).rejects.toThrow(
      "Invalid device authority state",
    );
    await auth.close();
  } finally {
    await runtime.close();
    await rm(home, { recursive: true, force: true });
  }
}, 60_000);
