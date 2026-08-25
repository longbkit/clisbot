import { randomUUID } from "node:crypto";
import type {
  DatabaseRuntime,
  QueryHandle,
  QueryRow,
  TransactionHandle,
} from "../db/runtime/index.js";
import type { Locks } from "../db/runtime/locks/index.js";
import { z } from "zod";
import { reportFailure } from "../failures/index.js";
import { OrganizationApiKeys } from "./api-keys.js";
import { OrganizationCliCredentials } from "./cli-credentials.js";
import { apiKeyScopeSchema } from "./api-key-contract.js";
import type { InstanceAuthPolicy } from "./instance-policy.js";
import type { InstanceSetup } from "../instance-setup/index.js";
import type { InstanceAppOnboarding } from "../instance-setup/app-onboarding.js";
import type {
  OrganizationResourceReader,
  OrganizationResources,
} from "../organizations/resources.js";
import {
  invitationRoleSchema,
  organizationRoleSchema,
  type OrganizationCapabilities,
  type OrganizationRole,
} from "./organization-contract.js";
import {
  canChangeMemberRole,
  canRemoveMember,
  capabilitiesFor,
  parseInvitationRole,
  parseOrganizationRole,
} from "./organization-policy.js";
import { invitationLockName } from "./registration-admission.js";
import {
  provisionOrganization,
  type ProvisioningEntitlementResolver,
} from "../organizations/provisioning.js";
import { EntitlementDenied } from "../entitlements/catalog.js";
import { entitlementDenialResponse } from "../entitlements/denial.js";
import type { EntitlementsService } from "../entitlements/service.js";

const INVITATION_LIFETIME_HOURS = 48;

export interface AccountSession {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  activeOrganizationId: string | null;
  mustChangePassword: boolean;
  isInstanceOperator: boolean;
}

export interface OrganizationAccessValue {
  session: {
    id: string;
  };
  account: {
    id: string;
    name: string;
    email: string;
  };
  organization: {
    id: string;
    name: string;
    slug?: string;
  };
  membership: {
    id: string;
    role: OrganizationRole;
  };
  capabilities: OrganizationCapabilities;
}

export interface AccountAccessValue {
  session: { id: string; activeOrganizationId: string | null };
  account: { id: string; name: string; email: string };
  /** The instance-operator flag, carried from the session. The operator surface authorizes on
   * this alone — it is never a membership read. Presentation gates the operator nav on it too. */
  isInstanceOperator: boolean;
}

export interface AccountSessionReader {
  read(headers: Headers): Promise<AccountSession | undefined>;
}

interface OrganizationAccessOptions {
  pool: DatabaseRuntime;
  locks: Locks;
  sessions: AccountSessionReader;
  baseURL: string;
  policy: InstanceAuthPolicy;
  /** Decides whether a signed-out visitor sees the first-run welcome or ordinary sign-in. */
  instanceSetup: InstanceSetup;
  appOnboarding: InstanceAppOnboarding;
  apiKeys: OrganizationApiKeys;
  cliCredentials: OrganizationCliCredentials;
  entitlements: EntitlementsService;
  /** What a newly created organization is stamped with — unlimited self-hosted, the Free plan
   * on a billing-configured instance. Resolved per creation so a later Free-plan sync is seen. */
  provisioningEntitlements: ProvisioningEntitlementResolver;
  /** Post-commit hook fired when an organization's seat count may have changed (invite, cancel,
   * accept, remove). The composition root wires billing's seat-quantity reporter here; undefined
   * self-hosted. Never blocks or fails the member action. */
  onMembershipChanged?: (organizationId: string) => Promise<void>;
}

interface MembershipRow extends QueryRow {
  member_id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role: string;
}

interface MemberRow extends QueryRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
}

interface InvitationRow extends QueryRow {
  id: string;
  organization_id: string;
  organization_name: string;
  inviter_name: string;
  email: string;
  role: string;
  expires_at: Date;
}

interface TargetMemberRow extends QueryRow {
  id: string;
  user_id: string;
  role: string;
}

const organizationIdBody = z.object({ organizationId: z.string().min(1) }).strict();
const createOrganizationBody = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const createInvitationBody = z
  .object({ email: z.string().trim().email(), role: invitationRoleSchema })
  .strict();
const invitationIdBody = z.object({ invitationId: z.string().min(1) }).strict();
const changeRoleBody = z
  .object({ memberId: z.string().min(1), role: organizationRoleSchema })
  .strict();
const removeMemberBody = z.object({ memberId: z.string().min(1) }).strict();
const createApiKeyBody = z
  .object({ name: z.string().trim().min(1).max(100), scopes: z.array(z.string()).min(1) })
  .strict();
const apiKeyIdBody = z.object({ id: z.string().uuid() }).strict();
export class OrganizationAccess {
  constructor(private readonly options: OrganizationAccessOptions) {}

  async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (request.method === "GET" && path === "/api/auth/paseo/state") {
        return await this.state(request);
      }
      if (request.method === "GET" && path === "/api/auth/paseo/api-keys") {
        return await this.listApiKeys(request);
      }
      if (request.method !== "POST") return notFound();
      if (path === "/api/auth/paseo/create-organization") {
        return await this.createOrganization(request);
      }
      if (path === "/api/auth/paseo/select-organization") {
        return await this.selectOrganization(request);
      }
      if (path === "/api/auth/paseo/create-invitation") {
        return await this.createInvitation(request);
      }
      if (path === "/api/auth/paseo/cancel-invitation") {
        return await this.cancelInvitation(request);
      }
      if (path === "/api/auth/paseo/accept-invitation") {
        return await this.acceptInvitation(request);
      }
      if (path === "/api/auth/paseo/change-member-role") {
        return await this.changeMemberRole(request);
      }
      if (path === "/api/auth/paseo/remove-member") return await this.removeMember(request);
      if (path === "/api/auth/paseo/api-keys") return await this.createApiKey(request);
      if (path === "/api/auth/paseo/revoke-api-key") return await this.revokeApiKey(request);
      if (path === "/api/auth/paseo/revoke-cli-credential") {
        return await this.revokeCliCredential(request);
      }
      return notFound();
    } catch (error) {
      if (error instanceof ProductRequestError) return error.response();
      if (error instanceof EntitlementDenied) return entitlementDenialResponse(error.payload());
      reportFailure(error, {
        operation: "auth.organization.request",
        component: "auth",
        status: 500,
      });
      return Response.json({ error: "request_failed" }, { status: 500 });
    }
  }

  async account(request: Request): Promise<AccountAccessValue> {
    const session = await this.requireSession(request);
    return {
      session: {
        id: session.sessionId,
        activeOrganizationId: session.activeOrganizationId,
      },
      account: { id: session.userId, name: session.name, email: session.email },
      isInstanceOperator: session.isInstanceOperator,
    };
  }

  async resources(
    request: Request,
    organizations: OrganizationResources,
  ): Promise<OrganizationResourceReader> {
    return organizations.forOrganization(await this.resolve(request));
  }

  async resolve(request: Request): Promise<OrganizationAccessValue> {
    const session = await this.requireSession(request);
    const access = await this.activeAccess(this.options.pool, session);
    if (access === undefined) throw new ProductRequestError(403, "organization_required");
    return access;
  }

  private async state(request: Request): Promise<Response> {
    const session = await this.options.sessions.read(request.headers);
    const invitationId = new URL(request.url).searchParams.get("invitation");
    if (session === undefined) {
      // A pristine instance has no accounts to sign in to and no invitations to carry, so the
      // first-run journey replaces the sign-in wall entirely until someone claims it.
      if ((await this.options.instanceSetup.status()) === "available") {
        return Response.json({ status: "instanceSetupRequired" });
      }
      const invitation =
        invitationId === null
          ? undefined
          : await this.signedOutInvitation(this.options.pool, invitationId);
      return Response.json({
        status: "signedOut",
        registration: this.options.policy.registrationMode,
        ...(invitation === undefined ? {} : { invitation: invitationSummary(invitation, true) }),
        ...(invitationId !== null && invitation === undefined
          ? { invitationUnavailable: true }
          : {}),
      });
    }
    const account = { id: session.userId, name: session.name, email: session.email };
    if (session.mustChangePassword) {
      return Response.json({ status: "passwordChangeRequired", account });
    }
    const memberships = await this.memberships(this.options.pool, session.userId);
    const resolvedSession = await this.activateBootstrapOrganization(session, memberships);
    const invitation =
      invitationId === null
        ? undefined
        : await this.availableInvitation(this.options.pool, invitationId, session.email);
    const access = membershipAccess(resolvedSession, memberships);

    if (access === undefined) {
      return Response.json({
        status: "organizationRequired",
        account,
        memberships: membershipSummaries(memberships),
        canCreateOrganization: this.options.policy.organizationCreation === "open",
        ...(invitation === undefined ? {} : { invitation: invitationSummary(invitation) }),
        ...(invitationId !== null && invitation === undefined
          ? { invitationUnavailable: true }
          : {}),
      });
    }

    if (resolvedSession.isInstanceOperator && !(await this.options.appOnboarding.isComplete())) {
      return Response.json({
        status: "appSetupRequired",
        account,
        memberships: membershipSummaries(memberships),
        organization: access.organization,
        capabilities: access.capabilities,
      });
    }

    const team = await this.team(access);
    return Response.json({
      status: "active",
      account,
      memberships: membershipSummaries(memberships),
      organization: access.organization,
      membership: access.membership,
      capabilities: access.capabilities,
      // Presentation only — it decides whether the operator nav renders. Every operator read and
      // write re-checks the flag server-side, so a forged value here buys nothing.
      isInstanceOperator: resolvedSession.isInstanceOperator,
      canCreateOrganization: this.options.policy.organizationCreation === "open",
      team,
      ...(invitation === undefined ? {} : { invitation: invitationSummary(invitation) }),
      ...(invitationId !== null && invitation === undefined ? { invitationUnavailable: true } : {}),
    });
  }

  private async createOrganization(request: Request): Promise<Response> {
    const session = await this.requireSession(request);
    if (this.options.policy.organizationCreation === "disabled") {
      throw new ProductRequestError(403, "organization_creation_disabled");
    }
    const input = await parseBody(request, createOrganizationBody);
    const id = randomUUID();
    // Resolve the provisioning entitlement before opening the transaction — on a hosted instance
    // this reads the Free plan from the catalog mirror, which must not run inside the org insert.
    const entitlement = await this.options.provisioningEntitlements();
    const organization = await this.options.pool.transaction(async (client) => {
      const created = await provisionOrganization(
        client,
        {
          organizationId: id,
          name: input.name,
          ownerUserId: session.userId,
        },
        entitlement,
      );
      await activateSession(client, session, id);
      return created;
    });
    return Response.json(
      { organizationId: organization.id, organizationSlug: organization.slug },
      { status: 201 },
    );
  }

  private async selectOrganization(request: Request): Promise<Response> {
    const session = await this.requireSession(request);
    const input = await parseBody(request, organizationIdBody);
    await this.options.pool.transaction(async (client) => {
      const membership = await client.query(
        `select 1 from member
         where user_id = $1 and organization_id = $2 and role in ('owner', 'admin', 'member')`,
        [session.userId, input.organizationId],
      );
      if (membership.rowCount !== 1) throw new ProductRequestError(404, "organization_unavailable");
      await activateSession(client, session, input.organizationId);
    });
    return Response.json({ organizationId: input.organizationId });
  }

  private async listApiKeys(request: Request): Promise<Response> {
    const access = await this.requireActiveAccess(await this.requireSession(request));
    if (!access.capabilities.manageResources) {
      throw new ProductRequestError(403, "forbidden");
    }
    const keys = await this.options.apiKeys.list(access.organization.id);
    const cliCredentials = await this.options.cliCredentials.list(access.organization.id);
    return Response.json({
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        scopes: key.scopes,
        createdAt: key.createdAt.toISOString(),
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        revokedAt: key.revokedAt?.toISOString() ?? null,
      })),
      cliCredentials: cliCredentials.map((credential) => ({
        id: credential.id,
        prefix: credential.prefix,
        createdAt: credential.createdAt.toISOString(),
        lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
        revokedAt: credential.revokedAt?.toISOString() ?? null,
      })),
    });
  }

  private async createApiKey(request: Request): Promise<Response> {
    const session = await this.requireSession(request);
    const input = await parseBody(request, createApiKeyBody);
    const access = await this.requireActiveAccess(session);
    const scopes = input.scopes.flatMap((scope) => {
      const parsed = apiKeyScopeSchema.safeParse(scope);
      return parsed.success ? [parsed.data] : [];
    });
    if (scopes.length !== new Set(input.scopes).size) {
      throw new ProductRequestError(400, "invalid_api_key_scopes");
    }
    if (scopes.length !== input.scopes.length) {
      throw new ProductRequestError(400, "invalid_api_key_scopes");
    }
    const created = await this.options.pool.transaction(async (client) => {
      await lockOrganizationMembershipTransitions(
        this.options.locks,
        client,
        access.organization.id,
      );
      const actorRole = await currentActorRole(client, access);
      if (!capabilitiesFor(actorRole).manageResources) {
        throw new ProductRequestError(403, "forbidden");
      }
      return this.options.apiKeys.create(
        access.organization.id,
        session.userId,
        input.name,
        scopes,
        client,
      );
    });
    return Response.json(
      {
        key: {
          id: created.summary.id,
          name: created.summary.name,
          prefix: created.summary.prefix,
          scopes: created.summary.scopes,
          createdAt: created.summary.createdAt.toISOString(),
          lastUsedAt: null,
          revokedAt: null,
        },
        secret: created.secret,
      },
      { status: 201 },
    );
  }

  private async revokeApiKey(request: Request): Promise<Response> {
    const session = await this.requireSession(request);
    const input = await parseBody(request, apiKeyIdBody);
    const access = await this.requireActiveAccess(session);
    await this.options.pool.transaction(async (client) => {
      await lockOrganizationMembershipTransitions(
        this.options.locks,
        client,
        access.organization.id,
      );
      const actorRole = await currentActorRole(client, access);
      if (!capabilitiesFor(actorRole).manageResources) {
        throw new ProductRequestError(403, "forbidden");
      }
      if (!(await this.options.apiKeys.revoke(access.organization.id, input.id, client))) {
        throw new ProductRequestError(404, "api_key_unavailable");
      }
    });
    return Response.json({ revoked: true });
  }

  private async revokeCliCredential(request: Request): Promise<Response> {
    const session = await this.requireSession(request);
    const input = await parseBody(request, apiKeyIdBody);
    const access = await this.requireActiveAccess(session);
    await this.options.pool.transaction(async (client) => {
      await lockOrganizationMembershipTransitions(
        this.options.locks,
        client,
        access.organization.id,
      );
      const role = await currentActorRole(client, access);
      if (!capabilitiesFor(role).manageResources) {
        throw new ProductRequestError(403, "forbidden");
      }
      if (!(await this.options.cliCredentials.revoke(access.organization.id, input.id, client))) {
        throw new ProductRequestError(404, "cli_credential_unavailable");
      }
    });
    return Response.json({ revoked: true });
  }

  private async createInvitation(request: Request): Promise<Response> {
    const session = await this.requireSession(request);
    const input = await parseBody(request, createInvitationBody);
    const access = await this.requireActiveAccess(session);
    const email = normalizeEmail(input.email);
    const invitation = await this.options.pool.transaction(async (client) => {
      await lockOrganizationMembershipTransitions(
        this.options.locks,
        client,
        access.organization.id,
      );
      await lockOrganizationMembers(client, access.organization.id);
      const actorRole = await currentActorRole(client, access);
      if (!capabilitiesFor(actorRole).manageMembers) {
        throw new ProductRequestError(403, "forbidden");
      }
      const existingMember = await client.query(
        `select 1 from member
         join "user" on "user".id = member.user_id
         where member.organization_id = $1 and lower("user".email) = $2
         limit 1`,
        [access.organization.id, email],
      );
      if (existingMember.rowCount !== 0) {
        throw new ProductRequestError(409, "already_member");
      }
      await client.query(
        `update invitation set status = 'canceled'
         where organization_id = $1 and status = 'pending' and expires_at <= now()`,
        [access.organization.id],
      );
      const alreadyPending = await client.query<InvitationRow>(
        `select id, organization_id, '' as organization_name, '' as inviter_name,
                email, role, expires_at
         from invitation
         where organization_id = $1 and lower(email) = $2 and status = 'pending'
           and expires_at > now()`,
        [access.organization.id, email],
      );
      const pendingReinvite = alreadyPending.rows[0];
      if (pendingReinvite !== undefined) return pendingReinvite;
      // A genuinely new invitee reserves a seat, so the organization must both be allowed to
      // invite at all and have a free seat. Both checks run under the membership advisory lock
      // held by this transaction, so a burst of concurrent invites is serialized against one
      // another. Re-inviting an existing member or pending invitee (handled above) is exempt.
      await this.options.entitlements.requireFlag(access.organization.id, "canInviteMembers");
      await this.options.entitlements.requireHeadroom(access.organization.id, "seats");
      const inserted = await client.query<InvitationRow>(
        `insert into invitation
          (id, organization_id, email, role, status, expires_at, inviter_id, created_at)
         values ($1, $2, $3, $4, 'pending', now() + ($6 * interval '1 hour'), $5, now())
         on conflict (organization_id, lower(email)) where status = 'pending' do nothing
         returning id, organization_id, '' as organization_name, '' as inviter_name,
                   email, role, expires_at`,
        [
          randomUUID(),
          access.organization.id,
          email,
          input.role,
          session.userId,
          INVITATION_LIFETIME_HOURS,
        ],
      );
      const created = inserted.rows[0];
      if (created !== undefined) return created;
      const existing = await client.query<InvitationRow>(
        `select id, organization_id, '' as organization_name, '' as inviter_name,
                email, role, expires_at
         from invitation
         where organization_id = $1 and lower(email) = $2 and status = 'pending'
           and expires_at > now()`,
        [access.organization.id, email],
      );
      const pending = existing.rows[0];
      if (pending === undefined) throw new Error("pending invitation conflict returned no row");
      return pending;
    });
    await this.notifyMembershipChanged(access.organization.id);
    return Response.json(managerInvitationSummary(invitation, this.options.baseURL), {
      status: 201,
    });
  }

  private async cancelInvitation(request: Request): Promise<Response> {
    const session = await this.requireSession(request);
    const input = await parseBody(request, invitationIdBody);
    const access = await this.requireActiveAccess(session);
    await this.options.pool.transaction(async (client) => {
      await this.options.locks.withTxLock(client, invitationLockName(input.invitationId));
      await lockOrganizationMembershipTransitions(
        this.options.locks,
        client,
        access.organization.id,
      );
      await lockOrganizationMembers(client, access.organization.id);
      const actorRole = await currentActorRole(client, access);
      if (!capabilitiesFor(actorRole).manageMembers) {
        throw new ProductRequestError(403, "forbidden");
      }
      const result = await client.query(
        `update invitation set status = 'canceled'
         where id = $1 and organization_id = $2 and status = 'pending'
         returning id`,
        [input.invitationId, access.organization.id],
      );
      if (result.rowCount !== 1) throw new ProductRequestError(404, "invitation_unavailable");
    });
    await this.notifyMembershipChanged(access.organization.id);
    return Response.json({ canceled: true });
  }

  private async acceptInvitation(request: Request): Promise<Response> {
    const session = await this.requireSession(request);
    const input = await parseBody(request, invitationIdBody);
    const organizationId = await this.options.pool.transaction(async (client) => {
      const target = await client.query<{ organization_id: string }>(
        `select organization_id from invitation where id = $1`,
        [input.invitationId],
      );
      const targetOrganizationId = target.rows[0]?.organization_id;
      if (targetOrganizationId === undefined) {
        throw new ProductRequestError(404, "invitation_unavailable");
      }
      await this.options.locks.withTxLock(client, invitationLockName(input.invitationId));
      await lockOrganizationMembershipTransitions(this.options.locks, client, targetOrganizationId);
      const invitationResult = await client.query<InvitationRow>(
        `select invitation.id, invitation.organization_id, organization.name as organization_name,
                "user".name as inviter_name, invitation.email, invitation.role,
                invitation.expires_at
         from invitation
         join organization on organization.id = invitation.organization_id
         join "user" on "user".id = invitation.inviter_id
         where invitation.id = $1 and invitation.status = 'pending'
           and invitation.expires_at > now()
         for update of invitation`,
        [input.invitationId],
      );
      const invitation = invitationResult.rows[0];
      if (
        invitation === undefined ||
        normalizeEmail(invitation.email) !== normalizeEmail(session.email)
      ) {
        throw new ProductRequestError(404, "invitation_unavailable");
      }
      const role = parseInvitationRole(invitation.role);
      if (role === undefined) throw new ProductRequestError(404, "invitation_unavailable");
      await client.query(
        `insert into member (id, organization_id, user_id, role)
         values ($1, $2, $3, $4)
         on conflict (organization_id, user_id) do nothing`,
        [randomUUID(), invitation.organization_id, session.userId, role],
      );
      await client.query(`update invitation set status = 'accepted' where id = $1`, [
        input.invitationId,
      ]);
      await activateSession(client, session, invitation.organization_id);
      return invitation.organization_id;
    });
    await this.notifyMembershipChanged(organizationId);
    return Response.json({ organizationId });
  }

  private async changeMemberRole(request: Request): Promise<Response> {
    const session = await this.requireSession(request);
    const input = await parseBody(request, changeRoleBody);
    const access = await this.requireActiveAccess(session);
    await this.options.pool.transaction(async (client) => {
      await lockOrganizationMembershipTransitions(
        this.options.locks,
        client,
        access.organization.id,
      );
      await lockOrganizationMembers(client, access.organization.id);
      const actorRole = await currentActorRole(client, access);
      const target = await targetMember(client, access.organization.id, input.memberId);
      const currentRole = target === undefined ? undefined : parseOrganizationRole(target.role);
      if (target === undefined || currentRole === undefined) {
        throw new ProductRequestError(404, "member_unavailable");
      }
      if (!canChangeMemberRole(actorRole, currentRole, input.role)) {
        throw new ProductRequestError(403, "forbidden");
      }
      await protectLastOwner(client, access.organization.id, currentRole, input.role);
      await client.query(`update member set role = $2 where id = $1`, [target.id, input.role]);
    });
    return Response.json({ memberId: input.memberId, role: input.role });
  }

  private async removeMember(request: Request): Promise<Response> {
    const session = await this.requireSession(request);
    const input = await parseBody(request, removeMemberBody);
    const access = await this.requireActiveAccess(session);
    await this.options.pool.transaction(async (client) => {
      await lockOrganizationMembershipTransitions(
        this.options.locks,
        client,
        access.organization.id,
      );
      await lockOrganizationMembers(client, access.organization.id);
      const actorRole = await currentActorRole(client, access);
      const target = await targetMember(client, access.organization.id, input.memberId);
      const targetRole = target === undefined ? undefined : parseOrganizationRole(target.role);
      if (target === undefined || targetRole === undefined) {
        throw new ProductRequestError(404, "member_unavailable");
      }
      if (!canRemoveMember(actorRole, targetRole)) {
        throw new ProductRequestError(403, "forbidden");
      }
      await protectLastOwner(client, access.organization.id, targetRole, undefined);
      await client.query(`delete from member where id = $1`, [target.id]);
      await client.query(
        `update session set active_organization_id = null
         where user_id = $1 and active_organization_id = $2`,
        [target.user_id, access.organization.id],
      );
    });
    await this.notifyMembershipChanged(access.organization.id);
    return Response.json({ removed: true });
  }

  /**
   * Post-commit: the organization's seat count may have changed, so billing re-reports it to
   * Stripe. Awaited so a test sees the report immediately, but wrapped — a reporting failure must
   * never fail the member action, and the subscription-webhook reconcile re-reports as a backstop.
   */
  private async notifyMembershipChanged(organizationId: string): Promise<void> {
    try {
      await this.options.onMembershipChanged?.(organizationId);
    } catch (error) {
      reportFailure(
        error,
        {
          operation: "billing.seat-usage.notify",
          component: "billing",
          organizationId,
        },
        { kind: "upstreamUnavailable" },
      );
    }
  }

  private async requireSession(request: Request): Promise<AccountSession> {
    const session = await this.options.sessions.read(request.headers);
    if (session === undefined) throw new ProductRequestError(401, "unauthenticated");
    if (session.mustChangePassword) {
      throw new ProductRequestError(403, "password_change_required");
    }
    return session;
  }

  private async requireActiveAccess(session: AccountSession): Promise<OrganizationAccessValue> {
    const access = await this.activeAccess(this.options.pool, session);
    if (access === undefined) throw new ProductRequestError(403, "organization_required");
    return access;
  }

  private async activeAccess(
    client: QueryHandle,
    session: AccountSession,
  ): Promise<OrganizationAccessValue | undefined> {
    if (session.activeOrganizationId === null) return undefined;
    const memberships = await this.memberships(
      client,
      session.userId,
      session.activeOrganizationId,
    );
    return membershipAccess(session, memberships);
  }

  private async memberships(
    client: QueryHandle,
    userId: string,
    organizationId?: string,
  ): Promise<MembershipRow[]> {
    const result = await client.query<MembershipRow>(
      `select member.id as member_id, organization.id as organization_id,
              organization.name as organization_name, organization.slug as organization_slug,
              member.role
       from member
       join organization on organization.id = member.organization_id
       where member.user_id = $1
         and ($2::text is null or organization.id = $2)
       order by lower(organization.name), organization.id`,
      [userId, organizationId ?? null],
    );
    return result.rows;
  }

  private async activateBootstrapOrganization(
    session: AccountSession,
    memberships: readonly MembershipRow[],
  ): Promise<AccountSession> {
    if (session.activeOrganizationId !== null || memberships.length !== 1) return session;
    const organizationId = memberships[0]?.organization_id;
    if (organizationId === undefined) return session;
    const bootstrap = await this.options.pool.query(
      `select 1 from instance_bootstrap
       where id = 'default' and owner_user_id = $1 and organization_id = $2
         and completed_at is not null`,
      [session.userId, organizationId],
    );
    if (bootstrap.rowCount !== 1) return session;
    await this.options.pool.query(
      `update session set active_organization_id = $2, updated_at = now()
       where id = $1 and user_id = $3 and active_organization_id is null`,
      [session.sessionId, organizationId, session.userId],
    );
    return { ...session, activeOrganizationId: organizationId };
  }

  private async team(access: OrganizationAccessValue) {
    const members = await this.options.pool.query<MemberRow>(
      `select member.id, member.user_id, "user".name, "user".email, member.role
       from member
       join "user" on "user".id = member.user_id
       where member.organization_id = $1
       order by lower("user".name), "user".id`,
      [access.organization.id],
    );
    const memberSummaries = members.rows.flatMap((member) => {
      const role = parseOrganizationRole(member.role);
      return role === undefined
        ? []
        : [
            {
              id: member.id,
              userId: member.user_id,
              name: member.name,
              email: member.email,
              role,
            },
          ];
    });
    if (!access.capabilities.manageMembers) return { members: memberSummaries };
    const invitations = await this.options.pool.query<InvitationRow>(
      `select invitation.id, invitation.organization_id,
              organization.name as organization_name, "user".name as inviter_name,
              invitation.email, invitation.role, invitation.expires_at
       from invitation
       join organization on organization.id = invitation.organization_id
       join "user" on "user".id = invitation.inviter_id
       where invitation.organization_id = $1
         and invitation.status = 'pending' and invitation.expires_at > now()
       order by invitation.created_at`,
      [access.organization.id],
    );
    return {
      members: memberSummaries,
      invitations: invitations.rows.map((invitation) =>
        managerInvitationSummary(invitation, this.options.baseURL),
      ),
    };
  }

  private async availableInvitation(
    client: QueryHandle,
    invitationId: string,
    accountEmail: string,
  ): Promise<InvitationRow | undefined> {
    const result = await client.query<InvitationRow>(
      `select invitation.id, invitation.organization_id,
              organization.name as organization_name, "user".name as inviter_name,
              invitation.email, invitation.role, invitation.expires_at
       from invitation
       join organization on organization.id = invitation.organization_id
       join "user" on "user".id = invitation.inviter_id
       where invitation.id = $1 and invitation.status = 'pending'
         and invitation.expires_at > now() and lower(invitation.email) = $2`,
      [invitationId, normalizeEmail(accountEmail)],
    );
    return result.rows[0];
  }

  private async signedOutInvitation(
    client: QueryHandle,
    invitationId: string,
  ): Promise<InvitationRow | undefined> {
    const result = await client.query<InvitationRow>(
      `select invitation.id, invitation.organization_id,
              organization.name as organization_name, "user".name as inviter_name,
              invitation.email, invitation.role, invitation.expires_at
       from invitation
       join organization on organization.id = invitation.organization_id
       join "user" on "user".id = invitation.inviter_id
       where invitation.id = $1 and invitation.status = 'pending'
         and invitation.expires_at > now()`,
      [invitationId],
    );
    return result.rows[0];
  }
}

function membershipAccess(
  session: AccountSession,
  memberships: readonly MembershipRow[],
): OrganizationAccessValue | undefined {
  const membership = memberships.find(
    ({ organization_id }) => organization_id === session.activeOrganizationId,
  );
  if (membership === undefined) return undefined;
  const role = parseOrganizationRole(membership.role);
  if (role === undefined) return undefined;
  return {
    session: { id: session.sessionId },
    account: { id: session.userId, name: session.name, email: session.email },
    organization: {
      id: membership.organization_id,
      name: membership.organization_name,
      slug: membership.organization_slug,
    },
    membership: { id: membership.member_id, role },
    capabilities: capabilitiesFor(role),
  };
}

function membershipSummaries(memberships: readonly MembershipRow[]) {
  return memberships.flatMap((membership) => {
    const role = parseOrganizationRole(membership.role);
    return role === undefined
      ? []
      : [
          {
            id: membership.organization_id,
            name: membership.organization_name,
            slug: membership.organization_slug,
            membershipId: membership.member_id,
            role,
          },
        ];
  });
}

function invitationSummary(invitation: InvitationRow, includeEmail = false) {
  const role = parseInvitationRole(invitation.role);
  if (role === undefined) throw new ProductRequestError(404, "invitation_unavailable");
  return {
    id: invitation.id,
    organization: {
      id: invitation.organization_id,
      name: invitation.organization_name,
    },
    inviterName: invitation.inviter_name,
    role,
    expiresAt: invitation.expires_at.toISOString(),
    ...(includeEmail ? { email: invitation.email } : {}),
  };
}

function managerInvitationSummary(invitation: InvitationRow, baseURL: string) {
  const role = parseInvitationRole(invitation.role);
  if (role === undefined) throw new Error("stored invitation role is invalid");
  return {
    id: invitation.id,
    email: invitation.email,
    role,
    expiresAt: invitation.expires_at.toISOString(),
    link: new URL(`/?invitation=${encodeURIComponent(invitation.id)}`, baseURL).toString(),
  };
}

async function parseBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ProductRequestError(400, "invalid_request");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ProductRequestError(400, "invalid_request");
  return parsed.data;
}

async function activateSession(
  client: QueryHandle,
  session: AccountSession,
  organizationId: string,
): Promise<void> {
  const result = await client.query(
    `update session set active_organization_id = $3, updated_at = now()
     where id = $1 and user_id = $2 and expires_at > now()`,
    [session.sessionId, session.userId, organizationId],
  );
  if (result.rowCount !== 1) throw new ProductRequestError(401, "unauthenticated");
}

async function targetMember(
  client: QueryHandle,
  organizationId: string,
  memberId: string,
): Promise<TargetMemberRow | undefined> {
  const result = await client.query<TargetMemberRow>(
    `select id, user_id, role from member where id = $1 and organization_id = $2`,
    [memberId, organizationId],
  );
  return result.rows[0];
}

async function currentActorRole(
  client: QueryHandle,
  access: OrganizationAccessValue,
): Promise<OrganizationRole> {
  const result = await client.query<{ role: string }>(
    `select role from member
     where id = $1 and user_id = $2 and organization_id = $3`,
    [access.membership.id, access.account.id, access.organization.id],
  );
  const role = parseOrganizationRole(result.rows[0]?.role ?? "");
  if (role === undefined) throw new ProductRequestError(403, "organization_required");
  return role;
}

/**
 * Seats in use = current members plus outstanding pending invitations. A pending invite
 * reserves a seat so a burst of invitations can't overshoot the cap once they're accepted.
 * This is the seats counter wired into `EntitlementsService` at composition.
 */
export async function countOrganizationSeatUsage(
  pool: QueryHandle,
  organizationId: string,
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select
       (select count(*) from member where organization_id = $1)
       + (select count(*) from invitation
          where organization_id = $1 and status = 'pending' and expires_at > now()) as count`,
    [organizationId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function lockOrganizationMembers(client: QueryHandle, organizationId: string): Promise<void> {
  await client.query(`select id from member where organization_id = $1 for update`, [
    organizationId,
  ]);
}

async function lockOrganizationMembershipTransitions(
  locks: Locks,
  client: TransactionHandle,
  organizationId: string,
): Promise<void> {
  await locks.withTxLock(client, `paseo-organization-membership:${organizationId}`);
}

async function protectLastOwner(
  client: QueryHandle,
  organizationId: string,
  current: OrganizationRole,
  next: OrganizationRole | undefined,
): Promise<void> {
  if (current !== "owner" || next === "owner") return;
  const owners = await client.query<{ count: number }>(
    `select count(*)::integer as count from member
     where organization_id = $1 and role = 'owner'`,
    [organizationId],
  );
  if (owners.rows[0]?.count === 1) throw new ProductRequestError(409, "last_owner_required");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

export class ProductRequestError extends Error {
  constructor(
    private readonly status: number,
    private readonly code: string,
  ) {
    super(code);
  }

  response(): Response {
    return Response.json({ error: this.code }, { status: this.status });
  }
}
