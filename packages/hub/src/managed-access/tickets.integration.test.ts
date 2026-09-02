import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "vitest";
import { AccessStore } from "../access/store.js";
import * as schema from "../db/schema.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import { AccessTicketError, AccessTicketService } from "./tickets.js";

let bundle: DatabaseRuntimeBundle;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hub-managed-access-"));
  bundle = await embeddedDatabaseRuntime(root);
  await bundle.runtime.migrate();
}, 30_000);

afterEach(async () => {
  await bundle.runtime.close();
  await rm(root, { recursive: true, force: true });
}, 30_000);

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
      constraints: {
        agentConfigurations: [
          { providerId: "codex", modelIds: ["gpt-5"], thinkingOptionIds: ["high"] },
        ],
      },
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
      privileges: ["project.use", "terminal.use"],
      constraints: {},
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
    member?.projects.map(({ projectId, privileges }) => ({ projectId, privileges })),
    [
      {
        projectId: "project-alpha",
        privileges: ["project.use", "agent.interact", "terminal.use"],
      },
      { projectId: "project-beta", privileges: ["project.use", "agent.interact"] },
    ],
  );
  assert.deepEqual(member?.projects[0]?.agentConfigurations, [
    { providerId: "codex", modelIds: ["gpt-5"], thinkingOptionIds: ["high"] },
  ]);
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
  const tickets = new AccessTicketService(bundle.runtime, access, { leaseDurationMs: 60_000 });
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
    tickets.consume({
      daemonId: fixture.daemonId,
      accessTicket: revoked.accessTicket,
      clientId: "client-a",
    }),
    (error: unknown) => error instanceof AccessTicketError && error.code === "access_denied",
  );
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
    { id: ownerUserId, name: "Owner", email: "owner@example.test", emailVerified: true },
    { id: memberUserId, name: "Member", email: "member@example.test", emailVerified: true },
  ]);
  await database.insert(schema.members).values([
    { id: ownerMembershipId, organizationId, userId: ownerUserId, role: "owner" },
    { id: memberMembershipId, organizationId, userId: memberUserId, role: "member" },
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

function verifier(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function invalidTicket(error: unknown): boolean {
  return error instanceof AccessTicketError && error.code === "invalid_ticket";
}
