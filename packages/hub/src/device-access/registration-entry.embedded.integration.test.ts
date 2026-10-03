import { expect, test } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { createDeviceKey } from "@clisbot/device-access/proof";
import { EMAIL_REGISTRATION_PATHS } from "../auth/registration-contract.js";
import type { VerificationEmail } from "../invitations/index.js";
import {
  testHub,
  DEVICE,
  TEST_PASSWORD,
  jsonRequest,
  readJson,
  loginChallengeSchema,
  credentialSchema,
  accountCookie,
} from "./test-hub.js";

test("an invited password signup uses account entry without manual pairing and cannot widen invitation authority", async () => {
  const hub = await testHub({ bootstrap: true });
  try {
    const bootstrap = (
      await hub.runtime.query<{ owner: string; organization: string }>(
        `select owner_user_id as owner, organization_id as organization from instance_bootstrap`,
      )
    ).rows[0]!;
    const invitationId = randomUUID();
    await hub.runtime.query(
      `insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
      values ($1, $2, 'invited@example.test', 'member', 'pending', now() + interval '1 day', $3)`,
      [invitationId, bootstrap.organization, bootstrap.owner],
    );
    const key = createDeviceKey(randomBytes(32));
    const challenge = await readJson(
      await hub.auth.handle(jsonRequest(DEVICE + "/login-challenge", { publicKey: key.publicKey })),
      loginChallengeSchema,
    );
    const credentialId = "login:" + challenge.challengeId;
    const signUp = (email: string) =>
      hub.auth.handle(
        hub.request(key, credentialId, "/api/auth/sign-up/email", "POST", {
          name: "Invited",
          email,
          password: TEST_PASSWORD,
          invitation: invitationId,
        }),
      );
    expect((await signUp("not-invited@example.test")).status).toBe(403);
    expect(await hub.devices.authority.list()).toHaveLength(0);
    const response = await signUp("invited@example.test");
    expect(response.status).toBe(200);
    const credential = credentialSchema.parse(
      JSON.parse(response.headers.get("x-clisbot-device-credential")!),
    );
    const cookie = accountCookie(response);
    await hub.auth.handle(
      hub.request(
        key,
        credential.credentialId,
        "/api/auth/clisbot/state",
        "GET",
        undefined,
        cookie,
      ),
    );
    const accepted = await hub.auth.handle(
      hub.request(
        key,
        credential.credentialId,
        "/api/auth/clisbot/accept-invitation",
        "POST",
        { invitationId },
        cookie,
      ),
    );
    expect(accepted.status).toBe(200);
    const access = await hub.auth.resolveOrganizationAccess(
      hub.request(
        key,
        credential.credentialId,
        "/api/management/organizations",
        "GET",
        undefined,
        cookie,
      ),
    );
    expect(access.membership.role).toBe("member");
    expect(access.organization.id).toBe(bootstrap.organization);
    expect((await hub.devices.authority.list())[0]?.grant).toBe("login");
  } finally {
    await hub.close();
  }
}, 60_000);

test("verified-email registration can complete through ephemeral account entry, with no device grant before proof", async () => {
  const messages: VerificationEmail[] = [];
  const hub = await testHub({
    bootstrap: true,
    policy: { registrationMode: "domain_self_registration", allowedDomains: ["example.test"] },
    verificationMailer: {
      send: async (message) => {
        messages.push(message);
      },
    },
  });
  try {
    const key = createDeviceKey(randomBytes(32));
    const challenge = await readJson(
      await hub.auth.handle(jsonRequest(DEVICE + "/login-challenge", { publicKey: key.publicKey })),
      loginChallengeSchema,
    );
    const credentialId = "login:" + challenge.challengeId;
    const request = (path: string, body: unknown) =>
      hub.auth.handle(hub.request(key, credentialId, path, "POST", body));
    expect(
      (await request(EMAIL_REGISTRATION_PATHS.start, { email: "verified@example.test" })).status,
    ).toBe(202);
    expect(messages).toHaveLength(1);
    expect(await hub.devices.authority.list()).toHaveLength(0);
    const token = new URL(messages[0]!.link).searchParams.get("emailRegistration");
    expect(token).toBeTruthy();
    expect((await request(EMAIL_REGISTRATION_PATHS.inspect, { token })).status).toBe(200);
    const response = await request(EMAIL_REGISTRATION_PATHS.complete, {
      token,
      name: "Verified",
      password: TEST_PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-clisbot-device-credential")).toBeTruthy();
    expect((await hub.devices.authority.list())[0]?.grant).toBe("login");
    expect(
      (
        await hub.runtime.query(
          `select * from "user" where email = 'verified@example.test' and email_verified`,
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await request(EMAIL_REGISTRATION_PATHS.complete, {
          token,
          name: "Replay",
          password: TEST_PASSWORD,
        })
      ).status,
    ).toBe(401);
  } finally {
    await hub.close();
  }
}, 60_000);
