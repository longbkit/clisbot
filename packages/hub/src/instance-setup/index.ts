import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import {
  normalizeEmail,
  type BootstrapSettings,
  type InstanceAuthPolicy,
} from "../auth/instance-policy.js";
import type {
  DatabaseRuntime,
  QueryHandle,
  QueryRow,
  TransactionHandle,
} from "../db/runtime/index.js";
import {
  provisionOrganization,
  type ProvisioningEntitlement,
  type ProvisioningEntitlementResolver,
} from "../organizations/provisioning.js";

const BOOTSTRAP_ROW_ID = "default";
const INTERACTIVE_ORGANIZATION_NAME = "Paseo Hub";

/**
 * What makes "this database has no accounts" hold until the claim commits. `share row exclusive`
 * conflicts with the `row exclusive` mode every INSERT takes, so a registration that would
 * invalidate the check waits on its own connection, inside the transaction it was already going
 * to open — no lock is held on its behalf, and nothing else in the codebase has to know.
 *
 * Reads are unaffected: the mode does not conflict with `access share` or `row share`.
 *
 * Ordering matters. This is taken *after* the setup row lock so that a claim and a startup
 * bootstrap — which locks the setup row and then inserts a user — acquire in the same order.
 */
const PRISTINE_TABLES_LOCK = `lock table "user", organization in share row exclusive mode`;

/**
 * Whether this instance still has a first operator to create.
 *
 * - `available` — the database is provably pristine and nobody owns the instance yet.
 * - `claimed` — a completed claim is on record, by environment bootstrap or interactively.
 * - `blocked` — everything else: ordinary accounts already exist, an organization was
 *   preserved from a previous installation, or a bootstrap row is half-written. Most blocked
 *   instances are perfectly healthy; the name means setup is closed, not that data is damaged.
 */
export type InstanceSetupStatus = "available" | "claimed" | "blocked";

/** What the first operator supplies interactively. Validated at the request boundary. */
export interface InitialOperator {
  email: string;
  password: string;
}

/**
 * `unavailable` is the safe answer for every caller that lost the race or reached a
 * non-pristine instance — it never says which, because the form is public.
 */
export type InstanceClaim = { status: "claimed" } | { status: "unavailable" };

export class InstanceBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstanceBootstrapError";
  }
}

interface BootstrapRow extends QueryRow {
  organization_id: string | null;
  owner_user_id: string | null;
  completed_at: Date | null;
}

/** No row at all: nothing has been recorded about this instance's ownership. */
const NO_SETUP_RECORD: BootstrapRow = {
  organization_id: null,
  owner_user_id: null,
  completed_at: null,
};

interface TenantCountRow extends QueryRow {
  users: number;
  organizations: number;
}

interface ExistingOrganization extends QueryRow {
  id: string;
  name: string;
  slug: string;
  member_count: number;
  project_count: number;
}

interface OperatorAccount {
  name: string;
  email: string;
  /** Hashed before the transaction opens: hashing is slow and this runs under a table lock. */
  passwordHash: string;
  /** Environment bootstrap issues a temporary password; an interactively chosen one is final. */
  mustChangePassword: boolean;
}

export interface InstanceSetupOptions {
  database: DatabaseRuntime;
  policy: InstanceAuthPolicy;
  /** What a provisioned organization is stamped with — resolved before the transaction opens. */
  provisioningEntitlements: ProvisioningEntitlementResolver;
}

/**
 * The one owner of first-run instance ownership. Environment bootstrap and the interactive
 * claim are two entry points into the same singleton row lock, provisioning, and durable
 * completion, so a claim can never race a startup bootstrap into two first operators.
 *
 * All durable writes of either path happen in one transaction, so a crash cannot leave an
 * organization, account, or membership that a later start might mistake for a completed setup.
 */
export class InstanceSetup {
  constructor(private readonly options: InstanceSetupOptions) {}

  /** Creates the environment-configured owner. No-op when bootstrap is not configured. */
  async initializeFromPolicy(): Promise<void> {
    const settings = this.options.policy.bootstrap;
    if (settings === undefined) return;

    // Resolve outside the transaction — the same value the create-organization path uses, so the
    // bootstrap owner's organization is stamped by the instance's provisioning policy too.
    const entitlement = await this.options.provisioningEntitlements();
    try {
      await this.options.database.transaction(async (client) => {
        // Admission differs from the interactive claim on purpose: an operator who configures
        // bootstrap is asserting ownership, so this path may adopt an organization preserved
        // from a previous installation. It refuses the ambiguous cases below instead.
        const row = await lockBootstrapRow(client);
        if (row.completed_at !== null) return;
        if (row.owner_user_id !== null) {
          throw new InstanceBootstrapError(
            "bootstrap state has an owner without completion; repair the instance_bootstrap row before restarting",
          );
        }
        const created = await createBootstrapData(
          client,
          settings,
          row.organization_id,
          entitlement,
        );
        await completeBootstrap(client, created.organizationId, created.ownerUserId);
      });
    } catch (error) {
      if (error instanceof InstanceBootstrapError) throw error;
      throw new InstanceBootstrapError(
        `bootstrap failed: ${error instanceof Error ? error.message : "unknown database error"}`,
      );
    }
  }

  /**
   * Whether interactive setup is open. Advisory only: it renders the welcome journey, and `claim`
   * re-decides while holding the locks below, so a stale `available` cannot hand out ownership.
   */
  async status(): Promise<InstanceSetupStatus> {
    const database = this.options.database;
    const existing = await database.query<BootstrapRow>(
      `select organization_id, owner_user_id, completed_at
       from instance_bootstrap
       where id = $1`,
      [BOOTSTRAP_ROW_ID],
    );
    return setupStatus(existing.rows[0] ?? NO_SETUP_RECORD, await tenantCounts(database));
  }

  /**
   * Creates the first operator, their organization, and the completion record in one
   * transaction. Losing callers get `unavailable` and leave the database exactly as they found
   * it: eligibility is decided after the setup row and the account tables are locked, so no
   * registration can land between the check and the commit, the loser of a concurrent claim
   * reads the winner's account rather than a stale snapshot, and a refused claim rolls back
   * rather than leaving a setup record behind.
   *
   * Everything slow happens before the transaction opens, so the tables are held for a handful
   * of inserts and nothing else.
   */
  async claim(operator: InitialOperator): Promise<InstanceClaim> {
    const email = normalizeEmail(operator.email);
    const accountName = interactiveAccountName(email);
    const organizationName = INTERACTIVE_ORGANIZATION_NAME;
    const entitlement = await this.options.provisioningEntitlements();
    const passwordHash = await hashPassword(operator.password);
    return this.options.database.transaction(async (client) => {
      const row = await lockBootstrapRow(client);
      await client.query(PRISTINE_TABLES_LOCK);
      const counts = await tenantCounts(client);
      if (setupStatus(row, counts) !== "available") return refuse(client);
      const ownerUserId = await createOperatorAccount(client, {
        name: accountName,
        email,
        passwordHash,
        mustChangePassword: false,
      });
      const organization = await provisionOrganization(
        client,
        { organizationId: randomUUID(), name: organizationName, ownerUserId },
        entitlement,
      );
      await completeBootstrap(client, organization.id, ownerUserId);
      return { status: "claimed" };
    });
  }
}

/** Interactive identity is derived once from the normalized address, never from public input. */
function interactiveAccountName(normalizedEmail: string): string {
  const separator = normalizedEmail.indexOf("@");
  const localPart = separator > 0 ? normalizedEmail.slice(0, separator) : "";
  return localPart || normalizedEmail;
}

/**
 * Refuses the claim by rolling back. Taking the singleton row lock has to insert the row when it
 * is missing, so a refused claim must undo that write — a public request that changes nothing
 * must leave nothing behind, including an empty setup record.
 */
function refuse(client: TransactionHandle): never {
  return client.rollback({ status: "unavailable" });
}

function setupStatus(row: BootstrapRow, counts: TenantCountRow): InstanceSetupStatus {
  if (row.completed_at !== null) return "claimed";
  // A row carrying identity without completion, or any pre-existing tenant data, means this
  // instance already belongs to someone. Absence of a completed row is never enough on its own.
  if (row.owner_user_id !== null || row.organization_id !== null) return "blocked";
  if (counts.users !== 0 || counts.organizations !== 0) return "blocked";
  return "available";
}

/**
 * Takes the instance's singleton ownership lock. Every writer of first-operator state passes
 * through here, so concurrent starts and concurrent claims serialize against one another.
 */
async function lockBootstrapRow(client: QueryHandle): Promise<BootstrapRow> {
  await client.query(
    `insert into instance_bootstrap (id) values ($1)
     on conflict (id) do nothing`,
    [BOOTSTRAP_ROW_ID],
  );
  const existing = await client.query<BootstrapRow>(
    `select organization_id, owner_user_id, completed_at
     from instance_bootstrap
     where id = $1
     for update`,
    [BOOTSTRAP_ROW_ID],
  );
  const row = existing.rows[0];
  if (row === undefined) throw new InstanceBootstrapError("bootstrap state disappeared");
  return row;
}

async function tenantCounts(client: QueryHandle): Promise<TenantCountRow> {
  const result = await client.query<TenantCountRow>(
    `select
       (select count(*)::integer from "user") as users,
       (select count(*)::integer from organization) as organizations`,
  );
  const counts = result.rows[0];
  if (counts === undefined) throw new InstanceBootstrapError("instance setup state is unreadable");
  return counts;
}

async function completeBootstrap(
  client: QueryHandle,
  organizationId: string,
  ownerUserId: string,
): Promise<void> {
  await client.query(
    `update instance_bootstrap
     set organization_id = $2, owner_user_id = $3, completed_at = now()
     where id = $1`,
    [BOOTSTRAP_ROW_ID, organizationId, ownerUserId],
  );
}

/**
 * The instance's first operator — the only limits surface on a self-hosted instance and the back
 * office on a hosted one. Every later operator is granted by SQL (docs/entitlements.md), never by
 * a signed-in user's request.
 */
async function createOperatorAccount(
  client: QueryHandle,
  operator: OperatorAccount,
): Promise<string> {
  const ownerUserId = randomUUID();
  await client.query(
    `insert into "user"
       (id, name, email, email_verified, must_change_password, is_instance_operator)
     values ($1, $2, $3, true, $4, true)`,
    [ownerUserId, operator.name, operator.email, operator.mustChangePassword],
  );
  await client.query(
    `insert into account
       (id, account_id, provider_id, user_id, password)
     values ($1, $2, 'credential', $2, $3)`,
    [randomUUID(), ownerUserId, operator.passwordHash],
  );
  return ownerUserId;
}

async function createBootstrapData(
  client: QueryHandle,
  settings: BootstrapSettings,
  existingOrganizationId: string | null,
  entitlement: ProvisioningEntitlement,
): Promise<{ organizationId: string; ownerUserId: string }> {
  const existingOwner = await client.query<{ id: string }>(
    `select id from "user" where lower(email) = $1 limit 1`,
    [settings.ownerEmail],
  );
  if (existingOwner.rowCount !== 0) {
    throw new InstanceBootstrapError(
      "bootstrap owner email already belongs to an existing account; resolve the conflict before restarting",
    );
  }

  const existingOrganization = await resolveBootstrapOrganization(
    client,
    settings,
    existingOrganizationId,
  );
  if (settings.ownerPassword === undefined) {
    throw new InstanceBootstrapError(
      "PASEO_BOOTSTRAP_OWNER_PASSWORD is required until instance bootstrap completes",
    );
  }

  const ownerUserId = await createOperatorAccount(client, {
    name: settings.ownerEmail.split("@")[0] ?? settings.ownerEmail,
    email: settings.ownerEmail,
    passwordHash: await hashPassword(settings.ownerPassword),
    mustChangePassword: true,
  });

  if (existingOrganization === undefined) {
    await provisionOrganization(
      client,
      {
        organizationId: randomUUID(),
        name: settings.organizationName,
        ownerUserId,
      },
      entitlement,
    );
  } else {
    await adoptExistingOrganization(client, existingOrganization, ownerUserId);
  }
  return {
    organizationId: existingOrganization?.id ?? (await latestOrganizationId(client, ownerUserId)),
    ownerUserId,
  };
}

/**
 * The organization an environment bootstrap must take over, if any: the one recorded on a
 * previous attempt, or the single organization preserved from a previous installation that the
 * configured name identifies. Anything ambiguous refuses rather than guessing an owner.
 */
async function resolveBootstrapOrganization(
  client: QueryHandle,
  settings: BootstrapSettings,
  existingOrganizationId: string | null,
): Promise<ExistingOrganization | undefined> {
  let resolvedOrganizationId = existingOrganizationId;
  if (resolvedOrganizationId === null) {
    const matchingOrganizations = await client.query<{ id: string }>(
      `select id from organization where lower(trim(name)) = lower(trim($1)) order by id for update`,
      [settings.organizationName],
    );
    if (matchingOrganizations.rows.length > 1) {
      throw new InstanceBootstrapError(
        "bootstrap organization name matches more than one existing organization; resolve the ambiguity before restarting",
      );
    }
    if (matchingOrganizations.rows.length === 1) {
      resolvedOrganizationId = matchingOrganizations.rows[0]!.id;
    } else {
      const existingOrganizations = await client.query<{ count: number }>(
        `select count(*)::integer as count from organization`,
      );
      if (existingOrganizations.rows[0]?.count !== 0) {
        throw new InstanceBootstrapError(
          "bootstrap cannot identify the existing organization from the configured name; resolve ownership before restarting",
        );
      }
    }
  }
  if (resolvedOrganizationId === null) return undefined;

  const result = await client.query<ExistingOrganization>(
    `select organization.id, organization.name, organization.slug,
            (select count(*)::integer from member where member.organization_id = organization.id) as member_count,
            (select count(*)::integer from projects where projects.organization_id = organization.id) as project_count
     from organization
     where organization.id = $1
     for update`,
    [resolvedOrganizationId],
  );
  const existingOrganization = result.rows[0];
  if (existingOrganization === undefined) {
    throw new InstanceBootstrapError(
      "bootstrap points to an organization that no longer exists; restore the organization before restarting",
    );
  }
  if (normalizeName(existingOrganization.name) !== normalizeName(settings.organizationName)) {
    throw new InstanceBootstrapError(
      "bootstrap organization name conflicts with the organization preserved from the previous installation",
    );
  }
  if (existingOrganization.member_count !== 0) {
    throw new InstanceBootstrapError(
      "bootstrap organization already has members; resolve the ownership conflict before restarting",
    );
  }
  return existingOrganization;
}

async function adoptExistingOrganization(
  client: QueryHandle,
  organization: ExistingOrganization,
  ownerUserId: string,
): Promise<void> {
  await client.query(
    `insert into member (id, organization_id, user_id, role)
     values ($1, $2, $3, 'owner')`,
    [randomUUID(), organization.id, ownerUserId],
  );
  if (organization.project_count !== 0) return;
  const projectId = randomUUID();
  await client.query(
    `insert into projects (id, organization_id, name, slug, created_by_user_id)
     values ($1, $2, 'Default', 'default', $3)`,
    [projectId, organization.id, ownerUserId],
  );
  await client.query(
    `insert into project_configuration_sources
       (project_id, organization_id, kind, automatic_deployment_enabled, selected_by_user_id)
     values ($1, $2, 'manual', false, $3)`,
    [projectId, organization.id, ownerUserId],
  );
}

async function latestOrganizationId(client: QueryHandle, ownerUserId: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `select organization_id as id from member where user_id = $1 and role = 'owner'`,
    [ownerUserId],
  );
  const organizationId = result.rows[0]?.id;
  if (organizationId === undefined)
    throw new InstanceBootstrapError("bootstrap owner membership missing");
  return organizationId;
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}
