import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "vitest";
import { z } from "zod";
import { RESOURCE_ACCESS_LEVELS } from "../access/contract.js";
import { AccessStore } from "../access/store.js";
import type { BrowserOrganizationAccess } from "../auth/browser-organization-access.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { createDatabase } from "../db/pg.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import { AccessTicketService } from "../managed-access/tickets.js";
import { enrollTestDaemon, TEST_DAEMON_ID } from "../test-utils/project-configuration.js";
import { ManagementApi } from "./index.js";

const ORGANIZATION_ID = "org";
const OWNER = { userId: "owner", membershipId: "owner-membership", role: "owner" as const };
const LEAD = { userId: "lead", membershipId: "lead-membership", role: "member" as const };

const teamAccessSchema = z.object({
  assignments: z.array(z.object({ subjectId: z.string(), resourceKind: z.string() })),
  resources: z.array(z.object({ kind: z.string(), id: z.string(), name: z.string() })),
  accessLevels: z.record(z.string(), z.unknown()),
});

let bundle: DatabaseRuntimeBundle;
let root: string;
let owner: ManagementApi;
let lead: ManagementApi;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hub-teams-"));
  bundle = await embeddedDatabaseRuntime(root);
  await bundle.runtime.migrate();
  const db = bundle.runtime.drizzle();
  await db.insert(schema.organizations).values({ id: ORGANIZATION_ID, name: "Org", slug: "org" });
  await db.insert(schema.users).values(
    [OWNER, LEAD].map(({ userId }) => ({
      id: userId,
      name: userId,
      email: `${userId}@example.test`,
      emailVerified: true,
    })),
  );
  await db.insert(schema.members).values(
    [OWNER, LEAD].map(({ userId, membershipId, role }) => ({
      id: membershipId,
      organizationId: ORGANIZATION_ID,
      userId,
      role,
    })),
  );
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await enrollTestDaemon(database, ORGANIZATION_ID);
  const access = new AccessStore(bundle.runtime);
  const common = {
    database,
    runtime: bundle.runtime,
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: null,
  };
  owner = new ManagementApi({ ...common, auth: accessFor(OWNER) });
  lead = new ManagementApi({ ...common, auth: accessFor(LEAD) });
}, 30_000);

afterEach(async () => {
  await bundle.runtime.close();
  await rm(root, { recursive: true, force: true });
}, 30_000);

it("shows a Team Admin the Team's grants read-only, and nobody else's Team", async () => {
  const team = await createTeam("QC");
  const otherTeam = await createTeam("Design");
  const granted = await owner.handle(
    request("/access-assignments", "POST", {
      subjectKind: "team",
      subjectId: team,
      resourceKind: "daemon",
      resourceId: TEST_DAEMON_ID,
      privileges: [...RESOURCE_ACCESS_LEVELS.daemon.connect],
      constraints: {},
    }),
  );
  assert.equal(granted.status, 201);

  // An ordinary Member reads no Team's grants.
  assert.equal((await lead.handle(request(`/teams/${team}/access`, "GET"))).status, 403);

  const appointed = await owner.handle(
    request("/access-assignments", "POST", {
      subjectKind: "member",
      subjectId: LEAD.membershipId,
      resourceKind: "team",
      resourceId: team,
      privileges: [...RESOURCE_ACCESS_LEVELS.team.admin],
      constraints: {},
    }),
  );
  assert.equal(appointed.status, 201);
  const response = await lead.handle(request(`/teams/${team}/access`, "GET"));
  assert.equal(response.status, 200);
  const body = teamAccessSchema.parse(await response.json());
  assert.deepEqual(
    body.assignments.map(({ subjectId, resourceKind }) => [subjectId, resourceKind]),
    [[team, "daemon"]],
  );
  // The Host the grant names, and its parent, so the app can word the level and the Host.
  assert.deepEqual(
    body.resources.map(({ kind, id }) => [kind, id]),
    [
      ["daemon", TEST_DAEMON_ID],
      ["organization", ORGANIZATION_ID],
    ],
  );
  assert.ok("daemon" in body.accessLevels);

  // Another Team's grants stay closed; an unknown Team is 404 for an Organization Admin.
  assert.equal((await lead.handle(request(`/teams/${otherTeam}/access`, "GET"))).status, 403);
  assert.equal((await owner.handle(request("/teams/missing/access", "GET"))).status, 404);
}, 60_000);

async function createTeam(name: string): Promise<string> {
  const created = await owner.handle(request("/teams", "POST", { name }));
  assert.equal(created.status, 201);
  return z.object({ id: z.string() }).parse(await created.json()).id;
}

function request(path: string, method: string, body?: unknown): Request {
  return new Request(
    `https://hub.example.test/api/management/v1/organizations/${ORGANIZATION_ID}${path}`,
    {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    },
  );
}

function accessFor(member: typeof OWNER | typeof LEAD): BrowserOrganizationAccess {
  const admin = member.role === "owner";
  const value = {
    session: { id: `${member.userId}-session` },
    account: { id: member.userId, name: member.userId, email: `${member.userId}@example.test` },
    organization: { id: ORGANIZATION_ID, name: "Org", slug: "org" },
    membership: { id: member.membershipId, role: member.role },
    capabilities: {
      view: true as const,
      manageMembers: admin,
      manageOwners: admin,
      manageResources: admin,
      manageChannels: admin,
    },
  };
  return {
    resolveOrganizationAccess: async () => value,
    resolveAccount: async () => ({
      session: { id: value.session.id, activeOrganizationId: ORGANIZATION_ID },
      account: value.account,
      isInstanceOperator: admin,
    }),
    rejectCookieMutation: () => undefined,
  };
}
