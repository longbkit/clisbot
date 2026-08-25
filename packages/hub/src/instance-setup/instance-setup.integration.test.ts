import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { postgresDatabaseRuntime, type DatabaseRuntime } from "../db/runtime/index.js";
import type { Locks } from "../db/runtime/locks/index.js";
import { createDatabase, createPostgresPool } from "../db/test-utils/runtime.js";
import type { InstanceAuthPolicy } from "../auth/instance-policy.js";
import { UNLIMITED_PROVISIONING } from "../organizations/provisioning.js";
import { InstanceSetup, type InitialOperator } from "./index.js";

const policy: InstanceAuthPolicy = {
  registrationMode: "invite_only",
  organizationCreation: "disabled",
  bootstrap: undefined,
};

const operator: InitialOperator = {
  email: "First.Operator@Example.test",
  password: "first-operator-password",
};

describe("interactive instance setup", () => {
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
  }, 120_000);

  afterAll(async () => {
    await postgres.stop();
  }, 120_000);

  it("claims a pristine instance for exactly one operator", async () => {
    const instance = await pristineInstance(postgres, "claim_pristine");
    const setup = instanceSetup(instance);
    assert.equal(await setup.status(), "available");

    assert.deepEqual(await setup.claim(operator), { status: "claimed" });

    const claimed = await durableState(instance.runtime);
    assert.deepEqual(claimed, {
      users: 1,
      operators: 1,
      credentialAccounts: 1,
      organizations: 1,
      members: 1,
      owners: 1,
      projects: 1,
      configurationSources: 1,
      entitlements: 1,
      entitlementChanges: 1,
      bootstrapRows: 1,
      completedSetups: 1,
      operatorEmail: "first.operator@example.test",
      operatorName: "first.operator",
      mustChangePassword: false,
      organizationName: "Paseo Hub",
      completionMatchesOwner: true,
    });
    assert.equal(await setup.status(), "claimed");

    // A second visitor arriving at a stale welcome screen is refused and writes nothing.
    assert.deepEqual(await setup.claim({ ...operator, email: "second@example.test" }), {
      status: "unavailable",
    });
    assert.deepEqual(await durableState(instance.runtime), claimed);
    await instance.close();
  }, 120_000);

  it("owns deterministic interactive names instead of trusting extra client fields", async () => {
    const instance = await pristineInstance(postgres, "claim_owned_names");
    const untrustedInput = {
      email: "  Mo@Example.com  ",
      password: operator.password,
      name: "Spoofed operator",
      organizationName: "Spoofed organization",
    } as InitialOperator & { name: string; organizationName: string };

    assert.deepEqual(await instanceSetup(instance).claim(untrustedInput), { status: "claimed" });
    const state = await durableState(instance.runtime);
    assert.equal(state.operatorEmail, "mo@example.com");
    assert.equal(state.operatorName, "mo");
    assert.equal(state.organizationName, "Paseo Hub");
    await instance.close();
  }, 120_000);

  it("gives concurrent claims exactly one winner and no partial state", async () => {
    const instance = await pristineInstance(postgres, "claim_race");
    const second = await connectTo(instance.url);

    const outcomes = await Promise.all([
      instanceSetup(instance).claim(operator),
      instanceSetup(second).claim({
        ...operator,
        email: "racing@example.test",
      }),
    ]);

    assert.equal(outcomes.filter(({ status }) => status === "claimed").length, 1);
    assert.equal(outcomes.filter(({ status }) => status === "unavailable").length, 1);
    const state = await durableState(instance.runtime);
    assert.deepEqual(
      {
        users: state.users,
        operators: state.operators,
        credentialAccounts: state.credentialAccounts,
        organizations: state.organizations,
        members: state.members,
        owners: state.owners,
        projects: state.projects,
        configurationSources: state.configurationSources,
        entitlements: state.entitlements,
        bootstrapRows: state.bootstrapRows,
        completedSetups: state.completedSetups,
        completionMatchesOwner: state.completionMatchesOwner,
      },
      {
        users: 1,
        operators: 1,
        credentialAccounts: 1,
        organizations: 1,
        members: 1,
        owners: 1,
        projects: 1,
        configurationSources: 1,
        entitlements: 1,
        bootstrapRows: 1,
        completedSetups: 1,
        completionMatchesOwner: true,
      },
    );
    await second.close();
    await instance.close();
  }, 120_000);

  /**
   * The race the table lock exists for: an account insert that has not committed yet. The claim
   * must not be able to read "no accounts" in that window, so it waits for the writer and then
   * refuses. Without the lock it would read a stale empty database and claim the instance.
   */
  it("cannot decide eligibility while an account insert is in flight", async () => {
    const instance = await pristineInstance(postgres, "claim_signup_race");
    const writer = await connectTo(instance.url);
    let inserted = () => {};
    const inFlight = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    const signup = writer.runtime.transaction(async (client) => {
      await client.query(
        `insert into "user" (id, name, email, email_verified)
         values ('signup', 'Signup', 'signup@example.test', true)`,
      );
      inserted();
      await released;
    });
    await inFlight;

    const claim = instanceSetup(instance).claim(operator);
    assert.equal(await Promise.race([claim, settledLater()]), "pending");

    release();
    await signup;
    assert.deepEqual(await claim, { status: "unavailable" });
    const state = await durableState(instance.runtime);
    assert.equal(state.users, 1);
    assert.equal(state.operators, 0);
    assert.equal(state.bootstrapRows, 0);
    await writer.close();
    await instance.close();
  }, 120_000);

  it("stays closed, and changes nothing, for an instance that already has accounts", async () => {
    const instance = await pristineInstance(postgres, "claim_existing_user");
    await instance.runtime.query(
      `insert into "user" (id, name, email, email_verified)
       values ('existing', 'Existing', 'existing@example.test', true)`,
    );

    await expectRefusedWithoutChange(instance);
    await instance.close();
  }, 120_000);

  it("stays closed, and changes nothing, for an instance that already has tenant data", async () => {
    const instance = await pristineInstance(postgres, "claim_existing_organization");
    await instance.runtime.query(
      `insert into organization (id, name, slug) values ('existing', 'Existing', 'existing')`,
    );

    await expectRefusedWithoutChange(instance);
    await instance.close();
  }, 120_000);

  it("stays closed, and changes nothing, for a half-written setup record", async () => {
    const instance = await pristineInstance(postgres, "claim_partial_state");
    await instance.runtime.query(
      `insert into "user" (id, name, email, email_verified)
       values ('half', 'Half written', 'half@example.test', true)`,
    );
    // Ownership recorded without completion: a repair attempt, or hand-edited state. Setup must
    // refuse it rather than treat the missing completion as an unclaimed instance.
    await instance.runtime.query(
      `insert into instance_bootstrap (id, owner_user_id) values ('default', 'half')`,
    );

    await expectRefusedWithoutChange(instance);
    await instance.close();
  }, 120_000);

  it("is closed by environment bootstrap", async () => {
    const instance = await pristineInstance(postgres, "claim_after_bootstrap");
    const bootstrapped = new InstanceSetup({
      database: instance.runtime,
      policy: {
        ...policy,
        bootstrap: {
          organizationName: "Configured Organization",
          ownerEmail: "configured@example.test",
          ownerPassword: "configured-owner-password",
        },
      },
      provisioningEntitlements: () => Promise.resolve(UNLIMITED_PROVISIONING),
    });
    await bootstrapped.initializeFromPolicy();

    assert.equal(await bootstrapped.status(), "claimed");
    await expectRefusedWithoutChange(instance);

    const state = await durableState(instance.runtime);
    assert.equal(state.operatorEmail, "configured@example.test");
    // The environment path keeps issuing a temporary password; only the interactive one is final.
    assert.equal(state.mustChangePassword, true);
    await instance.close();
  }, 120_000);
});

/** Refusal is not just a returned status: the database must be byte-for-byte where it started. */
async function expectRefusedWithoutChange(instance: PristineInstance): Promise<void> {
  const setup = instanceSetup(instance);
  const before = await durableState(instance.runtime);
  assert.notEqual(await setup.status(), "available");

  assert.deepEqual(await setup.claim(operator), { status: "unavailable" });

  assert.deepEqual(await durableState(instance.runtime), before);
}

/** Resolves after the claim has had time to run, if nothing were blocking it. */
async function settledLater(): Promise<"pending"> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return "pending";
}

interface PristineInstance {
  runtime: DatabaseRuntime;
  locks: Locks;
  url: string;
  close(): Promise<void>;
}

function instanceSetup(instance: PristineInstance): InstanceSetup {
  return new InstanceSetup({
    database: instance.runtime,
    policy,
    provisioningEntitlements: () => Promise.resolve(UNLIMITED_PROVISIONING),
  });
}

/** A migrated database with no accounts, organizations, or setup record. */
async function pristineInstance(
  postgres: StartedPostgreSqlContainer,
  name: string,
): Promise<PristineInstance> {
  const base = new URL(postgres.getConnectionUri());
  base.pathname = "/postgres";
  const admin = await createPostgresPool(base.toString());
  const databaseName = `${name}_${Date.now()}`;
  await admin.query(`create database "${databaseName}"`);
  await admin.close();
  base.pathname = `/${databaseName}`;
  const url = base.toString();
  const migrated = await createDatabase(url);
  await migrated.close();
  return connectTo(url);
}

async function connectTo(url: string): Promise<PristineInstance> {
  const bundle = await postgresDatabaseRuntime(url);
  return {
    runtime: bundle.runtime,
    locks: bundle.locks,
    url,
    close: () => bundle.runtime.close(),
  };
}

async function durableState(pool: DatabaseRuntime) {
  const result = await pool.query<{
    users: number;
    operators: number;
    credential_accounts: number;
    organizations: number;
    members: number;
    owners: number;
    projects: number;
    configuration_sources: number;
    entitlements: number;
    entitlement_changes: number;
    bootstrap_rows: number;
    completed_setups: number;
    operator_email: string | null;
    operator_name: string | null;
    must_change_password: boolean | null;
    organization_name: string | null;
    completion_matches_owner: boolean;
  }>(`
    select
      (select count(*)::integer from "user") as users,
      (select count(*)::integer from "user" where is_instance_operator) as operators,
      (select count(*)::integer from account where provider_id = 'credential') as credential_accounts,
      (select count(*)::integer from organization) as organizations,
      (select count(*)::integer from member) as members,
      (select count(*)::integer from member where role = 'owner') as owners,
      (select count(*)::integer from projects where slug = 'default') as projects,
      (select count(*)::integer from project_configuration_sources where kind = 'manual') as configuration_sources,
      (select count(*)::integer from organization_entitlements) as entitlements,
      (select count(*)::integer from entitlement_changes) as entitlement_changes,
      (select count(*)::integer from instance_bootstrap) as bootstrap_rows,
      (select count(*)::integer from instance_bootstrap where completed_at is not null) as completed_setups,
      (select email from "user" where is_instance_operator limit 1) as operator_email,
      (select name from "user" where is_instance_operator limit 1) as operator_name,
      (select must_change_password from "user" where is_instance_operator limit 1) as must_change_password,
      (select name from organization limit 1) as organization_name,
      exists (
        select 1 from instance_bootstrap
        join member on member.user_id = instance_bootstrap.owner_user_id
          and member.organization_id = instance_bootstrap.organization_id
        join "user" on "user".id = instance_bootstrap.owner_user_id
        where instance_bootstrap.id = 'default'
          and instance_bootstrap.completed_at is not null
          and member.role = 'owner'
          and "user".is_instance_operator
      ) as completion_matches_owner
  `);
  const row = result.rows[0]!;
  return {
    users: row.users,
    operators: row.operators,
    credentialAccounts: row.credential_accounts,
    organizations: row.organizations,
    members: row.members,
    owners: row.owners,
    projects: row.projects,
    configurationSources: row.configuration_sources,
    entitlements: row.entitlements,
    entitlementChanges: row.entitlement_changes,
    bootstrapRows: row.bootstrap_rows,
    completedSetups: row.completed_setups,
    operatorEmail: row.operator_email,
    operatorName: row.operator_name,
    mustChangePassword: row.must_change_password,
    organizationName: row.organization_name,
    completionMatchesOwner: row.completion_matches_owner,
  };
}
