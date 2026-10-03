import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDeviceKey,
  digest,
  httpBinding,
  signDeviceProof,
  type DeviceKey,
} from "@clisbot/device-access/proof";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import { createDatabase } from "../db/pg.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { composeEntitlements } from "../auth/entitlements.js";
import { createAuthServer } from "../auth/server.js";
import type { InstanceAuthPolicy } from "../auth/instance-policy.js";
import type { GoogleAuthConfig, GoogleIdTokenConfig } from "../auth/google-sign-in.js";
import type { VerificationMailer } from "../invitations/index.js";
import { HubDeviceAccess } from "./index.js";
import { z } from "zod";

export const loginChallengeSchema = z.object({
  hubId: z.string(),
  challengeId: z.string(),
  expiresAt: z.number(),
});
export const credentialSchema = z.object({ backendId: z.string(), credentialId: z.string() });
export const googleChallengeSchema = z.object({
  transactionId: z.string(),
  nonce: z.string(),
  clientId: z.string(),
  expiresAt: z.number(),
});
export async function readJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const value: unknown = await response.json();
  return schema.parse(value);
}

export const TEST_ORIGIN = "http://hub-auth-entry.test";
export const TEST_OPERATOR = "local-operator-fixture-secret";
export const TEST_PASSWORD = "correct-owner-password";
export const LOGIN = "/api/auth/sign-in/email";
export const DEVICE = "/api/auth/clisbot/device";

export async function testHub(
  options: {
    personal?: boolean;
    bootstrap?: boolean;
    google?: GoogleAuthConfig;
    googleIdToken?: GoogleIdTokenConfig;
    policy?: Partial<InstanceAuthPolicy>;
    verificationMailer?: VerificationMailer;
    featureOff?: boolean;
    masterPassword?: string;
  } = {},
) {
  const home = await mkdtemp(join(tmpdir(), "clisbot-hub-entry-"));
  const { runtime, locks } = await embeddedDatabaseRuntime(join(home, "database"));
  await runtime.migrate();
  const database = createDatabase(runtime, locks, createTestCredentialCipher());
  const entitlements = composeEntitlements(database, runtime);
  const devices = new HubDeviceAccess(runtime, !options.personal, undefined, TEST_OPERATOR);
  const policy: InstanceAuthPolicy = {
    registrationMode: "invite_only",
    organizationCreation: "disabled",
    bootstrap: options.bootstrap
      ? { organizationName: "Work", ownerEmail: "owner@example.test", ownerPassword: TEST_PASSWORD }
      : undefined,
    ...options.policy,
  };
  const auth = createAuthServer({
    database: runtime,
    locks,
    entitlements: entitlements.service,
    secret: "hub-entry-fixture-only-secret-32-characters",
    baseURL: TEST_ORIGIN,
    ...(options.featureOff ? {} : { deviceAccess: devices }),
    policy,
    ...(options.google ? { google: options.google } : {}),
    ...(options.googleIdToken ? { googleIdToken: options.googleIdToken } : {}),
    ...(options.masterPassword ? { masterPassword: options.masterPassword } : {}),
    ...(options.verificationMailer ? { verificationMailer: options.verificationMailer } : {}),
  });
  await auth.initialize?.();
  // These fixtures test entry/session authority after the existing forced-password-change journey.
  if (options.bootstrap) await runtime.query(`update "user" set must_change_password = false`);
  const hubId = (await devices.authority.info()).backendId;
  const request = (
    key: DeviceKey,
    credentialId: string,
    path: string,
    method = "GET",
    data?: unknown,
    cookie?: string,
    setupToken?: string,
  ) => {
    const body = data === undefined ? "" : JSON.stringify(data);
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
    return new Request(TEST_ORIGIN + path, {
      method,
      headers: {
        "x-clisbot-device-proof": JSON.stringify(proof),
        Origin: TEST_ORIGIN,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(setupToken ? { "x-clisbot-owner-setup": setupToken } : {}),
      },
      ...(body ? { body } : {}),
    });
  };
  const pair = async (label = "My phone") => {
    const invitation = await devices.createInvitation({ label });
    const key = createDeviceKey(randomBytes(32));
    const proof = signDeviceProof({
      key,
      proof: {
        backendId: hubId,
        credentialId: "pair",
        timestamp: Date.now(),
        nonce: randomBytes(24).toString("base64url"),
      },
      context: { purpose: "pair", binding: digest(invitation.token) },
    });
    const response = await auth.handle(
      new Request(TEST_ORIGIN + DEVICE + "/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: invitation.token, publicKey: key.publicKey, proof }),
      }),
    );
    const result = await readJson(response, z.object({ credentialId: z.string() }));
    return { key, credentialId: result.credentialId, ownerSetupToken: invitation.ownerSetupToken };
  };
  return {
    auth,
    devices,
    runtime,
    hubId,
    request,
    pair,
    async close() {
      await auth.close();
      await runtime.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

export function accountCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

export function jsonRequest(path: string, body: unknown): Request {
  return new Request(TEST_ORIGIN + path, {
    method: "POST",
    headers: { Origin: TEST_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
