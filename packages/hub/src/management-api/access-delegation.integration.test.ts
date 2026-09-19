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
import type { NotificationEmail } from "../invitations/index.js";
import { AccessTicketService } from "../managed-access/tickets.js";
import { enrollTestDaemon, TEST_DAEMON_ID } from "../test-utils/project-configuration.js";
import { ManagementApi } from "./index.js";

const ORGANIZATION_ID = "org";
const OWNER = { userId: "owner", membershipId: "owner-membership", role: "owner" as const };
const LEAD = { userId: "lead", membershipId: "lead-membership", role: "member" as const };
const OTHER = { userId: "other", membershipId: "other-membership", role: "member" as const };
const codex = { providerId: "codex", modelIds: ["gpt-5.6-luna"], thinkingOptionIds: "*" };

const assignmentSchema = z.object({ id: z.string(), createdByUserId: z.string().nullable() });
const listSchema = z.object({
  assignments: z.array(
    z.object({ id: z.string(), resourceKind: z.string(), subjectId: z.string() }),
  ),
});
const catalogSchema = z.object({
  resources: z.array(z.object({ kind: z.string(), id: z.string() })),
});
const effectiveSchema = z.object({
  owner: z.boolean(),
  grants: z.array(
    z.object({ resource: z.object({ kind: z.string() }), privileges: z.array(z.string()) }),
  ),
});
const eventsSchema = z.object({
  events: z.array(
    z.object({
      kind: z.string(),
      resourceId: z.string(),
      subjectId: z.string(),
      actorUserId: z.string(),
    }),
  ),
});

let bundle: DatabaseRuntimeBundle;
let root: string;
let sent: NotificationEmail[];
let owner: ManagementApi;
let lead: ManagementApi;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hub-access-delegation-"));
  bundle = await embeddedDatabaseRuntime(root);
  await bundle.runtime.migrate();
  const db = bundle.runtime.drizzle();
  await db.insert(schema.organizations).values({ id: ORGANIZATION_ID, name: "Org", slug: "org" });
  await db.insert(schema.users).values(
    [OWNER, LEAD, OTHER].map(({ userId }) => ({
      id: userId,
      name: userId,
      email: `${userId}@example.test`,
      emailVerified: true,
    })),
  );
  await db.insert(schema.members).values(
    [OWNER, LEAD, OTHER].map(({ userId, membershipId, role }) => ({
      id: membershipId,
      organizationId: ORGANIZATION_ID,
      userId,
      role,
    })),
  );
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await enrollTestDaemon(database, ORGANIZATION_ID);
  await db.insert(schema.daemonProjects).values({
    organizationId: ORGANIZATION_ID,
    daemonId: TEST_DAEMON_ID,
    externalProjectId: "project-a",
    name: "Project A",
  });
  const access = new AccessStore(bundle.runtime);
  sent = [];
  const common = {
    database,
    runtime: bundle.runtime,
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: null,
    notificationMailer: {
      send: async (notification: NotificationEmail) => void sent.push(notification),
    },
  };
  owner = new ManagementApi({ ...common, auth: accessFor(OWNER) });
  lead = new ManagementApi({ ...common, auth: accessFor(LEAD) });
}, 30_000);

afterEach(async () => {
  await bundle.runtime.close();
  await rm(root, { recursive: true, force: true });
}, 30_000);

it("lets a Team Admin manage membership and appoint a Team Admin, and hides Team rows unless asked", async () => {
  const created = await owner.handle(request("/teams", "POST", { name: "QC" }));
  assert.equal(created.status, 201);
  const team = z.object({ id: z.string() }).parse(await created.json());
  const otherTeam = z
    .object({ id: z.string() })
    .parse(await (await owner.handle(request("/teams", "POST", { name: "Design" }))).json());

  // Before the appointment the lead is an ordinary Member: no membership authority, no catalog.
  assert.equal(
    (await lead.handle(request(`/teams/${team.id}/members`, "POST", { userId: OTHER.userId })))
      .status,
    403,
  );
  assert.equal((await lead.handle(request("/access-catalog", "GET"))).status, 403);
  assert.equal((await lead.handle(request("/access-assignments", "GET"))).status, 403);

  const appointed = await owner.handle(
    request("/access-assignments", "POST", teamAdmin(LEAD.membershipId, team.id)),
  );
  assert.equal(appointed.status, 201);

  // COMPAT(team-resource-kind): Team rows only with `?include=team`.
  const withoutTeam = catalogSchema.parse(
    await (await owner.handle(request("/access-catalog", "GET"))).json(),
  );
  assert.ok(!withoutTeam.resources.some(({ kind }) => kind === "team"));
  const withTeam = catalogSchema.parse(
    await (await owner.handle(request("/access-catalog?include=team", "GET"))).json(),
  );
  assert.ok(withTeam.resources.some(({ kind, id }) => kind === "team" && id === team.id));
  const hidden = listSchema.parse(
    await (await owner.handle(request("/access-assignments", "GET"))).json(),
  );
  assert.deepEqual(hidden.assignments, []);
  const shown = listSchema.parse(
    await (await owner.handle(request("/access-assignments?include=team", "GET"))).json(),
  );
  assert.equal(shown.assignments.length, 1);
  const ownEffective = effectiveSchema.parse(
    await (await lead.handle(request("/access-assignments/effective", "GET"))).json(),
  );
  assert.deepEqual(ownEffective.grants, []);
  const ownEffectiveWithTeam = effectiveSchema.parse(
    await (await lead.handle(request("/access-assignments/effective?include=team", "GET"))).json(),
  );
  assert.deepEqual(
    ownEffectiveWithTeam.grants.map(({ privileges }) => privileges),
    [["hub.access.manage"]],
  );

  // Team Admin: membership of that Team only.
  const added = await lead.handle(
    request(`/teams/${team.id}/members`, "POST", { userId: OTHER.userId }),
  );
  assert.equal(added.status, 201);
  assert.equal(
    (await lead.handle(request(`/teams/${otherTeam.id}/members`, "POST", { userId: OTHER.userId })))
      .status,
    403,
  );
  assert.equal(
    (await lead.handle(request(`/teams/${team.id}`, "PUT", { name: "QA" }))).status,
    403,
  );
  assert.equal((await lead.handle(request(`/teams/${team.id}`, "DELETE"))).status, 403);
  assert.equal((await lead.handle(request("/teams", "POST", { name: "Mine" }))).status, 403);
  // Appointing another Team Admin of the same Team is within what the lead holds.
  const second = await lead.handle(
    request("/access-assignments", "POST", teamAdmin(OTHER.membershipId, team.id)),
  );
  assert.equal(second.status, 201);
  assert.equal(assignmentSchema.parse(await second.json()).createdByUserId, LEAD.userId);
  // A Team grant reaches nothing else.
  const escalated = await lead.handle(
    request("/access-assignments", "POST", teamAdmin(OTHER.membershipId, otherTeam.id)),
  );
  assert.equal(escalated.status, 403);
  assert.equal(await problemCode(escalated), "access_exceeds_grantor");
  // The Team Admin's catalog is the Team it administers, and its listing the grants on it.
  const leadCatalog = catalogSchema.parse(
    await (await lead.handle(request("/access-catalog?include=team", "GET"))).json(),
  );
  assert.deepEqual(leadCatalog.resources, [{ kind: "team", id: team.id }]);
  const leadList = listSchema.parse(
    await (await lead.handle(request("/access-assignments?include=team", "GET"))).json(),
  );
  assert.equal(leadList.assignments.length, 2);
  assert.equal(
    (await lead.handle(request(`/teams/${team.id}/members/${OTHER.userId}`, "DELETE"))).status,
    204,
  );
});

it("lets Can share grant up to its own level on a Host, and tells Admins about Administrator", async () => {
  const shared = await owner.handle(
    request("/access-assignments", "POST", {
      subjectKind: "member",
      subjectId: LEAD.membershipId,
      resourceKind: "daemon",
      resourceId: TEST_DAEMON_ID,
      privileges: [...RESOURCE_ACCESS_LEVELS.daemon.developer, "hub.access.manage"],
      constraints: { agentConfigurations: [codex] },
    }),
  );
  assert.equal(shared.status, 201);
  const ownEffective = effectiveSchema.parse(
    await (await lead.handle(request("/access-assignments/effective", "GET"))).json(),
  );
  assert.ok(ownEffective.grants[0]?.privileges.includes("hub.access.manage"));

  // The catalog and listing show the lead only what they can share: the Host and its Projects.
  const catalog = catalogSchema.parse(
    await (await lead.handle(request("/access-catalog", "GET"))).json(),
  );
  assert.deepEqual(catalog.resources.map(({ kind }) => kind).sort(), ["daemon", "project"]);

  const withinLevel = await lead.handle(
    request(
      "/access-assignments",
      "POST",
      hostGrant(OTHER.membershipId, RESOURCE_ACCESS_LEVELS.daemon.office_worker),
    ),
  );
  assert.equal(withinLevel.status, 201);
  const granted = assignmentSchema.parse(await withinLevel.json());
  assert.equal(granted.createdByUserId, LEAD.userId);
  const aboveLevel = await lead.handle(
    request(
      "/access-assignments",
      "POST",
      hostGrant(OTHER.membershipId, RESOURCE_ACCESS_LEVELS.daemon.full_access),
    ),
  );
  assert.equal(aboveLevel.status, 403);
  assert.equal(await problemCode(aboveLevel), "access_exceeds_grantor");
  const widerModels = await lead.handle(
    request("/access-assignments", "POST", {
      ...hostGrant(OTHER.membershipId, RESOURCE_ACCESS_LEVELS.daemon.office_worker),
      constraints: { agentConfigurations: [{ ...codex, modelIds: "*" }] },
    }),
  );
  assert.equal(widerModels.status, 403);
  assert.equal(
    (await lead.handle(request(`/access-assignments/${granted.id}`, "DELETE"))).status,
    204,
  );

  // Administrator granted by the owner: event row, listed for admins, mailed to every admin.
  assert.equal((await lead.handle(request("/access-events", "GET"))).status, 403);
  const administrator = await owner.handle(
    request("/access-assignments", "POST", {
      ...hostGrant(OTHER.membershipId, RESOURCE_ACCESS_LEVELS.daemon.administrator),
      constraints: {},
    }),
  );
  assert.equal(administrator.status, 201);
  const events = eventsSchema.parse(
    await (await owner.handle(request("/access-events?limit=5", "GET"))).json(),
  );
  assert.deepEqual(events.events, [
    {
      kind: "administrator_granted",
      resourceId: TEST_DAEMON_ID,
      subjectId: OTHER.membershipId,
      actorUserId: OWNER.userId,
    },
  ]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.to, ["owner@example.test"]);
  assert.match(sent[0]?.text ?? "", /owner granted other Administrator/);
  assert.ok(
    sent[0]?.text.includes(
      `https://hub.example.test/settings/hub/access?resourceKind=daemon&resourceId=${TEST_DAEMON_ID}&subjectKind=member&subjectId=${OTHER.membershipId}`,
    ),
  );
  // The lead cannot remove a grant above their level; it shows locked.
  const locked = listSchema.parse(
    await (await owner.handle(request("/access-assignments", "GET"))).json(),
  );
  const administratorRow = locked.assignments.find(
    ({ subjectId }) => subjectId === OTHER.membershipId,
  );
  assert.ok(administratorRow !== undefined);
  const removal = await lead.handle(
    request(`/access-assignments/${administratorRow.id}`, "DELETE"),
  );
  assert.equal(removal.status, 403);
  assert.equal(await problemCode(removal), "access_exceeds_grantor");
  // Another Member's effective access is for Organization Admins and the Member themselves.
  const otherEffective = await owner.handle(
    request(`/members/${OTHER.membershipId}/effective`, "GET"),
  );
  assert.equal(otherEffective.status, 200);
  assert.ok(
    effectiveSchema
      .parse(await otherEffective.json())
      .grants.some(({ privileges }) => privileges.includes("hub.access.manage")),
  );
  assert.equal(
    (await lead.handle(request(`/members/${OTHER.membershipId}/effective`, "GET"))).status,
    403,
  );
  assert.equal(
    (await lead.handle(request(`/members/${LEAD.membershipId}/effective`, "GET"))).status,
    200,
  );
});

it("lets a Project sharer write the Connect row a Project grant needs, never replacing a wider Host row", async () => {
  const catalog = catalogSchema.parse(
    await (await owner.handle(request("/access-catalog", "GET"))).json(),
  );
  const projectId = catalog.resources.find(({ kind }) => kind === "project")?.id;
  assert.ok(projectId !== undefined);
  const projectGrant = (subjectId: string, privileges: readonly string[]) => ({
    subjectKind: "member",
    subjectId,
    resourceKind: "project",
    resourceId: projectId,
    privileges: [...privileges],
    constraints: { agentConfigurations: [codex] },
  });
  const connect = {
    subjectKind: "member",
    subjectId: OTHER.membershipId,
    resourceKind: "daemon",
    resourceId: TEST_DAEMON_ID,
    privileges: ["daemon.connect"],
    constraints: {},
  };
  assert.equal(
    (
      await owner.handle(
        request(
          "/access-assignments",
          "POST",
          projectGrant(LEAD.membershipId, [
            ...RESOURCE_ACCESS_LEVELS.project.developer,
            "hub.access.manage",
          ]),
        ),
      )
    ).status,
    201,
  );
  const office = projectGrant(OTHER.membershipId, RESOURCE_ACCESS_LEVELS.project.office_worker);
  const first = await lead.handle(
    request("/access-assignments/batch", "POST", { assignments: [connect, office] }),
  );
  assert.equal(first.status, 201);
  assert.deepEqual(await hostPrivileges(OTHER.membershipId), ["daemon.connect"]);

  // Once an Owner widens the Host row, the same Project grant leaves it alone.
  await owner.handle(
    request(
      "/access-assignments",
      "POST",
      hostGrant(OTHER.membershipId, RESOURCE_ACCESS_LEVELS.daemon.developer),
    ),
  );
  const again = await lead.handle(
    request("/access-assignments/batch", "POST", { assignments: [connect, office] }),
  );
  assert.equal(again.status, 201);
  assert.deepEqual(await hostPrivileges(OTHER.membershipId), [
    ...RESOURCE_ACCESS_LEVELS.daemon.developer,
  ]);
  // Sent alone it is no Project grant's companion: replacing the wider row is refused.
  const alone = await lead.handle(
    request("/access-assignments", "POST", hostGrant(OTHER.membershipId, ["daemon.connect"])),
  );
  assert.equal(alone.status, 403);
});

async function hostPrivileges(subjectId: string): Promise<string[] | undefined> {
  const listed = z
    .object({
      assignments: z.array(
        z.object({
          resourceKind: z.string(),
          subjectId: z.string(),
          privileges: z.array(z.string()),
        }),
      ),
    })
    .parse(await (await owner.handle(request("/access-assignments", "GET"))).json());
  return listed.assignments.find(
    (row) => row.resourceKind === "daemon" && row.subjectId === subjectId,
  )?.privileges;
}

async function problemCode(response: Response): Promise<string> {
  return z.object({ error: z.string() }).parse(await response.json()).error;
}

function teamAdmin(subjectId: string, teamId: string) {
  return {
    subjectKind: "member",
    subjectId,
    resourceKind: "team",
    resourceId: teamId,
    privileges: [...RESOURCE_ACCESS_LEVELS.team.admin],
    constraints: {},
  };
}

function hostGrant(subjectId: string, privileges: readonly string[]) {
  return {
    subjectKind: "member",
    subjectId,
    resourceKind: "daemon",
    resourceId: TEST_DAEMON_ID,
    privileges: [...privileges],
    constraints: { agentConfigurations: [codex] },
  };
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
