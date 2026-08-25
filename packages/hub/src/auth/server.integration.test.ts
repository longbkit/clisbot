import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresQueryRuntime } from "../db/test-utils/runtime.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import { z } from "zod";
import {
  createDatabase,
  testDatabaseLocks,
  testDatabaseRuntime,
} from "../db/test-utils/runtime.js";
import type { Database } from "../db/types.js";
import { OrganizationResources } from "../organizations/resources.js";
import {
  accountStateSchema,
  type AccountState,
  type ActiveAccountState,
} from "./organization-contract.js";
import { createAuthServer, type AuthServer } from "./server.js";
import { composeEntitlements, type ComposedEntitlements } from "./entitlements.js";

type ActiveState = ActiveAccountState;

describe("account and organization boundary", () => {
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
  }, 120_000);

  afterAll(async () => {
    await postgres.stop();
  }, 120_000);

  afterEach(async () => {
    await stopAccounts();
  });

  it("keeps the Phase 0 account, organization, and active-session contract", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    const organizationId = await alice.createOrganization("Acme");

    assert.deepEqual(await alice.session(), {
      email: "alice@example.com",
      activeOrganizationId: organizationId,
    });
    assert.deepEqual((await alice.requireActiveState()).memberships, [
      {
        id: organizationId,
        name: "Acme",
        slug: `acme-${organizationId.slice(0, 8)}`,
        membershipId: (await alice.requireActiveState()).membership.id,
        role: "owner",
      },
    ]);
    assert.deepEqual(await hub.projects(organizationId), [
      { name: "Default", slug: "default", createdByEmail: "alice@example.com" },
    ]);
    assert.equal(await alice.createOrganizationWithMetadata(), 400);
  });

  it("requires an explicit valid active membership and fails closed when it goes stale", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    assert.equal((await alice.state()).status, "organizationRequired");
    const acme = await alice.createOrganization("Acme");
    await alice.createOrganization("Elsewhere");

    await alice.selectOrganization(acme);
    await hub.removeMembership(alice.email, acme);

    assert.equal((await alice.state()).status, "organizationRequired");
    assert.equal(await alice.selectUnavailableOrganization(acme), 404);
  });

  it("resolves PostgreSQL resources from the authenticated active organization", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    const acme = await alice.createOrganization("Acme");
    const acmeResources = await hub.seedResources(acme, "acme");
    const orbit = await alice.createOrganization("Orbit");
    const orbitResources = await hub.seedResources(orbit, "orbit");
    await alice.selectOrganization(acme);

    assert.deepEqual(await alice.resourcePresence(acmeResources), RESOURCE_NAMES);
    assert.deepEqual(await alice.resourcePresence(orbitResources), MISSING_RESOURCES);
    assert.deepEqual(await alice.resourcePresence(missingResources()), MISSING_RESOURCES);
  });

  it("enforces owner, admin, and member policy through the same active boundary", async () => {
    const hub = await startAccounts(postgres);
    const team = await hub.createThreePersonTeam();

    assert.equal(await team.member.createInvitation("blocked@example.com", "member"), 403);
    assert.equal(await team.admin.changeRole(team.owner.memberId, "member"), 403);
    assert.equal(await team.admin.changeRole(team.member.memberId, "owner"), 403);
    assert.equal(await team.owner.changeRole(team.owner.memberId, "member"), 409);

    assert.equal(await team.owner.changeRole(team.admin.memberId, "owner"), 200);
    assert.equal(await team.owner.changeRole(team.owner.memberId, "member"), 200);
    assert.equal((await team.owner.requireActiveState()).membership.role, "member");
  });

  it("removes members without exposing foreign targets or abandoning the last owner", async () => {
    const hub = await startAccounts(postgres);
    const team = await hub.createThreePersonTeam();

    assert.equal(await team.member.removeMember(team.admin.memberId), 403);
    assert.equal(await team.member.removeMember(team.member.memberId), 403);
    assert.equal(await team.admin.removeMember(team.owner.memberId), 403);
    assert.equal(await team.owner.removeMember(randomUUID()), 404);
    assert.equal(await team.owner.removeMember(team.member.memberId), 200);
    assert.equal((await team.member.state()).status, "organizationRequired");
    assert.equal(await team.admin.removeMember(team.admin.memberId), 200);
    assert.equal((await team.admin.state()).status, "organizationRequired");
    assert.equal(await team.owner.removeMember(team.owner.memberId), 409);
  });

  it("cancels invitations and reuses exactly one live invitation credential", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    const organizationId = await alice.createOrganization("Acme");
    const canceled = await alice.invite("bob@example.com", "member");
    const bob = await hub.signUp("Bob", "bob@example.com");

    assert.equal(await alice.cancelInvitation(canceled.id), 200);
    assert.equal(await bob.acceptInvitation(canceled.id), 404);
    const replacement = await alice.invite("bob@example.com", "member");
    assert.notEqual(replacement.id, canceled.id);
    assert.deepEqual(await alice.inviteConcurrently("bob@example.com"), [
      replacement.id,
      replacement.id,
    ]);
    assert.equal(await hub.pendingInvitationCount(organizationId, bob.email), 1);
  });

  it("does not create pending invitations for current members", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    const organizationId = await alice.createOrganization("Acme");
    const invitation = await alice.invite("bob@example.com", "member");
    const bob = await hub.signUp("Bob", "bob@example.com");
    await bob.acceptInvitationSuccessfully(invitation.id);

    assert.equal(await alice.createInvitation(bob.email, "member"), 409);
    assert.equal(await hub.pendingInvitationCount(organizationId, bob.email), 0);
  });

  it("refuses a genuinely new invite once the seat cap has no headroom, and admits it once raised", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    const organizationId = await alice.createOrganization("Acme");
    await hub.capSeats(organizationId, 1, "regression test: enforce the seat cap");

    const denied = await alice.createInvitationDenied("blocked@example.com", "member");
    assert.deepEqual(denied, {
      error: "entitlement_denied",
      entitlement: "seats",
      kind: "cap",
      limit: 1,
      current: 1,
    });
    assert.equal(await hub.pendingInvitationCount(organizationId, "blocked@example.com"), 0);

    await hub.capSeats(organizationId, 2, "regression test: raise the seat cap");
    const invitation = await alice.invite("allowed@example.com", "member");
    assert.ok(invitation.id);
  });

  it("refuses invitations when the can-invite flag is disabled, and admits them once restored", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    const organizationId = await alice.createOrganization("Acme");
    await hub.disableInvites(organizationId, "regression test: enforce the can-invite flag");

    const denied = await alice.createInvitationDenied("blocked@example.com", "member");
    assert.deepEqual(denied, {
      error: "entitlement_denied",
      entitlement: "canInviteMembers",
      kind: "flag",
      limit: null,
      current: null,
    });
    assert.equal(await hub.pendingInvitationCount(organizationId, "blocked@example.com"), 0);

    await hub.restoreInvites(organizationId, "regression test: restore the can-invite flag");
    const invitation = await alice.invite("allowed@example.com", "member");
    assert.ok(invitation.id);
  });

  it("serializes invitation creation against membership acceptance", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    const organizationId = await alice.createOrganization("Acme");
    const invitation = await alice.invite("bob@example.com", "member");
    const bob = await hub.signUp("Bob", "bob@example.com");

    const result = await hub.createInvitationWhileAccepting(alice, bob, invitation);

    assert.equal(result.acceptanceStatus, 200);
    assert.ok(result.creationStatus === 201 || result.creationStatus === 409);
    assert.equal(await hub.membershipCount(bob.email, organizationId), 1);
    assert.equal(await hub.pendingInvitationCount(organizationId, bob.email), 0);
  });

  it("retires a pending legacy credential when membership already exists", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    const organizationId = await alice.createOrganization("Acme");
    const invitation = await alice.invite("bob@example.com", "member");
    const bob = await hub.signUp("Bob", "bob@example.com");
    await hub.addMembership(bob.email, organizationId, "member");

    assert.equal(await bob.acceptInvitation(invitation.id), 200);
    assert.equal(await hub.membershipCount(bob.email, organizationId), 1);
    assert.equal(await hub.pendingInvitationCount(organizationId, bob.email), 0);
  });

  it("denies every active-organization mutation without its request boundary", async () => {
    const hub = await startAccounts(postgres);
    const signedOut = hub.signedOut();
    const withoutOrganization = await hub.signUp("Alice", "alice@example.com");

    assert.deepEqual(await signedOut.teamMutationStatuses(), [401, 401, 401, 401]);
    assert.deepEqual(await withoutOrganization.teamMutationStatuses(), [403, 403, 403, 403]);
  });

  it("validates cookie mutations against the adapter's trusted request origin", async () => {
    const hub = await startAccounts(postgres);
    const request = new Request("http://internal:3000/apps", {
      method: "POST",
      headers: {
        cookie: "session=operator",
        origin: "https://hub.example.test",
        "x-paseo-trusted-request-origin": "https://hub.example.test",
      },
    });

    assert.equal(hub.cookieMutationRejection(request), undefined);
  });

  it("serializes concurrent last-owner role and removal attempts", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    await alice.createOrganization("Acme");
    const memberId = (await alice.requireActiveState()).membership.id;

    assert.deepEqual(
      (await alice.lastOwnerRace(memberId)).sort((left, right) => left - right),
      [409, 409],
    );
    assert.equal((await alice.requireActiveState()).membership.role, "owner");
  });

  it("revalidates an actor whose membership is revoked during a request", async () => {
    const hub = await startAccounts(postgres);
    const team = await hub.createThreePersonTeam();
    const organizationId = (await team.admin.requireActiveState()).organization.id;

    assert.equal(await hub.revokeDuringInvitation(team.admin, organizationId), 403);
    assert.equal(await hub.pendingInvitationCount(organizationId, "blocked@example.com"), 0);
  });

  it("keeps invitation credentials manager-only and bound to the exact account email", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    await alice.createOrganization("Acme");
    const invitation = await alice.invite("bob@example.com", "member");
    const eve = await hub.signUp("Eve", "eve@example.com");

    assert.equal(await eve.acceptInvitation(invitation.id), 404);
    assert.equal((await eve.state()).status, "organizationRequired");
    assert.equal(
      (await alice.requireActiveState()).team.invitations?.[0]?.email,
      "bob@example.com",
    );

    const bob = await hub.signUp("Bob", "bob@example.com");
    await bob.acceptInvitationSuccessfully(invitation.id);
    assert.equal((await bob.requireActiveState()).team.invitations, undefined);
    assert.equal(await bob.acceptInvitation(invitation.id), 404);
  });

  it("accepts one concurrent invitation replay and creates one membership", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    const organizationId = await alice.createOrganization("Acme");
    const invitation = await alice.invite("bob@example.com", "member");
    const bob = await hub.signUp("Bob", "bob@example.com");

    assert.deepEqual(
      (await bob.acceptConcurrently(invitation.id)).sort((left, right) => left - right),
      [200, 404],
    );
    assert.equal(await hub.membershipCount(bob.email, organizationId), 1);
    assert.equal(await bob.acceptInvitation(invitation.id), 404);
  });

  it("conceals foreign targets and closes unsupported Better Auth organization paths", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    const acme = await alice.createOrganization("Acme");
    const invitation = await alice.invite("bob@example.com", "member");
    const acmeMemberId = (await alice.requireActiveState()).team.members[0]!.id;
    await alice.createOrganization("Elsewhere");

    assert.equal(await alice.cancelInvitation(invitation.id), 404);
    assert.equal(await alice.changeRole(acmeMemberId, "admin"), 404);
    assert.equal(await alice.createInvitationWithTenantOverride("foreign"), 400);
    assert.deepEqual(await alice.unsupportedOrganizationPaths(), [404, 404, 404, 404, 404]);
    assert.equal((await alice.requireActiveState()).organization.id === acme, false);
  });

  it("rejects expired invitations and invalid stored roles at the request edge", async () => {
    const hub = await startAccounts(postgres);
    const alice = await hub.signUp("Alice", "alice@example.com");
    const organizationId = await alice.createOrganization("Acme");
    const invitation = await alice.invite("bob@example.com", "member");
    const bob = await hub.signUp("Bob", "bob@example.com");
    await hub.expireInvitation(invitation.id);

    assert.equal(await bob.acceptInvitation(invitation.id), 404);
    await hub.corruptRole(alice.email, organizationId);
    assert.equal((await alice.state()).status, "organizationRequired");
  });
});

interface InvitationCredential {
  id: string;
  link: string;
}

interface ResourceIds {
  machine: string;
  daemon: string;
  deployment: string;
  execution: string;
}

const RESOURCE_NAMES = ["machine", "daemon", "execution"] as const;
const MISSING_RESOURCES = ["missing", "missing", "missing"] as const;

const activeAccounts: PaseoAccounts[] = [];

async function startAccounts(postgres: StartedPostgreSqlContainer): Promise<PaseoAccounts> {
  const accounts = await PaseoAccounts.start(postgres);
  activeAccounts.push(accounts);
  return accounts;
}

async function stopAccounts(): Promise<void> {
  await Promise.all(activeAccounts.splice(0).map(async (accounts) => accounts.stop()));
}

class PaseoAccounts {
  private readonly resources: OrganizationResources;

  private constructor(
    private readonly url: string,
    private readonly database: Database,
    private readonly entitlements: ComposedEntitlements,
    private readonly auth: AuthServer,
  ) {
    this.resources = new OrganizationResources(database);
  }

  static async start(postgres: StartedPostgreSqlContainer): Promise<PaseoAccounts> {
    const url = isolatedDatabaseUrl(postgres);
    const database = await createDatabase(url);
    const entitlements = composeEntitlements(database, testDatabaseRuntime(database));
    return new PaseoAccounts(
      url,
      database,
      entitlements,
      createAuthServer({
        database: testDatabaseRuntime(database),
        locks: testDatabaseLocks(database),
        entitlements: entitlements.service,
        secret: "phase-one-auth-secret-at-least-32-characters",
        baseURL: "http://localhost:3000",
        policy: { registrationMode: "open", organizationCreation: "open", bootstrap: undefined },
      }),
    );
  }

  async signUp(name: string, email: string): Promise<AccountBrowser> {
    const account = new AccountBrowser(
      this.auth,
      this.resources,
      email.toLowerCase(),
      "account-password",
    );
    await account.signUp(name);
    return account;
  }

  async signIn(email: string): Promise<AccountBrowser> {
    const account = new AccountBrowser(
      this.auth,
      this.resources,
      email.toLowerCase(),
      "account-password",
    );
    await account.signIn();
    return account;
  }

  signedOut(): AccountBrowser {
    return new AccountBrowser(this.auth, this.resources, "signed-out@example.com", "unused");
  }

  cookieMutationRejection(request: Request): Response | undefined {
    return this.auth.rejectCookieMutation(request);
  }

  async createThreePersonTeam() {
    const owner = await this.signUp("Alice", "alice@example.com");
    await owner.createOrganization("Acme");
    const adminInvitation = await owner.invite("bob@example.com", "member");
    const admin = await this.signUp("Bob", "bob@example.com");
    await admin.acceptInvitationSuccessfully(adminInvitation.id);
    const adminMemberId = (await owner.requireActiveState()).team.members.find(
      ({ email }) => email === admin.email,
    )!.id;
    await owner.changeRoleSuccessfully(adminMemberId, "admin");
    const memberInvitation = await admin.invite("carol@example.com", "member");
    const member = await this.signUp("Carol", "carol@example.com");
    await member.acceptInvitationSuccessfully(memberInvitation.id);
    const activeOwner = await owner.requireActiveState();
    const ownerMemberId = activeOwner.team.members.find(({ email }) => email === owner.email)!.id;
    const memberMemberId = activeOwner.team.members.find(({ email }) => email === member.email)!.id;
    return {
      owner: Object.assign(owner, { memberId: ownerMemberId }),
      admin: Object.assign(admin, { memberId: adminMemberId }),
      member: Object.assign(member, { memberId: memberMemberId }),
    };
  }

  async capSeats(organizationId: string, max: number, reason: string): Promise<void> {
    await this.entitlements.service.override(organizationId, { seats: { max } }, null, reason);
  }

  async disableInvites(organizationId: string, reason: string): Promise<void> {
    await this.entitlements.service.override(
      organizationId,
      { canInviteMembers: false },
      null,
      reason,
    );
  }

  async restoreInvites(organizationId: string, reason: string): Promise<void> {
    await this.entitlements.service.override(
      organizationId,
      { canInviteMembers: true },
      null,
      reason,
    );
  }

  async removeMembership(email: string, organizationId: string): Promise<void> {
    await this.query(
      `delete from member using "user"
       where member.user_id = "user".id and lower("user".email) = $1
         and member.organization_id = $2`,
      [email, organizationId],
    );
  }

  async addMembership(
    email: string,
    organizationId: string,
    role: "owner" | "admin" | "member",
  ): Promise<void> {
    await this.query(
      `insert into member (id, organization_id, user_id, role)
       select $1, $2, "user".id, $3 from "user" where lower("user".email) = $4`,
      [randomUUID(), organizationId, role, email],
    );
  }

  async createInvitationWhileAccepting(
    manager: AccountBrowser,
    invitee: AccountBrowser,
    invitation: InvitationCredential,
  ): Promise<{ creationStatus: number; acceptanceStatus: number }> {
    const [creationStatus, acceptanceStatus] = await Promise.all([
      manager.createInvitation(invitee.email, "member"),
      invitee.acceptInvitation(invitation.id),
    ]);
    return { creationStatus, acceptanceStatus };
  }

  async membershipCount(email: string, organizationId: string): Promise<number> {
    const result = await this.query<{ count: number }>(
      `select count(*)::integer as count from member
       join "user" on "user".id = member.user_id
       where lower("user".email) = $1 and member.organization_id = $2`,
      [email, organizationId],
    );
    return result[0]!.count;
  }

  async ownerMembershipCount(email: string, organizationId: string): Promise<number> {
    const result = await this.query<{ count: number }>(
      `select count(*)::integer as count from member
       join "user" on "user".id = member.user_id
       where lower("user".email) = $1 and member.organization_id = $2 and member.role = 'owner'`,
      [email, organizationId],
    );
    return result[0]!.count;
  }

  async projects(
    organizationId: string,
  ): Promise<Array<{ name: string; slug: string; createdByEmail: string | null }>> {
    return this.query<{ name: string; slug: string; createdByEmail: string | null }>(
      `select projects.name, projects.slug, "user".email as "createdByEmail"
       from projects
       left join "user" on "user".id = projects.created_by_user_id
       where projects.organization_id = $1
       order by projects.slug`,
      [organizationId],
    );
  }

  async pendingInvitationCount(organizationId: string, email: string): Promise<number> {
    const result = await this.query<{ count: number }>(
      `select count(*)::integer as count from invitation
       where organization_id = $1 and lower(email) = $2 and status = 'pending'`,
      [organizationId, email.toLowerCase()],
    );
    return result[0]!.count;
  }

  async revokeDuringInvitation(actor: AccountBrowser, organizationId: string): Promise<number> {
    const blocker = await createPostgresQueryRuntime(this.url);

    try {
      let request!: Promise<number>;
      await blocker.transaction(async (transaction) => {
        await transaction.query(
          `select member.id from member
         join "user" on "user".id = member.user_id
         where member.organization_id = $1 and lower("user".email) = $2
         for update of member`,
          [organizationId, actor.email],
        );
        request = actor.createInvitation("blocked@example.com", "member");
        await waitForBlockedTransaction(blocker);
        await transaction.query(
          `delete from member using "user"
         where member.user_id = "user".id and member.organization_id = $1
           and lower("user".email) = $2`,
          [organizationId, actor.email],
        );
      });
      return await request;
    } finally {
      await blocker.close();
    }
  }

  async expireInvitation(invitationId: string): Promise<void> {
    await this.query(
      `update invitation set expires_at = now() - interval '1 minute' where id = $1`,
      [invitationId],
    );
  }

  async corruptRole(email: string, organizationId: string): Promise<void> {
    await this.query(`alter table member drop constraint members_role_check`);
    await this.query(
      `update member set role = 'owner,admin' from "user"
       where member.user_id = "user".id and lower("user".email) = $1
         and member.organization_id = $2`,
      [email, organizationId],
    );
  }

  async seedResources(organizationId: string, suffix: string): Promise<ResourceIds> {
    const projectId = randomUUID();
    await this.query(
      `insert into projects (id, organization_id, name, slug) values ($1, $2, $3, $4)`,
      [projectId, organizationId, `Project ${suffix}`, `project-${suffix}`],
    );
    const deployment = await this.database.insertProjectConfigurationRevision({
      projectId,
      sourceKind: "manual",
      sourceEvidence: { kind: "test" },
      normalizedConfiguration: { environments: [], triggers: [] },
      contentHash: `config-${suffix}`,
    });
    const machine = await this.database.insertMachine({
      orgId: organizationId,
      source: { kind: "manual", userId: "seed" },
    });
    const execution = await this.database.insertAgentExecution({
      organizationId,
      projectId,
      machineId: machine.id,
      triggerContext: {},
      outputContext: {},
      configurationRevisionId: deployment.id,
    });
    const daemon = randomUUID();
    await this.query(
      `insert into daemons
        (id, idempotency_key, enrollment_verifier, slug, machine_id, organization_id, server_id,
         daemon_public_key, credential_verifier, scopes, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '[]', 'active')`,
      [
        daemon,
        `key-${suffix}`,
        `verifier-${suffix}`,
        `daemon-${suffix}`,
        machine.id,
        organizationId,
        `server-${suffix}`,
        `public-key-${suffix}`,
        `credential-${suffix}`,
      ],
    );
    return { machine: machine.id, daemon, deployment: deployment.id, execution: execution.id };
  }

  async stop(): Promise<void> {
    await this.auth.close();
    await this.entitlements.close();
    await this.database.close();
  }

  private async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<TRow[]> {
    const client = await createPostgresQueryRuntime(this.url);

    try {
      return (await client.query<TRow>(text, values)).rows;
    } finally {
      await client.close();
    }
  }
}

class AccountBrowser {
  private cookie = "";

  constructor(
    private readonly auth: AuthServer,
    private readonly resources: OrganizationResources,
    readonly email: string,
    private readonly password: string,
  ) {}

  async signUp(name: string): Promise<void> {
    const response = await this.post("/api/auth/sign-up/email", {
      name,
      email: this.email,
      password: this.password,
    });
    assert.equal(response.status, 200);
    this.rememberCookie(response);
  }

  async signIn(): Promise<void> {
    const response = await this.post("/api/auth/sign-in/email", {
      email: this.email,
      password: this.password,
    });
    assert.equal(response.status, 200);
    this.rememberCookie(response);
  }

  async createOrganizationWithMetadata(): Promise<number> {
    return (
      await this.post("/api/auth/paseo/create-organization", {
        name: "Unbounded",
        metadata: { plan: "phase-two" },
      })
    ).status;
  }

  async session(): Promise<{ email: string; activeOrganizationId: string }> {
    const response = await this.get("/api/auth/get-session");
    const session = z
      .object({
        session: z.object({ activeOrganizationId: z.string() }).passthrough(),
        user: z.object({ email: z.string() }).passthrough(),
      })
      .parse(await response.json());
    return {
      email: session.user.email,
      activeOrganizationId: session.session.activeOrganizationId,
    };
  }

  async state(): Promise<AccountState> {
    const response = await this.get("/api/auth/paseo/state");
    assert.equal(response.status, 200);
    return accountStateSchema.parse(await response.json());
  }

  async requireActiveState(): Promise<ActiveState> {
    const state = await this.state();
    assert.equal(state.status, "active");
    return state;
  }

  async createOrganization(name: string): Promise<string> {
    const response = await this.post("/api/auth/paseo/create-organization", { name });
    assert.equal(response.status, 201);
    return z.object({ organizationId: z.string() }).parse(await response.json()).organizationId;
  }

  async selectOrganization(organizationId: string): Promise<void> {
    assert.equal(await this.selectUnavailableOrganization(organizationId), 200);
  }

  async selectUnavailableOrganization(organizationId: string): Promise<number> {
    return (await this.post("/api/auth/paseo/select-organization", { organizationId })).status;
  }

  async invite(email: string, role: "admin" | "member"): Promise<InvitationCredential> {
    const response = await this.post("/api/auth/paseo/create-invitation", { email, role });
    assert.equal(response.status, 201);
    return z.object({ id: z.string(), link: z.string() }).parse(await response.json());
  }

  async createInvitation(email: string, role: "admin" | "member"): Promise<number> {
    return (await this.post("/api/auth/paseo/create-invitation", { email, role })).status;
  }

  async createInvitationDenied(
    email: string,
    role: "admin" | "member",
  ): Promise<{
    error: string;
    entitlement: string;
    kind: string;
    limit: number | null;
    current: number | null;
  }> {
    const response = await this.post("/api/auth/paseo/create-invitation", { email, role });
    assert.equal(response.status, 409);
    return z
      .object({
        error: z.string(),
        entitlement: z.string(),
        kind: z.string(),
        limit: z.number().nullable(),
        current: z.number().nullable(),
      })
      .parse(await response.json());
  }

  async inviteConcurrently(email: string): Promise<string[]> {
    const invitations = await Promise.all([
      this.invite(email, "member"),
      this.invite(email, "member"),
    ]);
    return invitations.map(({ id }) => id);
  }

  async createInvitationWithTenantOverride(organizationId: string): Promise<number> {
    return (
      await this.post("/api/auth/paseo/create-invitation", {
        email: "target@example.com",
        role: "member",
        organizationId,
      })
    ).status;
  }

  async cancelInvitation(invitationId: string): Promise<number> {
    return (await this.post("/api/auth/paseo/cancel-invitation", { invitationId })).status;
  }

  async acceptInvitation(invitationId: string): Promise<number> {
    return (await this.post("/api/auth/paseo/accept-invitation", { invitationId })).status;
  }

  async acceptInvitationSuccessfully(invitationId: string): Promise<void> {
    assert.equal(await this.acceptInvitation(invitationId), 200);
  }

  async acceptConcurrently(invitationId: string): Promise<number[]> {
    const responses = await Promise.all([
      this.post("/api/auth/paseo/accept-invitation", { invitationId }),
      this.post("/api/auth/paseo/accept-invitation", { invitationId }),
    ]);
    return responses.map(({ status }) => status);
  }

  async changeRole(memberId: string, role: "owner" | "admin" | "member"): Promise<number> {
    return (
      await this.post("/api/auth/paseo/change-member-role", {
        memberId,
        role,
      })
    ).status;
  }

  async changeRoleSuccessfully(
    memberId: string,
    role: "owner" | "admin" | "member",
  ): Promise<void> {
    assert.equal(await this.changeRole(memberId, role), 200);
  }

  async removeMember(memberId: string): Promise<number> {
    return (await this.post("/api/auth/paseo/remove-member", { memberId })).status;
  }

  async lastOwnerRace(memberId: string): Promise<number[]> {
    const responses = await Promise.all([
      this.post("/api/auth/paseo/change-member-role", { memberId, role: "member" }),
      this.post("/api/auth/paseo/remove-member", { memberId }),
    ]);
    return responses.map(({ status }) => status);
  }

  async teamMutationStatuses(): Promise<number[]> {
    const responses = await Promise.all([
      this.post("/api/auth/paseo/create-invitation", {
        email: "target@example.com",
        role: "member",
      }),
      this.post("/api/auth/paseo/cancel-invitation", { invitationId: randomUUID() }),
      this.post("/api/auth/paseo/change-member-role", {
        memberId: randomUUID(),
        role: "member",
      }),
      this.post("/api/auth/paseo/remove-member", { memberId: randomUUID() }),
    ]);
    return responses.map(({ status }) => status);
  }

  async unsupportedOrganizationPaths(): Promise<number[]> {
    const paths = [
      "/api/auth/organization/create",
      "/api/auth/organization/list-invitations",
      "/api/auth/organization/get-full-organization",
      "/api/auth/organization/delete",
      "/api/auth/organization/add-member",
    ];
    const responses = await Promise.all(paths.map((path) => this.post(path, {})));
    return responses.map(({ status }) => status);
  }

  async resourcePresence(ids: ResourceIds): Promise<string[]> {
    const reader = await this.auth.resources(this.request("/resources"), this.resources);
    const values = await Promise.all([
      reader.machine(ids.machine),
      reader.daemon(ids.daemon),
      reader.execution(ids.execution),
    ]);
    return values.map((value, index) => (value === undefined ? "missing" : RESOURCE_NAMES[index]!));
  }

  private get(path: string): Promise<Response> {
    const request = this.request(path);
    if (path.startsWith("/api/auth/paseo/")) {
      assert.ok(this.auth.browserAccount !== undefined);
      return this.auth.browserAccount(request);
    }
    return this.auth.handle(request);
  }

  private post(path: string, body: unknown): Promise<Response> {
    const request = new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
        ...(this.cookie.length === 0 ? {} : { cookie: this.cookie }),
      },
      body: JSON.stringify(body),
    });
    if (path.startsWith("/api/auth/paseo/")) {
      assert.ok(this.auth.browserAccount !== undefined);
      return this.auth.browserAccount(request);
    }
    return this.auth.handle(request);
  }

  private rememberCookie(response: Response): void {
    this.cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
  }

  private request(path: string): Request {
    return new Request(`http://localhost:3000${path}`, {
      headers: this.cookie.length === 0 ? {} : { cookie: this.cookie },
    });
  }
}

function missingResources(): ResourceIds {
  return {
    machine: randomUUID(),
    daemon: randomUUID(),
    deployment: randomUUID(),
    execution: randomUUID(),
  };
}

async function waitForBlockedTransaction(client: DatabaseRuntime): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query<{ blocked: boolean }>(
      `select exists (
         select 1 from pg_locks
         where not granted
       ) as blocked`,
    );
    if (result.rows[0]?.blocked === true) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("organization mutation did not reach the membership lock");
}

function isolatedDatabaseUrl(postgres: StartedPostgreSqlContainer): string {
  const url = new URL(postgres.getConnectionUri());
  url.pathname = `/auth_${randomUUID().replaceAll("-", "")}`;
  return url.toString();
}
