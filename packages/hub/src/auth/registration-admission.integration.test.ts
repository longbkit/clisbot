import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresQueryRuntime } from "../db/test-utils/runtime.js";
import {
  createDatabase,
  testDatabaseLocks,
  testDatabaseRuntime,
} from "../db/test-utils/runtime.js";
import { createAuthServer, type AuthServer } from "./server.js";
import { composeEntitlements } from "./entitlements.js";

describe("registration policy boundary", () => {
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
  }, 120_000);

  afterAll(async () => {
    await postgres.stop();
  }, 120_000);

  it("closes both raw and server-function signup when registration is disabled", async () => {
    const { auth, url } = await startAuth("disabled");
    const raw = await rawSignUp(auth, "closed@example.test");
    assert.equal(raw.status, 403);
    assert.deepEqual(await raw.json(), { error: "registration_closed" });
    await assert.rejects(
      auth.signUpEmail!(
        { name: "Closed", email: "closed-function@example.test", password: "long-password-123" },
        originHeaders(),
      ),
    );
    assert.equal(await userCount(url), 0);
    await auth.close();
  }, 120_000);

  it("rejects form-encoded raw signup before Better Auth in closed modes", async () => {
    const disabled = await startAuth("disabled");
    const disabledForm = await rawFormSignUp(disabled.auth, "form-disabled@example.test");
    assert.equal(disabledForm.status, 400);
    assert.equal(await userCount(disabled.url), 0);
    await disabled.auth.close();

    const inviteOnly = await startAuth("invite_only");
    const inviteForm = await rawFormSignUp(inviteOnly.auth, "form-invite@example.test");
    assert.equal(inviteForm.status, 400);
    assert.equal(await userCount(inviteOnly.url), 0);
    await inviteOnly.auth.close();
  }, 120_000);

  it("requires the invitation capability and admits both entry points only for a live email match", async () => {
    const { auth, url } = await startAuth("invite_only");
    const invitation = await seedInvitation(url, "invited@example.test", "pending");
    assert.equal((await rawSignUp(auth, "uninvited@example.test", invitation)).status, 403);
    assert.equal((await rawSignUp(auth, "invited@example.test", "wrong-id")).status, 403);
    const admitted = await rawSignUp(auth, "invited@example.test", invitation);
    assert.equal(admitted.status, 200);
    const secondInvitation = await seedInvitation(url, "function@example.test", "pending");
    await auth.signUpEmail!(
      { name: "Function", email: "function@example.test", password: "long-password-123" },
      originHeaders(),
      secondInvitation,
    );
    assert.equal(await userCount(url), 4);
    await auth.close();
  }, 120_000);

  it("rejects expired, canceled, and reused invitation credentials", async () => {
    const { auth, url } = await startAuth("invite_only");
    const expired = await seedInvitation(url, "expired@example.test", "pending", true);
    const canceled = await seedInvitation(url, "canceled@example.test", "canceled");
    assert.equal((await rawSignUp(auth, "expired@example.test", expired)).status, 403);
    assert.equal((await rawSignUp(auth, "canceled@example.test", canceled)).status, 403);
    const reused = await seedInvitation(url, "reused@example.test", "pending");
    assert.equal((await rawSignUp(auth, "reused@example.test", reused)).status, 200);
    assert.equal((await rawSignUp(auth, "reused@example.test", reused)).status, 403);
    await auth.close();
  }, 120_000);

  it("serializes concurrent signups for one invitation at the public boundary", async () => {
    const { auth, url } = await startAuth("invite_only");
    const invitation = await seedInvitation(url, "racing@example.test", "pending");
    const responses = await Promise.all([
      rawSignUp(auth, "racing@example.test", invitation),
      rawSignUp(auth, "racing@example.test", invitation),
    ]);
    assert.deepEqual(
      responses.map(({ status }) => status).sort((left, right) => left - right),
      [200, 403],
    );
    assert.equal(await userCount(url), 2);
    await auth.close();
  }, 120_000);

  it("admits raw and server-function signup in open mode", async () => {
    const { auth } = await startAuth("open");
    assert.equal((await rawSignUp(auth, "raw-open@example.test")).status, 200);
    await auth.signUpEmail!(
      { name: "Open", email: "function-open@example.test", password: "long-password-123" },
      originHeaders(),
    );
    await auth.close();
  }, 120_000);

  async function startAuth(registrationMode: "open" | "invite_only" | "disabled") {
    const url = await isolatedDatabaseUrl(postgres.getConnectionUri(), registrationMode);
    const database = await createDatabase(url);
    const entitlements = composeEntitlements(database, testDatabaseRuntime(database));
    const auth = createAuthServer({
      database: testDatabaseRuntime(database),
      locks: testDatabaseLocks(database),
      entitlements: entitlements.service,
      secret: "registration-policy-secret-at-least-32-characters",
      baseURL: "http://localhost:3000",
      policy: { registrationMode, organizationCreation: "disabled", bootstrap: undefined },
    });
    return {
      auth: {
        ...auth,
        close: async () => {
          await auth.close();
          await entitlements.close();
          await database.close();
        },
      },
      url,
    };
  }
});

async function rawSignUp(auth: AuthServer, email: string, invitation?: string): Promise<Response> {
  const url = new URL("http://localhost:3000/api/auth/sign-up/email");
  if (invitation !== undefined) url.searchParams.set("invitation", invitation);
  return auth.handle(
    new Request(url, {
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ name: "Policy User", email, password: "long-password-123" }),
    }),
  );
}

async function rawFormSignUp(auth: AuthServer, email: string): Promise<Response> {
  return auth.handle(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        name: "Form User",
        email,
        password: "long-password-123",
      }),
    }),
  );
}

async function seedInvitation(
  url: string,
  email: string,
  status: "pending" | "canceled",
  expired = false,
): Promise<string> {
  const client = await createPostgresQueryRuntime(url);

  const id = randomUUID();
  const organizationId = `org-${id}`;
  const userId = `user-${id}`;
  await client.query(`insert into organization (id, name, slug) values ($1, 'Invites', $1)`, [
    organizationId,
  ]);
  await client.query(
    `insert into "user" (id, name, email, email_verified) values ($1, 'Inviter', $2, true)`,
    [userId, `inviter-${id}@example.test`],
  );
  await client.query(
    `insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')`,
    [`member-${id}`, organizationId, userId],
  );
  await client.query(
    `insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
     values ($1, $2, $3, 'member', $4, $5, $6)`,
    [
      id,
      organizationId,
      email,
      status,
      expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 86_400_000),
      userId,
    ],
  );
  await client.close();
  return id;
}

async function userCount(url: string): Promise<number> {
  const client = await createPostgresQueryRuntime(url);

  const result = await client.query<{ count: number }>(
    `select count(*)::integer as count from "user"`,
  );
  await client.close();
  return result.rows[0]!.count;
}

async function isolatedDatabaseUrl(baseUrl: string, name: string): Promise<string> {
  const base = new URL(baseUrl);
  base.pathname = "/postgres";
  const admin = await createPostgresQueryRuntime(base.toString());

  const databaseName = `${name}_${randomUUID().slice(0, 8)}`;
  await admin.query(`create database "${databaseName}"`);
  await admin.close();
  base.pathname = `/${databaseName}`;
  return base.toString();
}

function originHeaders(): Headers {
  return new Headers({ origin: "http://localhost:3000" });
}
