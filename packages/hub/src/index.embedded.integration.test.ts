import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "vitest";
import { embeddedDatabaseRuntime } from "./db/runtime/index.js";
import { startProductionRuntime, stopProductionRuntime } from "./index.js";
import { runWithFailureTracking } from "./failures/index.js";
import { createLogger } from "./logger.js";
import { assertOneFailure, FailureLogStream } from "./test-utils/failure-logs.js";
import { createCredentialCipher } from "./credentials/credential-cipher.js";

const ENVIRONMENT_NAMES = [
  "DATABASE_URL",
  "CLISBOT_HUB_DATA_DIR",
  "XDG_DATA_HOME",
  "CLISBOT_HUB_AUTH_SECRET",
  "CLISBOT_HUB_APP_URL",
  "CLISBOT_REGISTRATION_MODE",
  "CLISBOT_ORGANIZATION_CREATION",
  "CLISBOT_BOOTSTRAP_ORGANIZATION",
  "CLISBOT_BOOTSTRAP_OWNER_EMAIL",
  "CLISBOT_BOOTSTRAP_OWNER_PASSWORD",
  "CLISBOT_HUB_CREDENTIAL_MASTER_KEY",
] as const;

const APP_URL = "http://localhost:3000";
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

let root: string;
let previousEnvironment: Map<string, string | undefined>;
const originalDirectory = process.cwd();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hub-production-embedded-"));
  process.chdir(root);
  previousEnvironment = new Map(ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]));
  delete process.env["DATABASE_URL"];
  process.env["CLISBOT_HUB_DATA_DIR"] = join(root, "database");
  delete process.env["CLISBOT_HUB_AUTH_SECRET"];
  delete process.env["CLISBOT_HUB_APP_URL"];
  process.env["CLISBOT_REGISTRATION_MODE"] = "invite_only";
  process.env["CLISBOT_ORGANIZATION_CREATION"] = "disabled";
  process.env["CLISBOT_BOOTSTRAP_ORGANIZATION"] = "Embedded owner";
  process.env["CLISBOT_BOOTSTRAP_OWNER_EMAIL"] = "owner@embedded.test";
  process.env["CLISBOT_BOOTSTRAP_OWNER_PASSWORD"] = "embedded-owner-password";
  process.env["CLISBOT_HUB_CREDENTIAL_MASTER_KEY"] = MASTER_KEY;
});

afterEach(async () => {
  await stopProductionRuntime().catch(() => undefined);
  for (const [name, value] of previousEnvironment) restoreEnvironment(name, value);
  process.chdir(originalDirectory);
  await rm(root, { recursive: true, force: true });
});

it("opens first-run setup when nothing is configured and no data exists", async () => {
  delete process.env["CLISBOT_BOOTSTRAP_ORGANIZATION"];
  delete process.env["CLISBOT_BOOTSTRAP_OWNER_EMAIL"];
  delete process.env["CLISBOT_BOOTSTRAP_OWNER_PASSWORD"];

  const runtime = await startProductionRuntime();
  const state = await runtime.browserAccount!(new Request(`${APP_URL}/api/auth/clisbot/state`));

  assert.equal(state.status, 200);
  assert.deepEqual(await state.json(), { status: "instanceSetupRequired" });
});

it("ignores dotenv files during production startup", async () => {
  delete process.env["CLISBOT_BOOTSTRAP_ORGANIZATION"];
  delete process.env["CLISBOT_BOOTSTRAP_OWNER_EMAIL"];
  delete process.env["CLISBOT_BOOTSTRAP_OWNER_PASSWORD"];
  await writeFile(
    join(root, ".env"),
    "DATABASE_URL=postgres://dotenv-must-not-load.invalid/clisbot_hub\n",
  );

  const runtime = await startProductionRuntime();
  const state = await runtime.browserAccount!(new Request(`${APP_URL}/api/auth/clisbot/state`));

  assert.equal(state.status, 200);
  assert.deepEqual(await state.json(), { status: "instanceSetupRequired" });
});

it("logs an embedded database startup failure exactly once", async () => {
  const canary = "database-startup-secret-1d42";
  const stream = new FailureLogStream();
  const blockedPath = join(root, canary);
  await writeFile(blockedPath, "not a directory");
  process.env["CLISBOT_HUB_DATA_DIR"] = blockedPath;

  await assert.rejects(() =>
    runWithFailureTracking(() => startProductionRuntime(), createLogger(stream)),
  );

  assertOneFailure(stream, {
    operation: "database.startup",
    component: "database",
    canary,
  });
});

it("keeps an interactive claim across a restart and then shows ordinary sign-in", async () => {
  delete process.env["CLISBOT_BOOTSTRAP_ORGANIZATION"];
  delete process.env["CLISBOT_BOOTSTRAP_OWNER_EMAIL"];
  delete process.env["CLISBOT_BOOTSTRAP_OWNER_PASSWORD"];
  process.env["CLISBOT_HUB_APP_URL"] = APP_URL;
  const operator = {
    email: "restart-operator@example.test",
    password: "restart-operator-password",
  };

  const first = await startProductionRuntime();
  assert.deepEqual(await first.claimInstance!(operator, new Headers({ origin: APP_URL })), {
    status: "claimed",
  });
  await stopProductionRuntime();

  // A new process against the same embedded storage: setup is over, and the chosen password
  // still signs the operator in without a temporary-password gate.
  const restarted = await startProductionRuntime();
  const state = await restarted.browserAccount!(new Request(`${APP_URL}/api/auth/clisbot/state`));
  assert.deepEqual(await state.json(), { status: "signedOut", registration: "invite_only" });
  await restarted.signInEmail!(
    { email: operator.email, password: operator.password },
    new Headers({ origin: APP_URL }),
  );
});

it("releases embedded storage when runtime configuration is invalid", async () => {
  process.env["CLISBOT_HUB_APP_URL"] = "not a URL";

  await assert.rejects(() => startProductionRuntime(), TypeError);

  await reopenEmbeddedStorage();
});

it("releases embedded storage when auth initialization fails", async () => {
  const bundle = await embeddedDatabaseRuntime(process.env["CLISBOT_HUB_DATA_DIR"]!);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into "user" (id, name, email, email_verified)
     values ('existing-user', 'Existing user', $1, true)`,
    [process.env["CLISBOT_BOOTSTRAP_OWNER_EMAIL"]!],
  );
  await bundle.runtime.close();

  await assert.rejects(() => startProductionRuntime(), /already belongs/u);

  await reopenEmbeddedStorage();
});

it("selects embedded storage without DATABASE_URL and preserves it across restarts", async () => {
  const firstRuntime = await startProductionRuntime();
  const authResponse = await firstRuntime.auth(
    new Request("http://localhost:3000/api/auth/get-session"),
  );
  assert.notEqual(authResponse.status, 503);
  const authBody = await authResponse.text();
  await stopProductionRuntime();

  const firstSecret = await storedAuthSecret();
  assert.doesNotMatch(authBody, new RegExp(firstSecret, "u"));
  await startProductionRuntime();
  await stopProductionRuntime();

  const bundle = await embeddedDatabaseRuntime(process.env["CLISBOT_HUB_DATA_DIR"]!);
  const result = await bundle.runtime.query<{
    organizations: number;
    bootstraps: number;
    runtime_configurations: number;
    auth_secret_envelope: unknown;
  }>(`
    select
      (select count(*)::integer from organization) as organizations,
      (select count(*)::integer from instance_bootstrap) as bootstraps,
      (select count(*)::integer from runtime_configuration) as runtime_configurations,
      (select auth_secret_envelope from runtime_configuration) as auth_secret_envelope
  `);
  await bundle.runtime.close();

  assert.equal(result.rows[0]?.organizations, 1);
  assert.equal(result.rows[0]?.bootstraps, 1);
  assert.equal(result.rows[0]?.runtime_configurations, 1);
  assert.ok(result.rows[0]?.auth_secret_envelope !== undefined);
  assert.equal(JSON.stringify(result.rows[0]?.auth_secret_envelope).includes(firstSecret), false);
});

it("selects the XDG data directory when no explicit data directory is configured", async () => {
  const dataHome = join(root, "xdg-data");
  delete process.env["CLISBOT_HUB_DATA_DIR"];
  process.env["XDG_DATA_HOME"] = dataHome;

  await startProductionRuntime();
  await stopProductionRuntime();

  const bundle = await embeddedDatabaseRuntime(join(dataHome, "clisbot-hub"));
  const result = await bundle.runtime.query<{ runtime_configurations: number }>(
    `select count(*)::integer as runtime_configurations from runtime_configuration`,
  );
  await bundle.runtime.close();

  assert.deepEqual(result.rows, [{ runtime_configurations: 1 }]);
});

async function storedAuthSecret(): Promise<string> {
  const bundle = await embeddedDatabaseRuntime(process.env["CLISBOT_HUB_DATA_DIR"]!);
  const result = await bundle.runtime.query<{ auth_secret_envelope: unknown }>(
    `select auth_secret_envelope from runtime_configuration`,
  );
  await bundle.runtime.close();
  const envelope = result.rows[0]?.auth_secret_envelope;
  const secret = createCredentialCipher({
    keyId: "primary",
    masterKey: Buffer.from(MASTER_KEY, "base64"),
  }).decrypt("runtime-configuration:auth-secret", envelope);
  assert.ok(typeof secret === "string");
  return secret;
}

async function reopenEmbeddedStorage(): Promise<void> {
  const bundle = await embeddedDatabaseRuntime(process.env["CLISBOT_HUB_DATA_DIR"]!);
  await bundle.runtime.migrate();
  await bundle.runtime.close();
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
