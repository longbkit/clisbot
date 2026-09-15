import type {
  DatabaseRuntime,
  QueryHandle,
  QueryRow,
  TransactionHandle,
} from "../db/runtime/index.js";
import type { Locks } from "../db/runtime/locks/index.js";
import { reportFailure } from "../failures/index.js";
import { provisionDomainMembership } from "../organizations/domain-provisioning.js";
import type {
  ProvisioningEntitlement,
  ProvisioningEntitlementResolver,
} from "../organizations/provisioning.js";
import { normalizeEmail } from "./instance-policy.js";
import { acceptInvitationForAccount, ProductRequestError } from "./organization-access.js";
import {
  RegistrationAdmissionError,
  type AdmissionDecision,
  type RegistrationAdmission,
} from "./registration-admission.js";

export interface RegistrationCompletionOptions {
  pool: DatabaseRuntime;
  locks: Locks;
  admission: RegistrationAdmission;
  provisioningEntitlements: ProvisioningEntitlementResolver;
  onMembershipChanged?: (organizationId: string) => Promise<void>;
  onOrganizationAccessChanged?: (organizationId: string) => Promise<void>;
}

export interface CompletedAdmission {
  /** The organization the account joined, or null when admission granted no membership (open
   * registration, or an account whose admission had already completed). */
  organizationId: string | null;
}

interface AccountRow extends QueryRow {
  id: string;
  email: string;
  email_verified: boolean;
}

/**
 * Finishes registration for a pending account: Google sign-in, email verification, and any later
 * sign-in of a verified pending account all come through here. The whole step is one transaction
 * that rechecks the current policy, so a retry after a crash resumes without duplicating
 * organizations or memberships, and the pending marker disappears only together with the grant.
 */
export class RegistrationCompletion {
  constructor(private readonly options: RegistrationCompletionOptions) {}

  async markPending(email: string): Promise<void> {
    await this.options.pool.query(
      `insert into pending_registrations (email) values ($1) on conflict (email) do nothing`,
      [normalizeEmail(email)],
    );
  }

  async clearPending(email: string): Promise<void> {
    await this.options.pool.query(`delete from pending_registrations where email = $1`, [
      normalizeEmail(email),
    ]);
  }

  async isPending(email: string, client: QueryHandle = this.options.pool): Promise<boolean> {
    const result = await client.query(`select 1 from pending_registrations where email = $1`, [
      normalizeEmail(email),
    ]);
    return result.rowCount === 1;
  }

  async complete(userId: string, invitationId?: string): Promise<CompletedAdmission> {
    // Resolved before the transaction: a hosted instance reads its Free plan from the catalog.
    const entitlement = await this.options.provisioningEntitlements();
    const organizationId = await this.options.pool.transaction(async (client) => {
      const account = await lockedAccount(client, userId);
      const email = normalizeEmail(account.email);
      await this.options.locks.withTxLock(client, `paseo:registration-completion:${email}`);
      if (!(await this.isPending(email, client))) return null;
      if (await hasMembership(client, account.id)) {
        // Only completion grants a pending account its first membership, and it deletes the
        // marker in the same transaction; a member with a marker was admitted already and the
        // marker is left over from a failed duplicate signup attempt.
        await client.query(`delete from pending_registrations where email = $1`, [email]);
        return null;
      }
      // Every pending account is created with a proven address; this is an invariant, not a path.
      if (!account.email_verified) throw new RegistrationAdmissionError();
      const decision = await this.options.admission.decide(client, {
        email,
        emailVerified: true,
        invitationId,
      });
      if (decision === undefined) throw new RegistrationAdmissionError();
      const joined = await this.grant(client, decision, account, entitlement);
      await client.query(`delete from pending_registrations where email = $1`, [email]);
      return joined;
    });
    if (organizationId !== null) await this.notify(organizationId);
    return { organizationId };
  }

  private async grant(
    client: TransactionHandle,
    decision: AdmissionDecision,
    account: AccountRow,
    entitlement: ProvisioningEntitlement,
  ): Promise<string | null> {
    if (decision.kind === "open") return null;
    if (decision.kind === "domain") {
      const membership = await provisionDomainMembership(
        client,
        this.options.locks,
        { domain: decision.domain, userId: account.id },
        entitlement,
      );
      return membership.organizationId;
    }
    try {
      return await acceptInvitationForAccount(client, this.options.locks, {
        invitationId: decision.invitationId,
        userId: account.id,
        email: account.email,
      });
    } catch (error) {
      if (error instanceof ProductRequestError) throw new RegistrationAdmissionError();
      throw error;
    }
  }

  private async notify(organizationId: string): Promise<void> {
    for (const [operation, hook] of [
      ["auth.registration.access-change.notify", this.options.onOrganizationAccessChanged],
      ["auth.registration.membership-change.notify", this.options.onMembershipChanged],
    ] as const) {
      try {
        await hook?.(organizationId);
      } catch (error) {
        reportFailure(error, { operation, component: "auth", organizationId });
      }
    }
  }
}

async function hasMembership(client: QueryHandle, userId: string): Promise<boolean> {
  const result = await client.query(`select 1 from member where user_id = $1 limit 1`, [userId]);
  return result.rowCount === 1;
}

async function lockedAccount(client: QueryHandle, userId: string): Promise<AccountRow> {
  const result = await client.query<AccountRow>(
    `select id, email, email_verified from "user" where id = $1 for update`,
    [userId],
  );
  const account = result.rows[0];
  if (account === undefined) throw new RegistrationAdmissionError();
  return account;
}
