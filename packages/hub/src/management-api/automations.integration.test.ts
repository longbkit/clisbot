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
import type { Database } from "../db/types.js";
import type { NotificationEmail } from "../invitations/index.js";
import { AccessTicketService } from "../managed-access/tickets.js";
import { enrollTestDaemon, TEST_DAEMON_ID } from "../test-utils/project-configuration.js";
import { composeAutomationAuthorAccessCheck } from "../triggers/author-access.js";
import { ManagementApi } from "./index.js";

const ORGANIZATION_ID = "org";
const OWNER = { userId: "owner", membershipId: "owner-membership", role: "owner" as const };
const LEAD = { userId: "lead", membershipId: "lead-membership", role: "member" as const };
const OTHER = { userId: "other", membershipId: "other-membership", role: "member" as const };
const codex = { providerId: "codex", modelIds: ["gpt-5.6-luna"], thinkingOptionIds: "*" };

const automationSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  scope: z.enum(["admin", "run"]),
  pausedReason: z.string().nullable(),
  author: z.object({ userId: z.string(), name: z.string() }).nullable(),
  target: z.object({ daemonName: z.string().nullable(), projectName: z.string().nullable() }),
  activeRevisionId: z.string(),
});
const listSchema = z.object({ automations: z.array(automationSchema) });
const assignmentsSchema = z.object({
  assignments: z.array(
    z.object({
      id: z.string(),
      resourceKind: z.string(),
      subjectId: z.string(),
      privileges: z.array(z.string()),
    }),
  ),
});
const eventsSchema = z.object({
  events: z.array(z.object({ kind: z.string(), resourceId: z.string(), subjectId: z.string() })),
});

let bundle: DatabaseRuntimeBundle;
let root: string;
let database: Database;
let access: AccessStore;
let sent: NotificationEmail[];
let owner: ManagementApi;
let lead: ManagementApi;
let other: ManagementApi;
let projectRowId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hub-automations-"));
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
  database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await enrollTestDaemon(database, ORGANIZATION_ID);
  const [project] = await db
    .insert(schema.daemonProjects)
    .values([
      {
        organizationId: ORGANIZATION_ID,
        daemonId: TEST_DAEMON_ID,
        externalProjectId: "project-a",
        name: "Project A",
      },
      {
        organizationId: ORGANIZATION_ID,
        daemonId: TEST_DAEMON_ID,
        externalProjectId: "project-b",
        name: "Project B",
      },
    ])
    .returning({ id: schema.daemonProjects.id });
  projectRowId = project!.id;
  access = new AccessStore(bundle.runtime);
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
  other = new ManagementApi({ ...common, auth: accessFor(OTHER) });
}, 30_000);

afterEach(async () => {
  await bundle.runtime.close();
  await rm(root, { recursive: true, force: true });
}, 30_000);

it("lets a Member with Project access create an Automation there, and makes them its Admin", async () => {
  // Without any Project access, authoring is refused before the body is read.
  assert.equal((await lead.handle(request("/automations", "POST", body("handoff")))).status, 403);
  assert.equal(
    (await lead.handle(request("/automations/validate", "POST", { yaml: yaml("handoff") }))).status,
    403,
  );
  await grantProject(LEAD.membershipId);

  const created = await lead.handle(request("/automations", "POST", body("handoff")));
  assert.equal(created.status, 201);
  const automation = automationSchema.parse(await created.json());
  assert.equal(automation.scope, "admin");
  assert.deepEqual(automation.author, { userId: LEAD.userId, name: LEAD.userId });
  assert.deepEqual(automation.target, { daemonName: "daemon-10000000", projectName: "Project A" });
  assert.equal(automation.pausedReason, null);

  // The creator's Admin grant is an ordinary assignment, made by the creator.
  const assignments = assignmentsSchema.parse(
    await (await owner.handle(request("/access-assignments", "GET"))).json(),
  );
  const adminRow = assignments.assignments.find(
    ({ resourceKind }) => resourceKind === "automation",
  );
  assert.deepEqual(adminRow?.privileges, [...RESOURCE_ACCESS_LEVELS.automation.admin]);
  assert.equal(adminRow?.subjectId, LEAD.membershipId);

  // A target outside the Member's grants is the delegation rule's refusal.
  const foreign = await lead.handle(request("/automations", "POST", body("foreign", "project-b")));
  assert.equal(foreign.status, 403);
  assert.equal(await problemCode(foreign), "access_denied");
  // Connection inputs and secrets stay with Organization Admins.
  const webhook = await lead.handle(
    request("/automations/validate", "POST", {
      yaml: yaml("webhook").replace(
        "manual.run: {}",
        "github.issue_comment: { connection: hub, filters: { from_users: ['*'] } }",
      ),
    }),
  );
  assert.equal(webhook.status, 422);
  assert.equal(await problemCode(webhook), "automation_input_requires_admin");
  const secret = await lead.handle(
    request("/automations", "POST", body("secret", "project-a", "  env: { TOKEN: secret }")),
  );
  assert.equal(secret.status, 422);
  assert.equal(await problemCode(secret), "automation_secret_requires_admin");
  const adminSecret = await owner.handle(
    request("/automations", "POST", body("admin-secret", "project-a", "  env: { TOKEN: secret }")),
  );
  assert.equal(adminSecret.status, 201);

  // Listing: Organization Admins see everything; a Member sees their grants, with the scope.
  const ownerList = listSchema.parse(
    await (await owner.handle(request("/automations", "GET"))).json(),
  );
  assert.deepEqual(
    ownerList.automations.map(({ scope }) => scope),
    ["admin", "admin"],
  );
  const leadList = listSchema.parse(
    await (await lead.handle(request("/automations", "GET"))).json(),
  );
  assert.deepEqual(
    leadList.automations.map(({ id, scope }) => ({ id, scope })),
    [{ id: automation.id, scope: "admin" }],
  );
  assert.deepEqual(await (await other.handle(request("/automations", "GET"))).json(), {
    automations: [],
  });
  assert.equal((await other.handle(request(`/automations/${automation.id}`, "GET"))).status, 403);

  // Run: reads the Automation and its results, but not its revisions, and cannot edit it.
  const runGrant = await owner.handle(
    request("/access-assignments", "POST", {
      subjectKind: "member",
      subjectId: OTHER.membershipId,
      resourceKind: "automation",
      resourceId: automation.id,
      privileges: [...RESOURCE_ACCESS_LEVELS.automation.run],
      constraints: {},
    }),
  );
  assert.equal(runGrant.status, 201);
  const otherList = listSchema.parse(
    await (await other.handle(request("/automations", "GET"))).json(),
  );
  assert.deepEqual(
    otherList.automations.map(({ scope }) => scope),
    ["run"],
  );
  assert.equal((await other.handle(request(`/automations/${automation.id}`, "GET"))).status, 200);
  assert.equal(
    (await other.handle(request(`/automations/${automation.id}/activity`, "GET"))).status,
    200,
  );
  assert.equal(
    (await other.handle(request(`/automations/${automation.id}/revisions`, "GET"))).status,
    403,
  );
  assert.equal(
    (
      await other.handle(
        request(
          `/automations/${automation.id}`,
          "PUT",
          body("handoff", "project-a", "", automation.activeRevisionId),
        ),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await lead.handle(
        request(
          `/automations/${automation.id}`,
          "PUT",
          body("handoff", "project-a", "", automation.activeRevisionId),
        ),
      )
    ).status,
    200,
  );
}, 60_000);

it("pauses an Automation whose author lost access, tells its Admins, and lets a saved revision lift it", async () => {
  const grant = await grantProject(LEAD.membershipId);
  const automation = automationSchema.parse(
    await (await lead.handle(request("/automations", "POST", body("handoff")))).json(),
  );
  const check = composeAutomationAuthorAccessCheck({
    database,
    runtime: bundle.runtime,
    access,
    mailer: { send: async (notification) => void sent.push(notification) },
  });
  const input = {
    organizationId: ORGANIZATION_ID,
    workflowId: automation.id,
    configurationRevisionId: automation.activeRevisionId,
  };
  assert.deepEqual(await check(input), { allowed: true });

  assert.equal((await owner.handle(request(`/access-assignments/${grant}`, "DELETE"))).status, 204);
  const refused = await check(input);
  assert.equal(refused.allowed, false);
  const paused = listSchema
    .parse(await (await owner.handle(request("/automations", "GET"))).json())
    .automations.find(({ id }) => id === automation.id);
  assert.equal(paused?.enabled, false);
  assert.match(paused?.pausedReason ?? "", /lost access/);
  const events = eventsSchema.parse(
    await (await owner.handle(request("/access-events", "GET"))).json(),
  );
  assert.deepEqual(events.events, [
    { kind: "automation_paused", resourceId: automation.id, subjectId: LEAD.membershipId },
  ]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.to, [`${LEAD.userId}@example.test`]);
  assert.match(sent[0]?.subject ?? "", /is paused/);
  // A second loss on the same pause sends nothing more.
  assert.equal((await check(input)).allowed, false);
  assert.equal(sent.length, 1);

  // Re-enabling is a save: it fails while the author still lacks access, and lifts the pause once they have it.
  const stillLost = await lead.handle(
    request(
      `/automations/${automation.id}`,
      "PUT",
      body("handoff", "project-a", "", automation.activeRevisionId),
    ),
  );
  assert.equal(stillLost.status, 403);
  await grantProject(LEAD.membershipId);
  const restored = await lead.handle(
    request(
      `/automations/${automation.id}`,
      "PUT",
      body("handoff", "project-a", "", automation.activeRevisionId),
    ),
  );
  assert.equal(restored.status, 200);
  const view = automationSchema.parse(await restored.json());
  assert.equal(view.enabled, true);
  assert.equal(view.pausedReason, null);
  assert.deepEqual(await check({ ...input, configurationRevisionId: view.activeRevisionId }), {
    allowed: true,
  });
}, 60_000);

/** Host connect plus Developer on Project A: work access to one Project, none to Project B. */
async function grantProject(membershipId: string): Promise<string> {
  const connect = await owner.handle(
    request("/access-assignments", "POST", {
      subjectKind: "member",
      subjectId: membershipId,
      resourceKind: "daemon",
      resourceId: TEST_DAEMON_ID,
      privileges: [...RESOURCE_ACCESS_LEVELS.daemon.connect],
      constraints: {},
    }),
  );
  assert.equal(connect.status, 201);
  const project = await owner.handle(
    request("/access-assignments", "POST", {
      subjectKind: "member",
      subjectId: membershipId,
      resourceKind: "project",
      resourceId: projectRowId,
      privileges: [...RESOURCE_ACCESS_LEVELS.project.developer],
      constraints: { agentConfigurations: [codex] },
    }),
  );
  assert.equal(project.status, 201);
  return z.object({ id: z.string() }).parse(await project.json()).id;
}

function yaml(name: string, projectId = "project-a", extra = ""): string {
  return [
    `name: ${name}`,
    "enabled: true",
    "on:",
    "  manual.run: {}",
    "run:",
    `  target: { daemon: daemon-10000000, projectId: ${projectId}, cwd: /workspace/app }`,
    "  agent: { provider: codex, model: gpt-5.6-luna, mode: default }",
    "  prompt: hand off",
    "  max_runtime: 1h",
    "  idle_timeout: 5m",
    ...(extra === "" ? [] : [extra]),
  ].join("\n");
}

function body(
  name: string,
  projectId = "project-a",
  extra = "",
  expectedRevisionId: string | null = null,
) {
  return { expectedRevisionId, yaml: yaml(name, projectId, extra) };
}

async function problemCode(response: Response): Promise<string> {
  return z.object({ error: z.string() }).parse(await response.json()).error;
}

function request(path: string, method: string, payload?: unknown): Request {
  return new Request(
    `https://hub.example.test/api/management/v1/organizations/${ORGANIZATION_ID}${path}`,
    {
      method,
      ...(payload === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
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
