import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresQueryRuntime } from "./db/test-utils/runtime.js";
import { HubHarness } from "./daemons/test-utils/hub-harness.js";
import { createDatabase, testDatabaseLocks, testDatabaseRuntime } from "./db/test-utils/runtime.js";
import { createAuthServer } from "./auth/server.js";
import { composeEntitlements, type ComposedEntitlements } from "./auth/entitlements.js";
import { startProductionRuntime, stopProductionRuntime } from "./index.js";

describe("production Hub runtime", () => {
  let hub: HubHarness;

  beforeEach(async () => {
    hub = await HubHarness.start();
  }, 120_000);

  afterEach(async () => {
    await hub.stop();
  }, 120_000);

  it("starts the manual source that serves production manual runs", async () => {
    await hub.connectDaemon();
    await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });

    const run = await hub.runManual({ service: "bootstrap" });

    assert.equal(run.status, 200);
    const execution = await hub.waitForPendingExecution();
    await hub.waitForRecoveredExecution(execution.id);
    assert.equal(hub.createdAgentLaunch().prompt, "Deploy the requested service");
  });
});

describe("production Hub cold start", () => {
  let postgres: StartedPostgreSqlContainer;
  let previousEnvironment: Map<string, string | undefined>;
  let root: string;
  const originalDirectory = process.cwd();

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
  }, 120_000);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-production-postgres-"));
    process.chdir(root);
    previousEnvironment = new Map(
      [
        "DATABASE_URL",
        "PASEO_HUB_AUTH_SECRET",
        "PASEO_HUB_APP_URL",
        "PASEO_REGISTRATION_MODE",
        "PASEO_ORGANIZATION_CREATION",
        "PASEO_BOOTSTRAP_ORGANIZATION",
        "PASEO_BOOTSTRAP_OWNER_EMAIL",
        "PASEO_BOOTSTRAP_OWNER_PASSWORD",
      ].map((name) => [name, process.env[name]]),
    );
  });

  afterEach(async () => {
    await stopProductionRuntime();
    for (const [name, value] of previousEnvironment) restoreEnvironment(name, value);
    process.chdir(originalDirectory);
    await rm(root, { recursive: true, force: true });
  });

  afterAll(async () => {
    await postgres.stop();
  }, 120_000);

  it("does not bootstrap an owner without explicit bootstrap settings", async () => {
    const databaseUrl = postgres.getConnectionUri();
    const database = await createDatabase(databaseUrl);
    await database.close();

    const client = await createPostgresQueryRuntime(databaseUrl);

    await client.query(
      `insert into organization (id, name, slug) values ('existing-org', 'Existing', 'existing')`,
    );
    await client.close();

    process.env["DATABASE_URL"] = databaseUrl;
    delete process.env["PASEO_HUB_AUTH_SECRET"];
    delete process.env["PASEO_HUB_APP_URL"];
    process.env["PASEO_REGISTRATION_MODE"] = "disabled";
    delete process.env["PASEO_BOOTSTRAP_ORGANIZATION"];
    delete process.env["PASEO_BOOTSTRAP_OWNER_EMAIL"];
    delete process.env["PASEO_BOOTSTRAP_OWNER_PASSWORD"];

    const runtime = await startProductionRuntime();
    const verification = await createPostgresQueryRuntime(databaseUrl);

    const result = await verification.query<{
      bootstraps: number;
      runtimeConfigurations: number;
      authSecret: string;
    }>(`select
          (select count(*)::integer from instance_bootstrap) as "bootstraps",
          (select count(*)::integer from runtime_configuration) as "runtimeConfigurations",
          (select auth_secret from runtime_configuration) as "authSecret"`);
    await verification.close();
    assert.equal(result.rows[0]?.bootstraps, 0);
    assert.equal(result.rows[0]?.runtimeConfigurations, 1);
    assert.match(result.rows[0]?.authSecret ?? "", /^[a-f0-9]{64}$/u);
    assert.notEqual(
      (await runtime.auth(new Request("http://localhost:3000/api/auth/get-session"))).status,
      503,
    );
  }, 120_000);

  it("treats a blank app URL override as absent during zero-environment startup", async () => {
    const databaseUrl = await isolatedDatabaseUrl(
      postgres.getConnectionUri(),
      "production_blank_app_url",
    );
    process.env["DATABASE_URL"] = databaseUrl;
    process.env["PASEO_HUB_AUTH_SECRET"] = "production-blank-url-secret-at-least-32-characters";
    process.env["PASEO_HUB_APP_URL"] = "";
    process.env["PASEO_REGISTRATION_MODE"] = "disabled";
    process.env["PASEO_ORGANIZATION_CREATION"] = "disabled";
    delete process.env["PASEO_BOOTSTRAP_ORGANIZATION"];
    delete process.env["PASEO_BOOTSTRAP_OWNER_EMAIL"];
    delete process.env["PASEO_BOOTSTRAP_OWNER_PASSWORD"];

    const runtime = await startProductionRuntime();

    assert.ok(runtime);
  }, 120_000);

  it("runs configured bootstrap before exposing the production runtime", async () => {
    const databaseUrl = await isolatedDatabaseUrl(
      postgres.getConnectionUri(),
      "production_bootstrap",
    );
    const previous = new Map(
      [
        "DATABASE_URL",
        "PASEO_HUB_AUTH_SECRET",
        "PASEO_HUB_APP_URL",
        "PASEO_REGISTRATION_MODE",
        "PASEO_ORGANIZATION_CREATION",
        "PASEO_BOOTSTRAP_ORGANIZATION",
        "PASEO_BOOTSTRAP_OWNER_EMAIL",
        "PASEO_BOOTSTRAP_OWNER_PASSWORD",
      ].map((name) => [name, process.env[name]]),
    );
    process.env["DATABASE_URL"] = databaseUrl;
    process.env["PASEO_HUB_AUTH_SECRET"] = "production-bootstrap-secret-at-least-32-characters";
    process.env["PASEO_HUB_APP_URL"] = "http://localhost:3000";
    process.env["PASEO_REGISTRATION_MODE"] = "invite_only";
    process.env["PASEO_ORGANIZATION_CREATION"] = "disabled";
    process.env["PASEO_BOOTSTRAP_ORGANIZATION"] = "Production Customer";
    process.env["PASEO_BOOTSTRAP_OWNER_EMAIL"] = "production-owner@example.test";
    process.env["PASEO_BOOTSTRAP_OWNER_PASSWORD"] = "production-temporary-password";
    try {
      const runtime = await startProductionRuntime();
      assert.ok(runtime);
      const client = await createPostgresQueryRuntime(databaseUrl);

      const result = await client.query<{
        organizations: number;
        owners: number;
        bootstrap: number;
      }>(`
        select
          (select count(*)::integer from organization) as organizations,
          (select count(*)::integer from member where role = 'owner') as owners,
          (select count(*)::integer from instance_bootstrap where completed_at is not null) as bootstrap
      `);
      await client.close();
      assert.deepEqual(result.rows[0], { organizations: 1, owners: 1, bootstrap: 1 });
    } finally {
      for (const [name, value] of previous) restoreEnvironment(name, value);
    }
  }, 120_000);

  it("keeps the production public-operation authenticator attached to UI-created API keys", async () => {
    const databaseUrl = await isolatedDatabaseUrl(
      postgres.getConnectionUri(),
      "production_public_api_auth",
    );
    const previous = new Map(
      [
        "DATABASE_URL",
        "PASEO_HUB_AUTH_SECRET",
        "PASEO_HUB_APP_URL",
        "PASEO_REGISTRATION_MODE",
        "PASEO_ORGANIZATION_CREATION",
        "PASEO_BOOTSTRAP_ORGANIZATION",
        "PASEO_BOOTSTRAP_OWNER_EMAIL",
        "PASEO_BOOTSTRAP_OWNER_PASSWORD",
      ].map((name) => [name, process.env[name]]),
    );
    const secret = "production-public-api-secret-at-least-32-characters";
    process.env["DATABASE_URL"] = databaseUrl;
    process.env["PASEO_HUB_AUTH_SECRET"] = secret;
    process.env["PASEO_HUB_APP_URL"] = "http://localhost:3000";
    process.env["PASEO_REGISTRATION_MODE"] = "invite_only";
    process.env["PASEO_ORGANIZATION_CREATION"] = "disabled";
    process.env["PASEO_BOOTSTRAP_ORGANIZATION"] = "API Customer";
    process.env["PASEO_BOOTSTRAP_OWNER_EMAIL"] = "api-owner@example.test";
    process.env["PASEO_BOOTSTRAP_OWNER_PASSWORD"] = "production-temporary-password";
    let keyAuthority: ReturnType<typeof createAuthServer> | undefined;
    let keyAuthorityDatabase: Awaited<ReturnType<typeof createDatabase>> | undefined;
    let keyAuthorityEntitlements: ComposedEntitlements | undefined;
    try {
      const runtime = await startProductionRuntime();
      const client = await createPostgresQueryRuntime(databaseUrl);

      const owner = await client.query<{ organization_id: string; user_id: string }>(
        `select organization_id, user_id from member where role = 'owner'`,
      );
      await client.close();
      const identity = owner.rows[0];
      assert.ok(identity);
      keyAuthorityDatabase = await createDatabase(databaseUrl);
      keyAuthorityEntitlements = composeEntitlements(
        keyAuthorityDatabase,
        testDatabaseRuntime(keyAuthorityDatabase),
      );
      keyAuthority = createAuthServer({
        database: testDatabaseRuntime(keyAuthorityDatabase),
        locks: testDatabaseLocks(keyAuthorityDatabase),
        entitlements: keyAuthorityEntitlements.service,
        secret,
        baseURL: "http://localhost:3000",
        policy: {
          registrationMode: "invite_only",
          organizationCreation: "disabled",
          bootstrap: undefined,
        },
      });
      const key = await keyAuthority.apiKeys!.create(
        identity.organization_id,
        identity.user_id,
        "production contract test",
        ["configuration:install"],
      );

      const response = await runtime.publicApi.handleOperation(
        "installConfiguration",
        new Request("http://localhost:3000/api/v1/configurations/install", {
          method: "POST",
          headers: {
            authorization: `Bearer ${key.secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            projectSlug: "not-present",
            files: [{ path: ".paseo/hub.yml", content: "environments: {}\nagents: {}" }],
          }),
        }),
      );

      assert.equal(response.status, 404);
    } finally {
      await keyAuthority?.close();
      await keyAuthorityEntitlements?.close();
      await keyAuthorityDatabase?.close();
      await stopProductionRuntime();
      for (const [name, value] of previous) restoreEnvironment(name, value);
    }
  }, 120_000);
});

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

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
