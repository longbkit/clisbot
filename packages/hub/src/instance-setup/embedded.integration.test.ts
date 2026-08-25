import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import { embeddedDatabaseRuntime, type DatabaseRuntime } from "../db/runtime/index.js";
import type { InstanceAuthPolicy } from "../auth/instance-policy.js";
import { UNLIMITED_PROVISIONING } from "../organizations/provisioning.js";
import { InstanceSetup, type InitialOperator } from "./index.js";
import { InstanceAppOnboarding } from "./app-onboarding.js";

const policy: InstanceAuthPolicy = {
  registrationMode: "invite_only",
  organizationCreation: "disabled",
  bootstrap: undefined,
};

const operator: InitialOperator = {
  email: "embedded.operator@example.test",
  password: "embedded-operator-password",
};

/** Everything one claim must have provisioned, and nothing a second claim may add. */
const ONE_CLAIMED_INSTANCE = {
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
  operatorName: "embedded.operator",
  organizationName: "Paseo Hub",
  mustChangePassword: false,
  completionMatchesOwner: true,
};

describe("interactive instance setup on embedded storage", () => {
  let root: string;
  let database: DatabaseRuntime;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-instance-setup-embedded-"));
    const bundle = await embeddedDatabaseRuntime(join(root, "database"));
    database = bundle.runtime;
    await database.migrate();
  }, 120_000);

  afterEach(async () => {
    await database.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  it("claims a pristine embedded instance once", async () => {
    const setup = instanceSetup(database);
    assert.equal(await setup.status(), "available");

    assert.deepEqual(await setup.claim(operator), { status: "claimed" });

    assert.equal(await setup.status(), "claimed");
    assert.deepEqual(await durableState(database), ONE_CLAIMED_INSTANCE);
  }, 120_000);

  it("gives concurrent embedded claims exactly one winner", async () => {
    const setup = instanceSetup(database);

    const outcomes = await Promise.all([
      setup.claim(operator),
      setup.claim({ ...operator, email: "racing@example.test" }),
    ]);

    assert.equal(outcomes.filter(({ status }) => status === "claimed").length, 1);
    assert.equal(outcomes.filter(({ status }) => status === "unavailable").length, 1);
    assert.deepEqual(await durableState(database), {
      ...ONE_CLAIMED_INSTANCE,
      operatorName: outcomes[0]?.status === "claimed" ? "embedded.operator" : "racing",
    });
  }, 120_000);

  it("keeps app onboarding incomplete until the operator finishes or skips it", async () => {
    await instanceSetup(database).claim(operator);
    const onboarding = new InstanceAppOnboarding(database);
    assert.equal(await onboarding.isComplete(), false);

    await onboarding.complete();
    await onboarding.complete();
    assert.equal(await onboarding.isComplete(), true);
  });

  it("stays closed, and changes nothing, on an embedded instance with accounts", async () => {
    await database.query(
      `insert into "user" (id, name, email, email_verified)
       values ('existing', 'Existing', 'existing@example.test', true)`,
    );
    const before = await durableState(database);

    assert.equal(await instanceSetup(database).status(), "blocked");
    assert.deepEqual(await instanceSetup(database).claim(operator), {
      status: "unavailable",
    });

    assert.deepEqual(await durableState(database), before);
    assert.equal(before.bootstrapRows, 0);
  }, 120_000);
});

function instanceSetup(database: DatabaseRuntime): InstanceSetup {
  return new InstanceSetup({
    database,
    policy,
    provisioningEntitlements: () => Promise.resolve(UNLIMITED_PROVISIONING),
  });
}

async function durableState(runtime: DatabaseRuntime) {
  const result = await runtime.query<{
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
    operator_name: string | null;
    organization_name: string | null;
    must_change_password: boolean | null;
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
      (select name from "user" where is_instance_operator limit 1) as operator_name,
      (select name from organization limit 1) as organization_name,
      (select bool_or(must_change_password) from "user") as must_change_password,
      exists (
        select 1 from instance_bootstrap
        join member on member.user_id = instance_bootstrap.owner_user_id
          and member.organization_id = instance_bootstrap.organization_id
        join "user" on "user".id = instance_bootstrap.owner_user_id
        join account on account.user_id = "user".id and account.provider_id = 'credential'
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
    operatorName: row.operator_name,
    organizationName: row.organization_name,
    mustChangePassword: row.must_change_password,
    completionMatchesOwner: row.completion_matches_owner,
  };
}
