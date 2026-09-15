import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createDatabase,
  createPostgresQueryRuntime,
  testDatabaseLocks,
  testDatabaseRuntime,
} from "../db/test-utils/runtime.js";
import type { VerificationEmail, VerificationMailer } from "../invitations/index.js";
import { cliCredentialParts } from "./cli-credentials.js";
import { composeEntitlements } from "./entitlements.js";
import type { InstanceAuthPolicy } from "./instance-policy.js";
import { createAuthServer, type AuthServer } from "./server.js";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "long-password-123";

interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
}

describe("domain self-registration, email verification, and Google sign-in", () => {
  let postgres: StartedPostgreSqlContainer;
  const realFetch = globalThis.fetch;
  let googleProfile: GoogleProfile | undefined;
  const hubs: RegistrationHub[] = [];

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    // Only Google's token endpoint is faked; Better Auth decodes the returned ID token as usual.
    globalThis.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        assert.ok(googleProfile !== undefined, "test did not choose a Google profile");
        return Promise.resolve(
          Response.json({
            access_token: "google-access-token",
            token_type: "Bearer",
            expires_in: 3600,
            id_token: unsignedJwt({ ...googleProfile, name: "Google User" }),
          }),
        );
      }
      return realFetch(input, init);
    };
  }, 120_000);

  afterEach(async () => {
    await Promise.all(hubs.splice(0).map((hub) => hub.stop()));
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await postgres.stop();
  }, 120_000);

  async function start(options: Partial<HubOptions> = {}): Promise<RegistrationHub> {
    const hub = await RegistrationHub.start(postgres, {
      mode: "domain_self_registration",
      allowedDomains: ["acme.test"],
      mailer: new RecordingVerificationMailer(),
      google: false,
      ...options,
    });
    hubs.push(hub);
    return hub;
  }

  async function google(hub: RegistrationHub, identity: GoogleProfile, invitation?: string) {
    googleProfile = identity;
    return hub.googleSignIn(invitation);
  }

  async function claimWithGoogle(hub: RegistrationHub, identity: GoogleProfile) {
    googleProfile = identity;
    return hub.googleSignIn(undefined, "claimInstance");
  }

  it("creates no account until the emailed link is used, then admits and signs in", async () => {
    const hub = await start();
    const started = await hub.startRegistration("first@acme.test");
    assert.equal(started.status, 202);
    assert.equal(await hub.count(`select count(*) from "user"`), 0);
    assert.equal((await hub.signUp("first@acme.test")).status, 403);

    const token = hub.mailer.lastToken("first@acme.test");
    const inspected = await hub.post("/api/auth/paseo/registration/inspect", { token });
    assert.deepEqual(
      { ...((await inspected.json()) as object), expiresAt: undefined },
      { status: "valid", email: "first@acme.test", expiresAt: undefined },
    );
    const completed = await hub.completeRegistration(token);
    assert.equal(completed.status, 200);
    assert.ok(completed.headers.getSetCookie().length > 0);
    assert.deepEqual(await hub.roles("acme.test"), [["first@acme.test", "owner"]]);
    const sessions = await hub.query<{ active_organization_id: string | null }>(
      `select active_organization_id from session`,
    );
    assert.equal(typeof sessions[0]?.active_organization_id, "string");

    const replay = await hub.completeRegistration(token);
    assert.equal((await replay.json()).status, "used");
    assert.equal((await hub.signIn("first@acme.test")).status, 200);

    await hub.register("second@acme.test");
    assert.deepEqual(await hub.roles("acme.test"), [
      ["first@acme.test", "owner"],
      ["second@acme.test", "member"],
    ]);
  }, 120_000);

  it("gives a stranger who types someone else's address nothing to sign in with", async () => {
    const hub = await start();
    await hub.startRegistration("victim@acme.test");
    assert.equal(await hub.count(`select count(*) from "user"`), 0);
    const attackerSignIn = await hub.post("/api/auth/sign-in/email", {
      email: "victim@acme.test",
      password: "attacker-password-123",
    });
    assert.equal(attackerSignIn.status, 401);

    await hub.completeRegistration(hub.mailer.lastToken("victim@acme.test"), "Victim");
    const afterward = await hub.post("/api/auth/sign-in/email", {
      email: "victim@acme.test",
      password: "attacker-password-123",
    });
    assert.equal(afterward.status, 401);
  }, 120_000);

  it("rejects expired, unknown, and rate-limited links, and answers alike for existing accounts", async () => {
    const hub = await start();
    await hub.startRegistration("late@acme.test");
    const token = hub.mailer.lastToken("late@acme.test");
    await hub.query(
      `update email_verification_tokens set expires_at = now() - interval '1 second'`,
    );
    assert.equal((await hub.completeRegistration(token)).status, 410);
    assert.equal((await hub.completeRegistration("x".repeat(43))).status, 404);

    assert.equal((await hub.startRegistration("late@acme.test")).status, 429);
    await hub.query(
      `update email_verification_tokens set created_at = now() - interval '2 minutes'`,
    );
    assert.equal((await hub.startRegistration("late@acme.test")).status, 202);
    assert.equal(
      (await hub.completeRegistration(hub.mailer.lastToken("late@acme.test"))).status,
      200,
    );

    const sentBefore = hub.mailer.sent.length;
    assert.equal((await hub.startRegistration("late@acme.test")).status, 202);
    assert.equal(hub.mailer.sent.length, sentBefore);
  }, 120_000);

  it("rechecks the allowlist when the link is used and grants nothing once removed", async () => {
    const hub = await start();
    await hub.startRegistration("removed@acme.test");
    hub.policy.allowedDomains = [];
    const response = await hub.completeRegistration(hub.mailer.lastToken("removed@acme.test"));
    assert.equal(response.status, 403);
    assert.equal(await hub.count(`select count(*) from "user"`), 0);
  }, 120_000);

  it("rejects non-allowlisted addresses and reports missing or failed delivery", async () => {
    const hub = await start();
    assert.equal((await hub.startRegistration("person@other.test")).status, 403);
    const inviteOnly = await start({ mode: "invite_only", allowedDomains: [] });
    assert.equal((await inviteOnly.startRegistration("person@acme.test")).status, 403);
    assert.equal((await inviteOnly.signUp("person@acme.test")).status, 403);
    const noMail = await start({ mailer: undefined });
    assert.equal((await noMail.startRegistration("person@acme.test")).status, 503);
    const failing = await start({ mailer: new RecordingVerificationMailer(true) });
    assert.equal((await failing.startRegistration("unlucky@acme.test")).status, 502);
    assert.equal(await failing.count(`select count(*) from "user"`), 0);
  }, 120_000);

  it("lets an invitation win over the domain rule for invited and registered accounts", async () => {
    const hub = await start();
    const outside = await hub.seedInvitation("contractor@other.test", "Invited Org");
    assert.equal((await hub.signUp("contractor@other.test", outside.invitationId)).status, 200);

    const acmeInvite = await hub.seedInvitation("insider@acme.test", "Partner Org");
    await hub.register("insider@acme.test");
    assert.deepEqual(await hub.memberships("insider@acme.test"), [
      [acmeInvite.organizationId, "member"],
    ]);
    assert.equal(await hub.count(`select count(*) from organization_email_domains`), 0);
  }, 120_000);

  it("converges concurrent first registrations on one organization and one owner", async () => {
    const hub = await start();
    await Promise.all([hub.startRegistration("a@acme.test"), hub.startRegistration("b@acme.test")]);
    const tokens = [hub.mailer.lastToken("a@acme.test"), hub.mailer.lastToken("b@acme.test")];
    const results = await Promise.all(tokens.map((token) => hub.completeRegistration(token)));
    assert.deepEqual(
      results.map(({ status }) => status),
      [200, 200],
    );
    assert.equal(await hub.count(`select count(*) from organization`), 1);
    const roles = (await hub.roles("acme.test")).map(([, role]) => role).sort();
    assert.deepEqual(roles, ["member", "owner"]);
  }, 120_000);

  it("admits a verified Google domain user as owner and sets the active organization", async () => {
    const hub = await start({ google: true });
    const result = await google(hub, profile("owner@acme.test"));
    assert.equal(result.location, "/");
    assert.deepEqual(await hub.roles("acme.test"), [["owner@acme.test", "owner"]]);
    const sessions = await hub.query<{ active_organization_id: string | null }>(
      `select active_organization_id from session`,
    );
    assert.equal(typeof sessions[0]?.active_organization_id, "string");

    const unverified = await google(hub, {
      ...profile("unverified@acme.test"),
      email_verified: false,
    });
    assert.match(unverified.location, /error=google_email_unverified/u);
    const outsider = await google(hub, profile("person@gmail.com"));
    assert.match(outsider.location, /error=registration_closed/u);
    assert.equal(await hub.count(`select count(*) from "user"`), 1);
  }, 120_000);

  it("admits a Google user through the invitation carried in the OAuth state", async () => {
    const hub = await start({ google: true, mode: "invite_only", allowedDomains: [] });
    const invitation = await hub.seedInvitation("guest@gmail.com", "Guests");
    const result = await google(hub, profile("guest@gmail.com"), invitation.invitationId);
    assert.equal(result.location, "/");
    assert.deepEqual(await hub.memberships("guest@gmail.com"), [
      [invitation.organizationId, "member"],
    ]);
  }, 120_000);

  it("links Google to a verified password user without changing the user or memberships", async () => {
    const hub = await start({ google: true });
    await hub.register("linked@acme.test");
    const before = await hub.query<{ id: string }>(`select id from "user"`);

    const result = await google(hub, profile("linked@acme.test"));
    assert.equal(result.location, "/");
    assert.deepEqual(await hub.query(`select id from "user"`), before);
    assert.deepEqual(await hub.roles("acme.test"), [["linked@acme.test", "owner"]]);
    assert.deepEqual(await hub.providers("linked@acme.test"), ["credential", "google"]);
    assert.equal(await hub.count(`select count(*) from session`), 2);
  }, 120_000);

  it("revokes an unverified password account's access before linking Google", async () => {
    const hub = await start({ google: true, mode: "invite_only", allowedDomains: [] });
    const invitation = await hub.seedInvitation("victim@partner.test", "Partner");
    await hub.signUp("victim@partner.test", invitation.invitationId);
    await hub.query(
      `insert into member (id, organization_id, user_id, role)
       select $1, $2, id, 'member' from "user" where email = 'victim@partner.test'`,
      [randomUUID(), invitation.organizationId],
    );
    await hub.query(
      `insert into organization_cli_credentials (organization_id, prefix, verifier, created_by_user_id)
       select $1, 'paseo_cli_testprefix', 'verifier', id from "user" where email = 'victim@partner.test'`,
      [invitation.organizationId],
    );
    assert.equal(await hub.count(`select count(*) from session`), 1);

    const result = await google(hub, profile("victim@partner.test"));
    assert.equal(result.location, "/");
    assert.deepEqual(await hub.providers("victim@partner.test"), ["google"]);
    assert.equal(await hub.count(`select count(*) from session`), 1);
    assert.equal(
      await hub.count(`select count(*) from organization_cli_credentials where revoked_at is null`),
      0,
    );
    assert.deepEqual(await hub.memberships("victim@partner.test"), [
      [invitation.organizationId, "member"],
    ]);
    assert.equal((await hub.signIn("victim@partner.test")).status, 401);
  }, 120_000);

  it("describes a CLI credential's Hub, organization, approving account, and role", async () => {
    const hub = await start();
    await hub.register("cli@acme.test");
    const token = `paseo_cli_abcdefghijkl_${"s".repeat(43)}`;
    const parts = cliCredentialParts(token);
    await hub.query(
      `insert into organization_cli_credentials (organization_id, prefix, verifier, created_by_user_id)
       select m.organization_id, $1, $2, u.id from "user" u join member m on m.user_id = u.id
       where u.email = 'cli@acme.test'`,
      [parts.prefix, parts.verifier],
    );
    const identity = await hub.get("/api/auth/paseo/credential", token);
    assert.equal(identity.status, 200);
    const body = (await identity.json()) as Record<string, unknown>;
    assert.equal(body["hub"], ORIGIN);
    assert.equal(body["credential"], "cliCredential");
    assert.equal((body["organization"] as { name: string }).name, "acme.test");
    assert.equal((body["account"] as { email: string }).email, "cli@acme.test");
    assert.equal(body["role"], "owner");
    assert.equal((await hub.get("/api/auth/paseo/credential", `${token}x`)).status, 401);
  }, 120_000);

  it("claims a pristine Hub with Google and makes that account the operator", async () => {
    const hub = await start({ google: true, mode: "invite_only", allowedDomains: [] });
    const claimed = await claimWithGoogle(hub, profile("owner@gmail.com"));
    assert.equal(claimed.location, "/");
    const operators = await hub.query<{ email: string; email_verified: boolean }>(
      `select email, email_verified from "user" where is_instance_operator`,
    );
    assert.deepEqual(operators, [{ email: "owner@gmail.com", email_verified: true }]);
    assert.deepEqual(await hub.providers("owner@gmail.com"), ["google"]);
    assert.equal(
      await hub.count(`select count(*) from instance_bootstrap where completed_at is not null`),
      1,
    );
    assert.equal(await hub.count(`select count(*) from member where role = 'owner'`), 1);
    assert.equal(await hub.count(`select count(*) from pending_registrations`), 0);

    const second = await claimWithGoogle(hub, profile("late@gmail.com"));
    assert.match(second.location, /error=instance_unavailable/u);
    assert.equal(await hub.count(`select count(*) from "user"`), 1);
  }, 120_000);

  it("names the first organization after an allowlisted domain when Google claims the Hub", async () => {
    const hub = await start({ google: true });
    assert.equal((await claimWithGoogle(hub, profile("owner@acme.test"))).location, "/");
    assert.deepEqual(await hub.roles("acme.test"), [["owner@acme.test", "owner"]]);
    assert.equal((await google(hub, profile("colleague@acme.test"))).location, "/");
    assert.deepEqual(await hub.roles("acme.test"), [
      ["owner@acme.test", "owner"],
      ["colleague@acme.test", "member"],
    ]);
    assert.equal(await hub.count(`select count(*) from organization`), 1);
  }, 120_000);

  it("lets only an owner rename the organization, and only its name", async () => {
    const hub = await start({ google: true });
    await google(hub, profile("owner@acme.test"));
    const renamed = await hub.post("/api/auth/organization/update", {
      data: { name: " Acme Inc " },
    });
    assert.equal(renamed.status, 200);
    assert.deepEqual(await hub.query(`select name from organization`), [{ name: "Acme Inc" }]);

    const slug = await hub.post("/api/auth/organization/update", { data: { slug: "taken" } });
    assert.equal(((await slug.json()) as { code: string }).code, "organization_field_not_editable");
    const blank = await hub.post("/api/auth/organization/update", { data: { name: " " } });
    assert.equal(((await blank.json()) as { code: string }).code, "invalid_organization_name");

    await google(hub, profile("member@acme.test"));
    const member = await hub.post("/api/auth/organization/update", { data: { name: "Mine" } });
    assert.equal(member.status, 403);
    assert.deepEqual(await hub.query(`select name from organization`), [{ name: "Acme Inc" }]);
  }, 120_000);

  it("updates the signed-in profile through Better Auth and validates the image", async () => {
    const hub = await start({ google: true });
    await google(hub, profile("profile@acme.test"));

    const updated = await hub.post("/api/auth/update-user", {
      name: "  Ada Lovelace ",
      image: "https://lh3.googleusercontent.com/a/avatar",
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(
      await hub.query(`select name, image from "user" where email = 'profile@acme.test'`),
      [{ name: "Ada Lovelace", image: "https://lh3.googleusercontent.com/a/avatar" }],
    );
    const state = await hub.auth.handle(
      new Request(`${ORIGIN}/api/auth/paseo/state`, { headers: { cookie: hub.cookieHeader } }),
    );
    const body = (await state.json()) as { account?: { image?: string } };
    assert.equal(body.account?.image, "https://lh3.googleusercontent.com/a/avatar");

    for (const image of [
      "http://lh3.googleusercontent.com/a/avatar",
      "https://tracker.example.test/pixel.png",
      "https://user:pass@lh3.googleusercontent.com/a",
      "https://127.0.0.1/avatar.png",
      "javascript:alert(1)",
    ]) {
      const refused = await hub.post("/api/auth/update-user", { image });
      assert.equal(refused.status, 400, image);
      assert.equal(((await refused.json()) as { code: string }).code, "invalid_profile_image");
    }
    const blankName = await hub.post("/api/auth/update-user", { name: "   " });
    assert.equal(((await blankName.json()) as { code: string }).code, "invalid_profile_name");
    assert.equal((await hub.post("/api/auth/update-user", { image: null })).status, 200);
    await hub.post("/api/auth/update-user", { isInstanceOperator: true });
    assert.deepEqual(
      await hub.query(
        `select image, is_instance_operator from "user" where email = 'profile@acme.test'`,
      ),
      [{ image: null, is_instance_operator: false }],
    );
  }, 120_000);

  it("keeps setup open when a Google claim leaves an unadmitted account behind", async () => {
    const hub = await start({ google: true, mode: "invite_only", allowedDomains: [] });
    await hub.query(
      `insert into "user" (id, name, email, email_verified) values ('stray', 'Stray', 'stray@gmail.com', true)`,
    );
    await hub.query(`insert into pending_registrations (email) values ('stray@gmail.com')`);
    const claim = await hub.post("/api/auth/paseo/claim-instance", {
      email: "owner@example.test",
      password: PASSWORD,
    });
    assert.deepEqual(await claim.json(), { state: "claimed" });
  }, 120_000);

  it("clears a pending marker left behind for an account that was already admitted", async () => {
    const hub = await start();
    await hub.register("member@acme.test");
    await hub.query(`insert into pending_registrations (email) values ('member@acme.test')`);
    hub.policy.registrationMode = "invite_only";

    assert.equal((await hub.signIn("member@acme.test")).status, 200);
    assert.equal(await hub.count(`select count(*) from pending_registrations`), 0);
  }, 120_000);

  it("never links Google to an instance operator automatically", async () => {
    const hub = await start({ google: true, mode: "invite_only", allowedDomains: [] });
    await hub.query(
      `insert into "user" (id, name, email, email_verified, is_instance_operator)
       values ('operator', 'Operator', 'operator@gmail.com', true, true)`,
    );
    await hub.query(
      `insert into account (id, account_id, provider_id, user_id, password)
       values ('operator-password', 'operator', 'credential', 'operator', 'hash')`,
    );

    const result = await google(hub, profile("operator@gmail.com"));
    assert.match(result.location, /error=unable_to_link_account/u);
    assert.deepEqual(await hub.providers("operator@gmail.com"), ["credential"]);
    assert.equal(await hub.count(`select count(*) from session`), 0);
  }, 120_000);

  it("refuses a Google identity linked to one user whose email now belongs to another", async () => {
    const hub = await start({ google: true });
    await google(hub, profile("original@acme.test", "google-subject-1"));
    await hub.register("renamed@acme.test");
    const sessionsBefore = await hub.count(`select count(*) from session`);

    const result = await google(hub, profile("renamed@acme.test", "google-subject-1"));
    assert.match(result.location, /error=account_already_linked_to_different_user/u);
    assert.equal(await hub.count(`select count(*) from session`), sessionsBefore);
    assert.deepEqual(await hub.providers("renamed@acme.test"), ["credential"]);
  }, 120_000);
});

function profile(email: string, sub = `google-${email}`): GoogleProfile {
  return { sub, email, email_verified: true };
}

function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

interface HubOptions {
  mode: InstanceAuthPolicy["registrationMode"];
  allowedDomains: string[];
  mailer: RecordingVerificationMailer | undefined;
  google: boolean;
}

class RecordingVerificationMailer implements VerificationMailer {
  readonly sent: VerificationEmail[] = [];

  constructor(private readonly fail = false) {}

  send(verification: VerificationEmail): Promise<void> {
    if (this.fail) return Promise.reject(new Error("Resend rejected verification email"));
    this.sent.push(verification);
    return Promise.resolve();
  }

  lastToken(email: string): string {
    const link = this.sent.findLast((message) => message.email === email)?.link;
    assert.ok(link !== undefined, `no verification sent to ${email}`);
    const token = new URL(link).searchParams.get("emailRegistration");
    assert.ok(token !== null);
    return token;
  }
}

class RegistrationHub {
  private cookie = "";

  private constructor(
    private readonly url: string,
    readonly auth: AuthServer,
    private readonly close: () => Promise<void>,
    readonly policy: InstanceAuthPolicy,
    readonly mailer: RecordingVerificationMailer,
  ) {}

  static async start(
    postgres: StartedPostgreSqlContainer,
    options: HubOptions,
  ): Promise<RegistrationHub> {
    const url = new URL(postgres.getConnectionUri());
    url.pathname = `/registration_${randomUUID().replaceAll("-", "")}`;
    const database = await createDatabase(url.toString());
    const entitlements = composeEntitlements(database, testDatabaseRuntime(database));
    const policy: InstanceAuthPolicy = {
      registrationMode: options.mode,
      organizationCreation: "disabled",
      bootstrap: undefined,
      allowedDomains: options.allowedDomains,
    };
    const mailer = options.mailer ?? new RecordingVerificationMailer();
    const auth = createAuthServer({
      database: testDatabaseRuntime(database),
      locks: testDatabaseLocks(database),
      entitlements: entitlements.service,
      secret: "domain-registration-secret-at-least-32-characters",
      baseURL: ORIGIN,
      policy,
      ...(options.mailer === undefined ? {} : { verificationMailer: options.mailer }),
      ...(options.google ? { google: { clientId: "client-id", clientSecret: "secret" } } : {}),
    });
    await auth.initialize?.();
    return new RegistrationHub(
      url.toString(),
      auth,
      async () => {
        await entitlements.close();
        await database.close();
      },
      policy,
      mailer,
    );
  }

  signUp(email: string, invitation?: string): Promise<Response> {
    const path = invitation === undefined ? "" : `?invitation=${encodeURIComponent(invitation)}`;
    return this.post(`/api/auth/sign-up/email${path}`, { name: "User", email, password: PASSWORD });
  }

  get cookieHeader(): string {
    return this.cookie;
  }

  startRegistration(email: string): Promise<Response> {
    return this.post("/api/auth/paseo/registration/start", { email });
  }

  async completeRegistration(token: string, name = "User"): Promise<Response> {
    const response = await this.post("/api/auth/paseo/registration/complete", {
      token,
      name,
      password: PASSWORD,
    });
    this.rememberCookies(response);
    return response;
  }

  async register(email: string): Promise<void> {
    assert.equal((await this.startRegistration(email)).status, 202);
    const completed = await this.completeRegistration(this.mailer.lastToken(email));
    assert.equal(completed.status, 200);
  }

  async signIn(email: string): Promise<Response> {
    const response = await this.post("/api/auth/sign-in/email", { email, password: PASSWORD });
    this.rememberCookies(response);
    return response;
  }

  async googleSignIn(invitation?: string, intent?: "claimInstance"): Promise<{ location: string }> {
    const start = await this.post("/api/auth/sign-in/social", {
      provider: "google",
      callbackURL: "/",
      ...(invitation === undefined ? {} : { invitation }),
      ...(intent === undefined ? {} : { intent }),
    });
    assert.equal(start.status, 200);
    this.rememberCookies(start);
    const state = new URL(((await start.json()) as { url: string }).url).searchParams.get("state");
    assert.ok(state !== null);
    const callback = await this.auth.handle(
      new Request(`${ORIGIN}/api/auth/callback/google?code=code&state=${state}`, {
        headers: { cookie: this.cookie },
      }),
    );
    this.rememberCookies(callback);
    const location = callback.headers.get("location");
    assert.ok(location !== null, `callback returned ${callback.status}`);
    return { location: location.replace(ORIGIN, "") };
  }

  get(path: string, bearer: string): Promise<Response> {
    return this.auth.handle(
      new Request(`${ORIGIN}${path}`, { headers: { authorization: `Bearer ${bearer}` } }),
    );
  }

  post(path: string, body: unknown): Promise<Response> {
    return this.auth.handle(
      new Request(`${ORIGIN}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          ...(this.cookie.length === 0 ? {} : { cookie: this.cookie }),
        },
        body: JSON.stringify(body),
      }),
    );
  }

  async seedInvitation(
    email: string,
    organizationName: string,
  ): Promise<{ invitationId: string; organizationId: string }> {
    const id = randomUUID();
    const organizationId = `org-${id}`;
    await this.query(`insert into organization (id, name, slug) values ($1, $2, $1)`, [
      organizationId,
      organizationName,
    ]);
    await this.query(
      `insert into "user" (id, name, email, email_verified) values ($1, 'Inviter', $2, true)`,
      [`inviter-${id}`, `inviter-${id}@inviter.test`],
    );
    await this.query(
      `insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')`,
      [`member-${id}`, organizationId, `inviter-${id}`],
    );
    await this.query(
      `insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
       values ($1, $2, $3, 'member', 'pending', now() + interval '1 day', $4)`,
      [id, organizationId, email, `inviter-${id}`],
    );
    return { invitationId: id, organizationId };
  }

  async roles(domain: string): Promise<string[][]> {
    const rows = await this.query<{ email: string; role: string }>(
      `select u.email, m.role from organization_email_domains d
       join member m on m.organization_id = d.organization_id
       join "user" u on u.id = m.user_id
       where d.domain = $1 order by m.created_at, u.email`,
      [domain],
    );
    return rows.map(({ email, role }) => [email, role]);
  }

  async memberships(email: string): Promise<string[][]> {
    const rows = await this.query<{ organization_id: string; role: string }>(
      `select m.organization_id, m.role from member m join "user" u on u.id = m.user_id
       where u.email = $1 order by m.organization_id`,
      [email],
    );
    return rows.map(({ organization_id, role }) => [organization_id, role]);
  }

  async providers(email: string): Promise<string[]> {
    const rows = await this.query<{ provider_id: string }>(
      `select a.provider_id from account a join "user" u on u.id = a.user_id
       where u.email = $1 order by a.provider_id`,
      [email],
    );
    return rows.map(({ provider_id }) => provider_id);
  }

  async count(sql: string): Promise<number> {
    const rows = await this.query<{ count: string }>(sql);
    return Number(rows[0]?.count ?? 0);
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<Row[]> {
    const client = await createPostgresQueryRuntime(this.url);
    try {
      return (await client.query<Row>(sql, values)).rows;
    } finally {
      await client.close();
    }
  }

  async stop(): Promise<void> {
    await this.auth.close();
    await this.close();
  }

  private rememberCookies(response: Response): void {
    const jar = new Map(
      this.cookie
        .split("; ")
        .filter((pair) => pair.length > 0)
        .map((pair) => [pair.split("=", 1)[0]!, pair] as const),
    );
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0]!;
      jar.set(pair.split("=", 1)[0]!, pair);
    }
    this.cookie = [...jar.values()].join("; ");
  }
}
