import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, it } from "vitest";
import type { CompiledHubBundle } from "../config/bundle.js";
import type { CompiledHubConfig } from "../config/compiler.js";
import type { ChannelControlPlane } from "../channels/config/compile.js";
import {
  assertAutomationConfigurationDelegation,
  assertChannelConfigurationDelegation,
} from "../access/delegation.js";
import { AccessPolicyError, AccessStore, type DelegatedAgentExecution } from "../access/store.js";
import * as schema from "../db/schema.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import {
  AccessTicketError,
  AccessTicketService,
  DEFAULT_ACCESS_LEASE_DURATION_MS,
  readAccessLeaseDuration,
} from "./tickets.js";
import { AccessLeaseRevocation } from "./revocation.js";

let bundle: DatabaseRuntimeBundle;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hub-managed-access-"));
  bundle = await embeddedDatabaseRuntime(root);
  await bundle.runtime.migrate();
}, 60_000);

afterEach(async () => {
  await bundle.runtime.close();
  await rm(root, { recursive: true, force: true });
}, 30_000);

it("uses a 15 minute lease by default and accepts a bounded minute override", () => {
  assert.equal(readAccessLeaseDuration(undefined), DEFAULT_ACCESS_LEASE_DURATION_MS);
  assert.equal(readAccessLeaseDuration("5m"), 5 * 60_000);
  assert.equal(readAccessLeaseDuration("1h"), 60 * 60_000);
  assert.throws(() => readAccessLeaseDuration("5"), /between 1m and 1h/);
  assert.throws(() => readAccessLeaseDuration("0m"), /between 1m and 1h/);
  assert.throws(() => readAccessLeaseDuration("61m"), /between 1m and 1h/);
});

it("keeps owner access implicit and resolves additive Team plus Member project grants", async () => {
  const fixture = await seedAuthority();
  const access = new AccessStore(bundle.runtime);
  const projects = await access.replaceDaemonProjects(fixture.organizationId, fixture.daemonId, [
    { projectId: "project-alpha", name: "Alpha" },
    { projectId: "project-beta", name: "Beta" },
  ]);

  const owner = await access.resolveDaemonAccess({
    ...fixture,
    userId: fixture.ownerUserId,
    membershipId: fixture.ownerMembershipId,
  });
  assert.equal(owner?.owner, true);
  assert.equal(owner?.resourceMode, "daemon");
  assert.equal(owner?.permissions.includes("hub.execute"), false);

  assert.equal(
    await access.resolveDaemonAccess({
      ...fixture,
      userId: fixture.memberUserId,
      membershipId: fixture.memberMembershipId,
    }),
    undefined,
  );

  await access.saveAssignment(
    fixture.organizationId,
    {
      subjectKind: "team",
      subjectId: fixture.teamId,
      resourceKind: "daemon",
      resourceId: fixture.daemonId,
      privileges: ["daemon.connect", "project.use", "agent.interact"],
      constraints: {},
    },
    fixture.ownerUserId,
  );
  await access.saveAssignment(
    fixture.organizationId,
    {
      subjectKind: "member",
      subjectId: fixture.memberMembershipId,
      resourceKind: "project",
      resourceId: projects[0]!.id,
      privileges: ["project.use", "agent.create", "terminal.use"],
      constraints: {
        agentConfigurations: [
          {
            providerId: "codex",
            modelIds: ["gpt-5"],
            thinkingOptionIds: ["high"],
          },
        ],
      },
    },
    fixture.ownerUserId,
  );

  const member = await access.resolveDaemonAccess({
    ...fixture,
    userId: fixture.memberUserId,
    membershipId: fixture.memberMembershipId,
  });
  assert.equal(member?.owner, false);
  assert.equal(member?.resourceMode, "projects");
  assert.deepEqual(
    member?.projects.map(({ projectId, privileges }) => ({
      projectId,
      privileges,
    })),
    [
      {
        projectId: "project-alpha",
        privileges: ["project.use", "agent.interact", "agent.create", "terminal.use"],
      },
      {
        projectId: "project-beta",
        privileges: ["project.use", "agent.interact"],
      },
    ],
  );
  assert.deepEqual(member?.projects[0]?.agentConfigurations, [
    { providerId: "codex", modelIds: ["gpt-5"], thinkingOptionIds: ["high"] },
  ]);

  await access.saveAssignment(
    fixture.organizationId,
    {
      subjectKind: "member",
      subjectId: fixture.memberMembershipId,
      resourceKind: "daemon",
      resourceId: fixture.daemonId,
      privileges: ["daemon.manage"],
      constraints: {},
    },
    fixture.ownerUserId,
  );
  const administrator = await access.resolveDaemonAccess({
    ...fixture,
    userId: fixture.memberUserId,
    membershipId: fixture.memberMembershipId,
  });
  assert.equal(administrator?.resourceMode, "daemon");
  assert.equal(administrator?.permissions.includes("daemon.manage"), true);
  assert.equal(administrator?.permissions.includes("hub.execute"), false);
  assert.deepEqual(administrator?.projects, []);
});

it("fails closed when an administrator delegates an Agent configuration above current Access", async () => {
  const fixture = await seedAuthority();
  const access = new AccessStore(bundle.runtime);
  await bundle.runtime
    .drizzle()
    .update(schema.members)
    .set({ role: "admin" })
    .where(eq(schema.members.id, fixture.memberMembershipId));
  const [project] = await access.replaceDaemonProjects(fixture.organizationId, fixture.daemonId, [
    {
      projectId: "project-alpha",
      name: "Alpha",
      metadata: { agentConfigurationCatalog: agentConfigurationCatalog() },
    },
  ]);
  assert.ok(project !== undefined);

  const target: DelegatedAgentExecution = {
    daemonReference: fixture.daemonId,
    projectId: "project-alpha",
    cwd: "/workspace/project-alpha",
    providerId: "codex",
    modelId: "gpt-5",
    modeId: "auto-review",
    thinkingOptionId: "high",
    fastMode: false,
    requiredPrivileges: [],
  };
  const requireAdminDelegation = (execution: DelegatedAgentExecution = target) =>
    access.assertCanDelegateAgentExecutions({
      organizationId: fixture.organizationId,
      userId: fixture.memberUserId,
      membershipId: fixture.memberMembershipId,
      executions: [execution],
    });

  await assert.rejects(requireAdminDelegation(), accessDenied);
  await access.saveAssignment(
    fixture.organizationId,
    {
      subjectKind: "member",
      subjectId: fixture.memberMembershipId,
      resourceKind: "daemon",
      resourceId: fixture.daemonId,
      privileges: ["daemon.connect"],
      constraints: {},
    },
    fixture.ownerUserId,
  );
  await access.saveAssignment(
    fixture.organizationId,
    {
      subjectKind: "member",
      subjectId: fixture.memberMembershipId,
      resourceKind: "project",
      resourceId: project.id,
      privileges: ["project.use", "agent.create"],
      constraints: {
        agentConfigurations: [
          {
            providerId: "codex",
            modelIds: ["gpt-5"],
            thinkingOptionIds: ["high"],
          },
        ],
      },
    },
    fixture.ownerUserId,
  );

  await assert.rejects(requireAdminDelegation({ ...target, modelId: "gpt-6" }), accessDenied);
  await assert.rejects(requireAdminDelegation({ ...target, fastMode: true }), accessDenied);
  await assert.rejects(requireAdminDelegation({ ...target, modeId: "full-access" }), accessDenied);
  await assert.rejects(requireAdminDelegation({ ...target, modeId: "unknown" }), accessDenied);
  await assert.rejects(
    requireAdminDelegation({
      ...target,
      requiredPrivileges: ["approval.command"],
    }),
    accessDenied,
  );
  await requireAdminDelegation();

  await access.saveAssignment(
    fixture.organizationId,
    {
      subjectKind: "member",
      subjectId: fixture.memberMembershipId,
      resourceKind: "project",
      resourceId: project.id,
      privileges: ["project.use", "agent.create", "agent.fast.use", "approval.command"],
      constraints: {
        agentConfigurations: [
          {
            providerId: "codex",
            modelIds: ["gpt-5"],
            thinkingOptionIds: ["high"],
          },
        ],
      },
    },
    fixture.ownerUserId,
  );
  await requireAdminDelegation({
    ...target,
    fastMode: true,
    requiredPrivileges: ["approval.command"],
  });
  await assert.rejects(requireAdminDelegation({ ...target, modeId: "full-access" }), accessDenied);

  await access.assertCanDelegateAgentExecutions({
    organizationId: fixture.organizationId,
    userId: fixture.ownerUserId,
    membershipId: fixture.ownerMembershipId,
    executions: [
      {
        ...target,
        modelId: "owner-unrestricted-model",
        modeId: "full-access",
        fastMode: true,
        requiredPrivileges: ["approval.command.destructive"],
      },
    ],
  });
});

it("rejects unattended Automation and auto-accept Channel delegation for a project-scoped administrator", async () => {
  const fixture = await seedAuthority();
  const access = new AccessStore(bundle.runtime);
  await bundle.runtime
    .drizzle()
    .update(schema.members)
    .set({ role: "admin" })
    .where(eq(schema.members.id, fixture.memberMembershipId));
  const [project] = await access.replaceDaemonProjects(fixture.organizationId, fixture.daemonId, [
    {
      projectId: "project-alpha",
      name: "Alpha",
      metadata: { agentConfigurationCatalog: agentConfigurationCatalog() },
    },
  ]);
  assert.ok(project !== undefined);
  await access.saveAssignments(
    fixture.organizationId,
    [
      {
        subjectKind: "member",
        subjectId: fixture.memberMembershipId,
        resourceKind: "daemon",
        resourceId: fixture.daemonId,
        privileges: ["daemon.connect"],
        constraints: {},
      },
      {
        subjectKind: "member",
        subjectId: fixture.memberMembershipId,
        resourceKind: "project",
        resourceId: project.id,
        privileges: ["project.use", "agent.create"],
        constraints: {
          agentConfigurations: [{ providerId: "codex", modelIds: "*", thinkingOptionIds: "*" }],
        },
      },
    ],
    fixture.ownerUserId,
  );

  const environment = {
    name: "work",
    kind: "daemon",
    daemon: fixture.daemonId,
    projectId: "project-alpha",
    cwd: "/workspace/app",
  } as const;
  const automationConfiguration = {
    environments: [environment],
    triggers: [
      {
        steps: [
          {
            environment: "work",
            agent: { provider: "codex", mode: "full-access" },
          },
        ],
      },
    ],
  } as unknown as CompiledHubConfig;
  const channelBundle = {
    configuration: { environments: [environment], triggers: [] },
    agents: {
      unsafe: {
        provider: "codex",
        mode: "auto-review",
        featureValues: { auto_accept: true },
      },
    },
  } as unknown as CompiledHubBundle;
  const channelControlPlane = {
    accounts: [
      {
        routes: [
          {
            target: {
              kind: "agent",
              agent: "unsafe",
              environment: "work",
              template: null,
            },
            approval: [],
            defaults: { outbound: { path: "relay", template: null } },
          },
        ],
        fallback: { deny: true },
      },
    ],
  } as unknown as ChannelControlPlane;
  const administrator = {
    organizationId: fixture.organizationId,
    userId: fixture.memberUserId,
    membershipId: fixture.memberMembershipId,
  };

  await assert.rejects(
    assertAutomationConfigurationDelegation({
      access,
      principal: administrator,
      configuration: automationConfiguration,
    }),
    accessDenied,
  );
  await assert.rejects(
    assertChannelConfigurationDelegation({
      access,
      database: bundle.runtime.drizzle() as never,
      principal: administrator,
      bundle: channelBundle,
      controlPlane: channelControlPlane,
    }),
    accessDenied,
  );

  const owner = {
    organizationId: fixture.organizationId,
    userId: fixture.ownerUserId,
    membershipId: fixture.ownerMembershipId,
  };
  await assertAutomationConfigurationDelegation({
    access,
    principal: owner,
    configuration: automationConfiguration,
  });
  await assertChannelConfigurationDelegation({
    access,
    database: bundle.runtime.drizzle() as never,
    principal: owner,
    bundle: channelBundle,
    controlPlane: channelControlPlane,
  });
});

it("does not persist role-derived Hub administration as a resource assignment", async () => {
  const fixture = await seedAuthority();
  const access = new AccessStore(bundle.runtime);

  await assert.rejects(
    access.saveAssignment(
      fixture.organizationId,
      {
        subjectKind: "member",
        subjectId: fixture.memberMembershipId,
        resourceKind: "organization",
        resourceId: fixture.organizationId,
        privileges: ["hub.configure"],
        constraints: {},
      },
      fixture.ownerUserId,
    ),
    (error: unknown) => error instanceof AccessPolicyError && error.code === "invalid_assignment",
  );
});

it("stores only a verifier, consumes once, binds the client, and rechecks current grants", async () => {
  const fixture = await seedAuthority();
  const access = new AccessStore(bundle.runtime);
  await access.replaceDaemonProjects(fixture.organizationId, fixture.daemonId, [
    { projectId: "project-alpha", name: "Alpha" },
  ]);
  const assignment = await access.saveAssignment(
    fixture.organizationId,
    {
      subjectKind: "member",
      subjectId: fixture.memberMembershipId,
      resourceKind: "daemon",
      resourceId: fixture.daemonId,
      privileges: ["daemon.connect", "project.use", "agent.interact"],
      constraints: {},
    },
    fixture.ownerUserId,
  );
  const tickets = new AccessTicketService(bundle.runtime, access, {
    leaseDurationMs: 60_000,
  });
  const first = await tickets.issue({
    ...fixture,
    userId: fixture.memberUserId,
    membershipId: fixture.memberMembershipId,
    clientId: "client-a",
  });
  const stored = await bundle.runtime.query<{ token_verifier: string }>(
    `select token_verifier from daemon_access_tickets`,
  );
  assert.equal(stored.rows[0]?.token_verifier, verifier(first.accessTicket));
  assert.equal(stored.rows[0]?.token_verifier.includes(first.accessTicket), false);

  await assert.rejects(
    tickets.consume({
      daemonId: fixture.daemonId,
      accessTicket: first.accessTicket,
      clientId: "client-b",
    }),
    invalidTicket,
  );
  const admission = await tickets.consume({
    daemonId: fixture.daemonId,
    accessTicket: first.accessTicket,
    clientId: "client-a",
  });
  assert.equal(admission.principalId, fixture.memberMembershipId);
  assert.equal(admission.projects[0]?.projectId, "project-alpha");
  assert.equal(admission.leaseExpiresAt.getTime() > Date.now(), true);
  const refreshed = await tickets.refresh({
    daemonId: fixture.daemonId,
    leaseId: admission.leaseId,
    now: new Date(admission.leaseExpiresAt.getTime() - 30_000),
  });
  assert.equal(refreshed.leaseId, admission.leaseId);
  assert.equal(refreshed.leaseExpiresAt.getTime(), admission.leaseExpiresAt.getTime() + 30_000);
  await assert.rejects(
    tickets.consume({
      daemonId: fixture.daemonId,
      accessTicket: first.accessTicket,
      clientId: "client-a",
    }),
    invalidTicket,
  );

  const revoked = await tickets.issue({
    ...fixture,
    userId: fixture.memberUserId,
    membershipId: fixture.memberMembershipId,
    clientId: "client-a",
  });
  await access.deleteAssignment(fixture.organizationId, assignment.id);
  await assert.rejects(
    tickets.refresh({
      daemonId: fixture.daemonId,
      leaseId: admission.leaseId,
      now: new Date(refreshed.leaseExpiresAt.getTime() - 30_000),
    }),
    (error: unknown) => error instanceof AccessTicketError && error.code === "access_denied",
  );
  const [storedLease] = await bundle.runtime
    .drizzle()
    .select({ revokedAt: schema.daemonAccessLeases.revokedAt })
    .from(schema.daemonAccessLeases)
    .where(eq(schema.daemonAccessLeases.id, admission.leaseId));
  assert.notEqual(storedLease?.revokedAt, null);
  await assert.rejects(
    tickets.consume({
      daemonId: fixture.daemonId,
      accessTicket: revoked.accessTicket,
      clientId: "client-a",
    }),
    (error: unknown) => error instanceof AccessTicketError && error.code === "access_denied",
  );
});

it("persists organization revocation before notifying each affected daemon", async () => {
  const fixture = await seedAuthority();
  const access = new AccessStore(bundle.runtime);
  await access.saveAssignment(
    fixture.organizationId,
    {
      subjectKind: "member",
      subjectId: fixture.memberMembershipId,
      resourceKind: "daemon",
      resourceId: fixture.daemonId,
      privileges: ["daemon.connect", "project.use"],
      constraints: {},
    },
    fixture.ownerUserId,
  );
  const tickets = new AccessTicketService(bundle.runtime, access, {
    leaseDurationMs: 60_000,
  });
  const issued = await tickets.issue({
    ...fixture,
    userId: fixture.memberUserId,
    membershipId: fixture.memberMembershipId,
    clientId: "client-a",
  });
  const admission = await tickets.consume({
    daemonId: fixture.daemonId,
    accessTicket: issued.accessTicket,
    clientId: "client-a",
  });
  const notified: Array<{ daemonId: string; leaseIds: readonly string[] }> = [];
  const revocation = new AccessLeaseRevocation(tickets, (daemonId, leaseIds) => {
    notified.push({ daemonId, leaseIds });
  });

  const revoked = await revocation.revokeOrganization(fixture.organizationId);

  assert.deepEqual(revoked, [{ id: admission.leaseId, daemonId: fixture.daemonId }]);
  assert.deepEqual(notified, [{ daemonId: fixture.daemonId, leaseIds: [admission.leaseId] }]);
  const stored = await bundle.runtime.query<{ revoked_at: Date | null }>(
    `select revoked_at from daemon_access_leases where id = $1`,
    [admission.leaseId],
  );
  assert.notEqual(stored.rows[0]?.revoked_at, null);
});

async function seedAuthority() {
  const organizationId = "org";
  const ownerUserId = "owner-user";
  const memberUserId = "member-user";
  const ownerMembershipId = "owner-membership";
  const memberMembershipId = "member-membership";
  const teamId = "developers";
  const machineId = randomUUID();
  const daemonId = randomUUID();
  const database = bundle.runtime.drizzle();
  await database
    .insert(schema.organizations)
    .values({ id: organizationId, name: "Org", slug: "org" });
  await database.insert(schema.users).values([
    {
      id: ownerUserId,
      name: "Owner",
      email: "owner@example.test",
      emailVerified: true,
    },
    {
      id: memberUserId,
      name: "Member",
      email: "member@example.test",
      emailVerified: true,
    },
  ]);
  await database.insert(schema.members).values([
    {
      id: ownerMembershipId,
      organizationId,
      userId: ownerUserId,
      role: "owner",
    },
    {
      id: memberMembershipId,
      organizationId,
      userId: memberUserId,
      role: "member",
    },
  ]);
  await database.insert(schema.teams).values({ id: teamId, organizationId, name: "Developers" });
  await database
    .insert(schema.teamMembers)
    .values({ id: "team-member", teamId, userId: memberUserId });
  await database.insert(schema.machines).values({
    id: machineId,
    orgId: organizationId,
    source: { kind: "manual" },
    status: "alive",
  });
  await database.insert(schema.daemons).values({
    id: daemonId,
    idempotencyKey: "daemon-idempotency",
    enrollmentVerifier: "enrollment-verifier",
    slug: "workstation",
    machineId,
    organizationId,
    serverId: "server",
    daemonPublicKey: "public-key",
    credentialVerifier: "credential-verifier",
    permissions: ["hub.execute"],
    status: "active",
  });
  return {
    organizationId,
    daemonId,
    ownerUserId,
    memberUserId,
    ownerMembershipId,
    memberMembershipId,
    teamId,
  };
}

function agentConfigurationCatalog() {
  return {
    providers: [
      {
        id: "codex",
        label: "Codex",
        defaultModeId: "auto-review",
        modes: [
          { id: "auto-review", label: "Auto-review", isUnattended: false },
          { id: "full-access", label: "Full Access", isUnattended: true },
        ],
        models: [],
      },
    ],
  };
}

function verifier(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function invalidTicket(error: unknown): boolean {
  return error instanceof AccessTicketError && error.code === "invalid_ticket";
}

function accessDenied(error: unknown): boolean {
  return error instanceof AccessPolicyError && error.code === "access_denied";
}
