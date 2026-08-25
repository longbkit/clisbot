import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresQueryRuntime } from "../db/test-utils/runtime.js";
import { z } from "zod";
import {
  createDatabase,
  testDatabaseLocks,
  testDatabaseRuntime,
} from "../db/test-utils/runtime.js";
import { InstanceBootstrapError, InstanceSetup } from "./index.js";
import { createAuthServer, type AuthServer } from "../auth/server.js";
import { composeEntitlements } from "../auth/entitlements.js";
import type { InstanceAuthPolicy } from "../auth/instance-policy.js";
import { postgresDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import { UNLIMITED_PROVISIONING } from "../organizations/provisioning.js";

const policy: InstanceAuthPolicy = {
  registrationMode: "invite_only",
  organizationCreation: "disabled",
  bootstrap: {
    organizationName: "Paseo Customer",
    ownerEmail: "owner@example.test",
    ownerPassword: "temporary-owner-password",
  },
};

describe("instance bootstrap and first-login boundary", () => {
  let postgres: StartedPostgreSqlContainer;
  let databaseUrl: string;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    databaseUrl = postgres.getConnectionUri();
  }, 120_000);

  afterAll(async () => {
    await postgres.stop();
  }, 120_000);

  it("creates one owner with a forced password change and is restart-idempotent", async () => {
    const pool = await migratedPool(databaseUrl);
    await bootstrapFromEnvironment(pool, policy);
    await pool.runtime.close();

    const first = await queryBootstrapState(databaseUrl);
    assert.equal(first.organizationCount, 1);
    assert.equal(first.ownerCount, 1);
    assert.equal(first.accountCount, 1);
    assert.equal(first.projectCount, 1);
    assert.equal(first.sourceCount, 1);
    assert.equal(first.mustChangePassword, true);
    assert.equal(first.completionOrganizationId, first.organizationId);

    const client = await createPostgresQueryRuntime(databaseUrl);

    await client.query(`update "user" set must_change_password = false where email = $1`, [
      policy.bootstrap!.ownerEmail,
    ]);
    await client.close();
    const restarted = await migratedPool(databaseUrl);
    await bootstrapFromEnvironment(restarted, policy);
    await restarted.runtime.close();
    const afterRestart = await queryBootstrapState(databaseUrl);
    assert.equal(afterRestart.mustChangePassword, false);
    assert.deepEqual({ ...afterRestart, mustChangePassword: true }, first);
    const completedWithoutPassword = await migratedPool(databaseUrl);
    await bootstrapFromEnvironment(completedWithoutPassword, {
      ...policy,
      bootstrap: { ...policy.bootstrap!, ownerPassword: undefined },
    });
    await completedWithoutPassword.runtime.close();
    assert.equal((await queryBootstrapState(databaseUrl)).mustChangePassword, false);
  }, 120_000);

  it("does not write identity data when the configured owner conflicts", async () => {
    const isolated = await isolatedDatabaseUrl(databaseUrl, "bootstrap_conflict");
    const database = await createDatabase(isolated);
    const client = await createPostgresQueryRuntime(isolated);

    await client.query(
      `insert into "user" (id, name, email, email_verified) values ('existing', 'Existing', $1, true)`,
      [policy.bootstrap!.ownerEmail],
    );
    await client.close();
    const pool = await postgresDatabaseRuntime(isolated);
    await assert.rejects(
      bootstrapFromEnvironment(pool, policy),
      (error: unknown) =>
        error instanceof InstanceBootstrapError && error.message.includes("already belongs"),
    );
    await pool.runtime.close();
    await database.close();
    const verification = await queryBootstrapState(isolated);
    assert.equal(verification.organizationCount, 0);
    assert.equal(verification.ownerCount, 0);
    assert.equal(verification.bootstrapRows, 0);
  }, 120_000);

  it("requires the temporary password until a bootstrap ledger exists", async () => {
    const isolated = await isolatedDatabaseUrl(databaseUrl, "bootstrap_missing_password");
    const pool = await migratedPool(isolated);
    await assert.rejects(
      bootstrapFromEnvironment(pool, {
        ...policy,
        bootstrap: { ...policy.bootstrap!, ownerPassword: undefined },
      }),
      (error: unknown) =>
        error instanceof InstanceBootstrapError &&
        error.message.includes("PASEO_BOOTSTRAP_OWNER_PASSWORD"),
    );
    await pool.runtime.close();
    const result = await queryBootstrapState(isolated);
    assert.equal(result.organizationCount, 0);
    assert.equal(result.ownerCount, 0);
    assert.equal(result.bootstrapRows, 0);
  }, 120_000);

  it("serializes concurrent production starts into one bootstrap result", async () => {
    const isolated = await isolatedDatabaseUrl(databaseUrl, "bootstrap_race");
    const first = await migratedPool(isolated);
    const second = await postgresDatabaseRuntime(isolated);
    await Promise.all([
      bootstrapFromEnvironment(first, policy),
      bootstrapFromEnvironment(second, policy),
    ]);
    await first.runtime.close();
    await second.runtime.close();
    const result = await queryBootstrapState(isolated);
    assert.equal(result.organizationCount, 1);
    assert.equal(result.ownerCount, 1);
    assert.equal(result.accountCount, 1);
    assert.equal(result.projectCount, 1);
    assert.equal(result.sourceCount, 1);
    assert.equal(result.bootstrapRows, 1);
  }, 120_000);

  it("gates every browser product boundary until the owner replaces the password", async () => {
    const isolated = await isolatedDatabaseUrl(databaseUrl, "bootstrap_gate");
    const pool = await migratedPool(isolated);
    await bootstrapFromEnvironment(pool, policy);
    await pool.runtime.close();
    const database = await createDatabase(isolated);
    const entitlements = composeEntitlements(database, testDatabaseRuntime(database));
    const auth = createAuthServer({
      database: testDatabaseRuntime(database),
      locks: testDatabaseLocks(database),
      entitlements: entitlements.service,
      secret: "bootstrap-gate-secret-at-least-32-characters",
      baseURL: "http://localhost:3000",
      policy,
    });
    const cookie = await signIn(
      auth,
      policy.bootstrap!.ownerEmail,
      policy.bootstrap!.ownerPassword!,
    );
    const state = await auth.browserAccount!(
      new Request("http://localhost:3000/api/auth/paseo/state", { headers: { cookie } }),
    );
    assert.equal(
      z.object({ status: z.string() }).parse(await state.json()).status,
      "passwordChangeRequired",
    );
    const organization = await auth.handle(
      new Request("http://localhost:3000/api/auth/paseo/create-organization", {
        method: "POST",
        headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ name: "Blocked" }),
      }),
    );
    assert.deepEqual(await organization.json(), { error: "password_change_required" });
    assert.equal(organization.status, 403);

    await auth.changePassword!(
      { currentPassword: policy.bootstrap!.ownerPassword!, newPassword: "new-owner-password" },
      new Headers({ cookie, origin: "http://localhost:3000" }),
    );
    const signedIn = await signIn(auth, policy.bootstrap!.ownerEmail, "new-owner-password");
    const active = await auth.browserAccount!(
      new Request("http://localhost:3000/api/auth/paseo/state", { headers: { cookie: signedIn } }),
    );
    assert.equal(
      z.object({ status: z.string() }).parse(await active.json()).status,
      "appSetupRequired",
    );
    await auth.completeAppOnboarding!(
      new Request("http://localhost:3000/api/auth/paseo/complete-app-setup", {
        method: "POST",
        headers: { cookie: signedIn, origin: "http://localhost:3000" },
      }),
    );
    const completed = await auth.browserAccount!(
      new Request("http://localhost:3000/api/auth/paseo/state", {
        headers: { cookie: signedIn },
      }),
    );
    assert.equal(z.object({ status: z.string() }).parse(await completed.json()).status, "active");
    await auth.close();
    await entitlements.close();
    await database.close();
  }, 120_000);
});

function bootstrapFromEnvironment(
  bundle: DatabaseRuntimeBundle,
  configured: InstanceAuthPolicy,
): Promise<void> {
  return new InstanceSetup({
    database: bundle.runtime,
    policy: configured,
    provisioningEntitlements: () => Promise.resolve(UNLIMITED_PROVISIONING),
  }).initializeFromPolicy();
}

async function signIn(auth: AuthServer, email: string, password: string): Promise<string> {
  const response = await auth.handle(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  assert.equal(response.status, 200);
  const cookie = response.headers
    .get("set-cookie")
    ?.match(/^(?:[^;]+);/u)?.[0]
    ?.slice(0, -1);
  if (cookie === undefined) throw new Error("sign-in did not issue a session cookie");
  return cookie;
}

async function migratedPool(url: string): Promise<DatabaseRuntimeBundle> {
  const database = await createDatabase(url);
  await database.close();
  return postgresDatabaseRuntime(url);
}

async function isolatedDatabaseUrl(baseUrl: string, name: string): Promise<string> {
  const base = new URL(baseUrl);
  base.pathname = "/postgres";
  const admin = await createPostgresQueryRuntime(base.toString());

  const databaseName = `${name}_${Date.now()}`;
  await admin.query(`create database "${databaseName}"`);
  await admin.close();
  base.pathname = `/${databaseName}`;
  return base.toString();
}

async function queryBootstrapState(url: string) {
  const client = await createPostgresQueryRuntime(url);

  const result = await client.query<{
    organization_count: number;
    owner_count: number;
    account_count: number;
    project_count: number;
    source_count: number;
    must_change_password: boolean;
    completion_organization_id: string | null;
    organization_id: string | null;
    bootstrap_rows: number;
  }>(`
    select
      (select count(*)::integer from organization) as organization_count,
      (select count(*)::integer from member where role = 'owner') as owner_count,
      (select count(*)::integer from account) as account_count,
      (select count(*)::integer from projects) as project_count,
      (select count(*)::integer from project_configuration_sources) as source_count,
      (select must_change_password from "user" where email = 'owner@example.test') as must_change_password,
      (select organization_id from instance_bootstrap where id = 'default') as completion_organization_id,
      (select id from organization limit 1) as organization_id,
      (select count(*)::integer from instance_bootstrap) as bootstrap_rows
  `);
  await client.close();
  const row = result.rows[0]!;
  return {
    organizationCount: row.organization_count,
    ownerCount: row.owner_count,
    accountCount: row.account_count,
    projectCount: row.project_count,
    sourceCount: row.source_count,
    mustChangePassword: row.must_change_password,
    completionOrganizationId: row.completion_organization_id,
    organizationId: row.organization_id,
    bootstrapRows: row.bootstrap_rows,
  };
}
