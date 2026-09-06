import { dump } from "js-yaml";
import { compileTriggerDocument } from "../triggers/configuration/index.js";
import { editableAutomationYaml } from "../triggers/configuration/workflow-document.js";
import { CHANNEL_TEST_MESSAGE } from "../channels/test-message.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, it } from "vitest";
import { replaceDaemonProjects } from "../access/daemon-projects.js";
import { replaceDaemonConnectionOffer } from "../daemons/registration.js";
import { AccessStore } from "../access/store.js";
import type { BrowserOrganizationAccess } from "../auth/browser-organization-access.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { createDatabase } from "../db/pg.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import { AccessTicketService } from "../managed-access/tickets.js";
import type { ChannelSupervisor } from "../channels/supervisor/types.js";
import type {
  ProviderApplicationConfiguration,
  ProviderApplications,
} from "../provider-applications/index.js";
import { enrollTestDaemon, TEST_DAEMON_ID } from "../test-utils/project-configuration.js";
import { ManagementApi } from "./index.js";
import { createHubApplication } from "../app.js";
import { OrganizationTriggerStore } from "../triggers/store.js";
import type {
  DispatchManualRunAuthorization,
  DispatchManualRunInput,
} from "../public-operations/index.js";

const ORGANIZATION_ID = "org";
const USER_ID = "owner";
const MEMBERSHIP_ID = "owner-membership";

let bundle: DatabaseRuntimeBundle;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hub-management-api-"));
  bundle = await embeddedDatabaseRuntime(root);
  await bundle.runtime.migrate();
}, 30_000);

afterEach(async () => {
  await bundle.runtime.close();
  await rm(root, { recursive: true, force: true });
}, 30_000);

it("keeps organization-wide Channel activity behind management authority and validates page requests", async () => {
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  const access = new AccessStore(bundle.runtime);
  const common = {
    database,
    runtime: bundle.runtime,
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: null,
  };
  const owner = new ManagementApi({ ...common, auth: ownerAccess() });
  const member = new ManagementApi({ ...common, auth: memberAccess() });
  assert.equal((await member.handle(request("/channel-activity", "GET"))).status, 403);
  const result = await owner.handle(request("/channel-activity?limit=25", "GET"));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { activity: [], nextCursor: null });
  assert.equal((await owner.handle(request("/channel-activity?limit=1000", "GET"))).status, 400);
  assert.equal((await owner.handle(request("/channel-activity?cursor=bad", "GET"))).status, 400);
  const otherOrganization = new Request(
    "https://hub.example.test/api/management/v1/organizations/other/channel-activity",
  );
  assert.equal((await owner.handle(otherOrganization)).status, 404);
});

it("renames shared Hosts through canonical Hub authority, normalization, and conflict handling", async () => {
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await bundle.runtime
    .drizzle()
    .insert(schema.organizations)
    .values({ id: ORGANIZATION_ID, name: "Org", slug: "org" });
  await bundle.runtime
    .drizzle()
    .insert(schema.users)
    .values([
      { id: USER_ID, name: "Owner", email: "owner@example.test", emailVerified: true },
      { id: "member-user", name: "Member", email: "member@example.test", emailVerified: true },
    ]);
  await bundle.runtime
    .drizzle()
    .insert(schema.members)
    .values([
      { id: MEMBERSHIP_ID, organizationId: ORGANIZATION_ID, userId: USER_ID, role: "owner" },
      {
        id: "member-membership",
        organizationId: ORGANIZATION_ID,
        userId: "member-user",
        role: "member",
      },
    ]);
  await enrollTestDaemon(database, ORGANIZATION_ID);
  const access = new AccessStore(bundle.runtime);
  const tickets = new AccessTicketService(bundle.runtime, access);
  const application = createHubApplication({
    database,
    databaseRuntime: bundle.runtime,
    accessStore: access,
    accessTickets: tickets,
    entitlements: null,
    publicApi: { status: "unavailable" },
    browserOrganizationAccess: ownerAccess(),
  });
  const common = {
    database,
    runtime: bundle.runtime,
    access,
    tickets,
    channelSupervisor: null,
    renameDaemon: application.operations.handleOrganizationDaemonRename,
  };
  const api = new ManagementApi({ ...common, auth: ownerAccess() });
  const member = new ManagementApi({ ...common, auth: memberAccess() });
  const grant = await api.handle(
    request("/access-assignments/batch", "POST", {
      assignments: [
        {
          subjectKind: "member",
          subjectId: "member-membership",
          resourceKind: "daemon",
          resourceId: TEST_DAEMON_ID,
          privileges: ["daemon.connect", "daemon.manage"],
          constraints: {},
        },
      ],
    }),
  );
  assert.equal(grant.status, 201);
  assert.equal(
    (await member.handle(request(`/daemons/${TEST_DAEMON_ID}`, "PUT", { slug: "member-name" })))
      .status,
    403,
  );
  const csrf = new ManagementApi({
    ...common,
    auth: { ...ownerAccess(), rejectCookieMutation: () => new Response(null, { status: 403 }) },
  });
  assert.equal(
    (await csrf.handle(request(`/daemons/${TEST_DAEMON_ID}`, "PUT", { slug: "blocked" }))).status,
    403,
  );
  for (const slug of ["", " ", "a".repeat(101)]) {
    assert.equal(
      (await api.handle(request(`/daemons/${TEST_DAEMON_ID}`, "PUT", { slug }))).status,
      400,
    );
  }
  assert.equal(
    (await api.handle(request("/daemons/not-a-uuid", "PUT", { slug: "unknown" }))).status,
    404,
  );
  assert.equal(
    (
      await api.handle(
        request("/daemons/20000000-0000-4000-8000-000000000001", "PUT", { slug: "unknown" }),
      )
    ).status,
    404,
  );
  const original = await database.findDaemonById(TEST_DAEMON_ID);
  const renamed = await api.handle(
    request(`/daemons/${TEST_DAEMON_ID}`, "PUT", { slug: "  Công Việc Studio  " }),
  );
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).slug, "cong-viec-studio");
  const stored = await database.findDaemonById(TEST_DAEMON_ID);
  assert.equal(stored?.slug, "cong-viec-studio");
  assert.equal(stored?.id, original?.id);
  assert.deepEqual(stored?.permissions, original?.permissions);
  assert.equal(stored?.serverId, original?.serverId);
  await database.issueEnrollmentToken({
    id: "30000000-0000-4000-8000-000000000003",
    verifier: "second-verifier",
    organizationId: ORGANIZATION_ID,
    expiresAt: new Date("2026-08-06T12:00:00Z"),
    consumedAt: null,
  });
  const secondId = "20000000-0000-4000-8000-000000000002";
  await database.enrollDaemon({
    tokenVerifier: "second-verifier",
    daemonId: secondId,
    idempotencyKey: "second",
    serverId: "server-2",
    daemonPublicKey: "public-2",
    credentialVerifier: "credential-2",
    permissions: ["hub.execute"],
    now: new Date("2026-08-06T11:00:00Z"),
  });
  const conflict = await api.handle(
    request(`/daemons/${secondId}`, "PUT", { slug: "Công Việc Studio" }),
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, "daemon_slug_conflict");
  assert.notEqual((await database.findDaemonById(secondId))?.slug, "cong-viec-studio");
  const listing = await api.handle(request("/daemons", "GET"));
  assert.equal(
    (await listing.json()).daemons.find((row: { id: string }) => row.id === TEST_DAEMON_ID).slug,
    "cong-viec-studio",
  );
  await application.hub.stop();
});

it("disconnects a managed Host through canonical authorization before revoking its leases", async () => {
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await bundle.runtime
    .drizzle()
    .insert(schema.organizations)
    .values({ id: ORGANIZATION_ID, name: "Org", slug: "org" });
  await bundle.runtime
    .drizzle()
    .insert(schema.users)
    .values({ id: USER_ID, name: "Owner", email: "owner@example.test", emailVerified: true });
  await bundle.runtime
    .drizzle()
    .insert(schema.members)
    .values({ id: MEMBERSHIP_ID, organizationId: ORGANIZATION_ID, userId: USER_ID, role: "owner" });
  await enrollTestDaemon(database, ORGANIZATION_ID);
  const access = new AccessStore(bundle.runtime);
  const calls: string[] = [];
  class ObservedAccessTickets extends AccessTicketService {
    override async revokeDaemonLeases(organizationId: string, daemonId: string, now?: Date) {
      assert.equal((await database.findDaemonById(daemonId))?.status, "revoked");
      calls.push("revoked daemon lease sweep");
      return super.revokeDaemonLeases(organizationId, daemonId, now);
    }
  }
  const tickets = new ObservedAccessTickets(bundle.runtime, access);
  const issued = await tickets.issue({
    organizationId: ORGANIZATION_ID,
    daemonId: TEST_DAEMON_ID,
    userId: USER_ID,
    membershipId: MEMBERSHIP_ID,
    clientId: "client-a",
  });
  const admission = await tickets.consume({
    daemonId: TEST_DAEMON_ID,
    accessTicket: issued.accessTicket,
    clientId: "client-a",
  });
  const outstanding = await tickets.issue({
    organizationId: ORGANIZATION_ID,
    daemonId: TEST_DAEMON_ID,
    userId: USER_ID,
    membershipId: MEMBERSHIP_ID,
    clientId: "not-consumed",
  });
  const application = createHubApplication({
    database,
    databaseRuntime: bundle.runtime,
    accessStore: access,
    accessTickets: tickets,
    entitlements: null,
    publicApi: { status: "unavailable" },
    browserOrganizationAccess: ownerAccess(),
  });
  const common = {
    database,
    runtime: bundle.runtime,
    access,
    tickets,
    channelSupervisor: null,
    revokeDaemon: application.operations.handleOrganizationDaemonRevocation,
  };
  const ownerApi = new ManagementApi({ ...common, auth: ownerAccess() });
  const memberApi = new ManagementApi({ ...common, auth: memberAccess() });
  assert.equal(
    (await memberApi.handle(request(`/daemons/${TEST_DAEMON_ID}`, "DELETE"))).status,
    403,
  );
  assert.equal(
    (await ownerApi.handle(request("/daemons/other-organization-host", "DELETE"))).status,
    404,
  );
  const csrfApi = new ManagementApi({
    ...common,
    auth: { ...ownerAccess(), rejectCookieMutation: () => new Response(null, { status: 403 }) },
  });
  assert.equal((await csrfApi.handle(request(`/daemons/${TEST_DAEMON_ID}`, "DELETE"))).status, 403);
  assert.deepEqual(calls, []);
  assert.equal(
    (await ownerApi.handle(request(`/daemons/${TEST_DAEMON_ID}`, "DELETE"))).status,
    204,
  );
  assert.deepEqual(calls, ["revoked daemon lease sweep"]);
  const stored = await bundle.runtime.query<{ revoked_at: Date | null }>(
    "select revoked_at from daemon_access_leases where id = $1",
    [admission.leaseId],
  );
  assert.notEqual(stored.rows[0]?.revoked_at, null);
  await assert.rejects(
    tickets.consume({
      daemonId: TEST_DAEMON_ID,
      accessTicket: outstanding.accessTicket,
      clientId: "not-consumed",
    }),
    /daemon access is no longer granted/,
  );
  await assert.rejects(
    tickets.refresh({ daemonId: TEST_DAEMON_ID, leaseId: admission.leaseId }),
    /lease/,
  );
  await assert.rejects(
    tickets.issue({
      organizationId: ORGANIZATION_ID,
      daemonId: TEST_DAEMON_ID,
      userId: USER_ID,
      membershipId: MEMBERSHIP_ID,
      clientId: "new",
    }),
    /daemon access is not granted/,
  );
  assert.equal((await database.findDaemonById(TEST_DAEMON_ID))?.status, "revoked");
  assert.deepEqual(await (await ownerApi.handle(request("/daemons", "GET"))).json(), {
    daemons: [],
  });
  await application.hub.stop();
});

it("runs an Automation through the shared dispatcher with current Member access", async () => {
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await bundle.runtime.drizzle().insert(schema.organizations).values({
    id: ORGANIZATION_ID,
    name: "Org",
    slug: "org",
  });
  await bundle.runtime
    .drizzle()
    .insert(schema.users)
    .values([
      {
        id: USER_ID,
        name: "Owner",
        email: "owner@example.test",
        emailVerified: true,
      },
      {
        id: "member-user",
        name: "Member",
        email: "member@example.test",
        emailVerified: true,
      },
    ]);
  await bundle.runtime
    .drizzle()
    .insert(schema.members)
    .values([
      {
        id: MEMBERSHIP_ID,
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        role: "owner",
      },
      {
        id: "member-membership",
        organizationId: ORGANIZATION_ID,
        userId: "member-user",
        role: "member",
      },
    ]);
  await enrollTestDaemon(database, ORGANIZATION_ID);
  const automation = await new OrganizationTriggerStore(database, ORGANIZATION_ID).save({
    yaml: [
      "name: handoff",
      "enabled: true",
      "on:",
      "  manual.run: {}",
      "inputs:",
      "  urgency: { type: string, required: true, choices: [normal, urgent] }",
      "run:",
      "  target: { daemon: daemon-10000000, cwd: /workspace/app }",
      "  agent: { provider: codex, mode: default }",
      "  prompt: ${{ paseo.prompt }}",
      "  max_runtime: 1h",
      "  idle_timeout: 5m",
    ].join("\n"),
    userId: USER_ID,
  });
  const calls: Array<{
    authorization: DispatchManualRunAuthorization;
    input: DispatchManualRunInput;
  }> = [];
  const manualRuns = {
    dispatchManualRun: async (
      authorization: DispatchManualRunAuthorization,
      input: DispatchManualRunInput,
    ) => {
      calls.push({ authorization, input });
      return {
        status: "dispatched" as const,
        deliveryKey: input.deliveryKey,
        providerEventReceiptId: "11111111-1111-4111-8111-111111111111",
        triggerRunId: "22222222-2222-4222-8222-222222222222",
        configuredTriggerName: input.trigger,
        workflowStatus: "running" as const,
      };
    },
  };
  const access = new AccessStore(bundle.runtime);
  const common = {
    database,
    runtime: bundle.runtime,
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: null,
    manualRuns,
  };
  const memberApi = new ManagementApi({ ...common, auth: memberAccess() });
  const path = `/automations/${automation.id}/runs`;

  const hidden = await memberApi.handle(
    request(path, "POST", {
      prompt: "Please triage this",
      inputs: { urgency: "urgent" },
    }),
  );
  assert.equal(hidden.status, 404);
  assert.equal(calls.length, 0);
  assert.deepEqual(await (await memberApi.handle(request("/automations/runnable", "GET"))).json(), {
    automations: [],
  });

  await access.saveAssignment(
    ORGANIZATION_ID,
    {
      subjectKind: "member",
      subjectId: "member-membership",
      resourceKind: "automation",
      resourceId: automation.id,
      privileges: ["automation.run"],
      constraints: {},
    },
    USER_ID,
  );
  assert.deepEqual(await (await memberApi.handle(request("/automations/runnable", "GET"))).json(), {
    automations: [
      {
        id: automation.id,
        name: "handoff",
        description: null,
        inputs: {
          urgency: {
            type: "string",
            required: true,
            choices: ["normal", "urgent"],
          },
        },
      },
    ],
  });
  const malformed = await memberApi.handle(
    request(path, "POST", {
      prompt: "Please triage this",
      inputs: { urgency: "urgent" },
      daemonId: TEST_DAEMON_ID,
    }),
  );
  assert.equal(malformed.status, 400);
  assert.equal(calls.length, 0);

  const response = await memberApi.handle(
    request(path, "POST", {
      prompt: "Please triage this",
      inputs: { urgency: "urgent" },
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "dispatched");
  assert.deepEqual(calls[0]?.authorization, {
    kind: "member",
    membershipId: "member-membership",
    organizationId: ORGANIZATION_ID,
  });
  assert.equal(calls[0]?.input.trigger, "handoff");
  assert.equal(calls[0]?.input.actor, "member-user");
  assert.equal(calls[0]?.input.expectedVersionId, automation.activeRevisionId);
  assert.deepEqual(calls[0]?.input.input, {
    prompt: "Please triage this",
    inputs: { urgency: "urgent" },
  });

  const ownerApi = new ManagementApi({ ...common, auth: ownerAccess() });
  assert.equal(
    (await (await ownerApi.handle(request("/automations/runnable", "GET"))).json()).automations
      .length,
    1,
  );
  assert.equal(
    (
      await ownerApi.handle(
        request(path, "POST", {
          prompt: "Owner run",
          inputs: { urgency: "normal" },
        }),
      )
    ).status,
    200,
  );
  assert.equal(calls.length, 2);
});

it("preserves a safe Automation revision when an open-audience Channel backlink would become unsafe", async () => {
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await bundle.runtime.drizzle().insert(schema.organizations).values({
    id: ORGANIZATION_ID,
    name: "Org",
    slug: "org",
  });
  await bundle.runtime.drizzle().insert(schema.users).values({
    id: USER_ID,
    name: "Owner",
    email: "owner@example.test",
    emailVerified: true,
  });
  await bundle.runtime.drizzle().insert(schema.members).values({
    id: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "owner",
  });
  await enrollTestDaemon(database, ORGANIZATION_ID);
  const store = new OrganizationTriggerStore(database, ORGANIZATION_ID);
  const safeYaml = automationYaml("auto-review");
  const automation = await store.save({ yaml: safeYaml, userId: USER_ID });
  await database.saveChannelConfiguration({
    organizationId: ORGANIZATION_ID,
    files: [
      {
        path: ".paseo/channels/slack/public.yml",
        content: `
channel: slack
accountId: public
connectionId: slack:public
transport: { mode: socket }
routes:
  - match: { kind: channel, ids: [C_CUSTOMER] }
    audience: { kind: conversationParticipants }
    workflow: public-handoff
    sync:
      finalAnswers: true
      progress: { progressMessage: false, typingIndicator: false, messageReaction: off }
      toolCalls: false
      threadLink: none
      subagents: { finalAnswers: false, progress: false, toolCalls: false }
    approval: [{ match: "*", mode: auto-deny }]
`,
      },
    ],
    contentHash: "public-channel",
    createdByUserId: USER_ID,
  });
  let reconciliations = 0;
  const access = new AccessStore(bundle.runtime);
  const api = new ManagementApi({
    database,
    runtime: bundle.runtime,
    auth: ownerAccess(),
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: {
      reconcile: async () => {
        reconciliations += 1;
        return { accounts: [], stopped: [] };
      },
    } as unknown as ChannelSupervisor,
  });
  const path = `/automations/${automation.id}`;

  const rejected = await api.handle(
    request(path, "PUT", {
      expectedRevisionId: automation.activeRevisionId,
      yaml: automationYaml("full-access"),
    }),
  );
  assert.equal(rejected.status, 422, JSON.stringify(await rejected.clone().json()));
  assert.equal((await rejected.json()).error, "invalid_automation");
  assert.equal(
    (await store.list()).find(({ id }) => id === automation.id)?.activeRevisionId,
    automation.activeRevisionId,
  );
  assert.equal(reconciliations, 0);

  const compiled = compileTriggerDocument(safeYaml);
  const firstStep = compiled.events[0]!.steps[0]!;
  const workflowYaml = (mode: string) =>
    editableAutomationYaml(
      dump({
        legacy_multistep: {
          environments: [compiled.environment],
          trigger: {
            ...compiled.events[0],
            steps: [firstStep, { ...firstStep, id: "respond", agent: { provider: "codex", mode } }],
          },
        },
      }),
      true,
    );
  const unsafeWorkflow = await api.handle(
    request(path, "PUT", {
      expectedRevisionId: automation.activeRevisionId,
      yaml: workflowYaml("full-access"),
    }),
  );
  assert.equal(unsafeWorkflow.status, 422, JSON.stringify(await unsafeWorkflow.clone().json()));
  assert.equal((await store.activeRevision(automation)).version, 1);

  const updated = await api.handle(
    request(path, "PUT", {
      expectedRevisionId: automation.activeRevisionId,
      yaml: workflowYaml("auto"),
    }),
  );
  assert.equal(updated.status, 200, JSON.stringify(await updated.clone().json()));
  const savedWorkflow = await updated.json();
  assert.equal(savedWorkflow.format, "workflow");
  assert.equal(savedWorkflow.definition.steps.length, 2);
  const reloaded = await api.handle(request(path, "GET"));
  assert.equal((await reloaded.json()).yaml, savedWorkflow.yaml);
  const staleWorkflow = await api.handle(
    request(path, "PUT", {
      expectedRevisionId: automation.activeRevisionId,
      yaml: workflowYaml("auto"),
    }),
  );
  assert.equal(staleWorkflow.status, 409);
  assert.equal(reconciliations, 1);
});

it("updates one Channel revision for Agent and Automation routes and rejects a stale writer", async () => {
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await bundle.runtime.drizzle().insert(schema.organizations).values({
    id: ORGANIZATION_ID,
    name: "Org",
    slug: "org",
  });
  await bundle.runtime.drizzle().insert(schema.users).values({
    id: USER_ID,
    name: "Owner",
    email: "owner@example.test",
    emailVerified: true,
  });
  await bundle.runtime.drizzle().insert(schema.members).values({
    id: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "owner",
  });
  await enrollTestDaemon(database, ORGANIZATION_ID);
  const initial = await database.saveChannelConfiguration({
    organizationId: ORGANIZATION_ID,
    files: [
      {
        path: ".paseo/hub.yml",
        content: `environments:\n  work:\n    kind: daemon\n    daemon: daemon-10000000\n    cwd: /workspace/app\nagents:\n  coding:\n    provider: codex\n    model: gpt-5.5\n`,
      },
    ],
    contentHash: "initial",
    createdByUserId: USER_ID,
  });
  const access = new AccessStore(bundle.runtime);
  const testPosts: Array<{
    channel: string;
    accountId: string;
    conversationId: string;
    expectedRevisionId?: string | null | undefined;
  }> = [];
  const metadataReads: string[] = [];
  const retryStarts: Array<{ channel: string; account: string }> = [];
  const channelSupervisor: ChannelSupervisor = {
    startAll: async () => undefined,
    stopAll: async () => undefined,
    startAccount: async (channel, account) => {
      retryStarts.push({ channel, account });
      return {
        channel,
        account,
        installed: false,
        transport: "started",
      };
    },
    reconcile: async () => ({ accounts: [], stopped: [] }),
    status: () => [
      {
        channel: "telegram",
        account: "support",
        integrity: "ok",
        loadTrace: "ok",
        transport: retryStarts.length === 0 ? "failed" : "started",
        ...(retryStarts.length === 0 ? { detail: "provider connection closed" } : {}),
      },
      {
        channel: "slack",
        account: "another-organization",
        integrity: "ok",
        loadTrace: "ok",
        transport: "started",
      },
    ],
    channelReplyPost: async () => ({ ok: false }),
    channelReplyMediaPost: async () => ({ ok: false }),
    resolveConversation: async (input) => {
      metadataReads.push(input.conversationId);
      return { label: "Customer support", kind: "group", visibility: "unknown" };
    },
    postTestMessage: async (input) => {
      testPosts.push(input);
      return { ok: true, externalMessageId: "test-message-1" };
    },
  };
  const api = new ManagementApi({
    database,
    runtime: bundle.runtime,
    auth: ownerAccess(),
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor,
  });
  const connectionOffer = {
    v: 2 as const,
    serverId: "server-managed",
    daemonPublicKeyB64: "public-key",
    relay: { endpoint: "relay.example.test:443", useTls: true },
  };
  await database.setDaemonConnectionOffer(TEST_DAEMON_ID, connectionOffer, "external");
  const daemonList = await api.handle(request("/daemons", "GET"));
  assert.equal(daemonList.status, 200);
  const managedDaemon = (await daemonList.json()).daemons[0];
  assert.deepEqual(managedDaemon.connectionOffer, connectionOffer);
  assert.equal(managedDaemon.managedAccessMode, "external");

  const validatedAutomationYaml = `name: handoff\nenabled: true\non:\n  manual.run: {}\nrun:\n  target: { daemon: daemon-10000000, cwd: /workspace/app }\n  agent: { provider: codex, mode: default }\n  prompt: hand off\n  max_runtime: 1h\n  idle_timeout: 5m\n`;
  const automationValidation = await api.handle(
    request("/automations/validate", "POST", { yaml: validatedAutomationYaml }),
  );
  assert.equal(automationValidation.status, 200);
  assert.equal((await automationValidation.json()).name, "handoff");
  assert.deepEqual(await (await api.handle(request("/automations", "GET"))).json(), {
    automations: [],
  });

  const automationResponse = await api.handle(
    request("/automations", "POST", {
      expectedRevisionId: null,
      yaml: validatedAutomationYaml,
    }),
  );
  assert.equal(automationResponse.status, 201);
  const automation = await automationResponse.json();
  const channelConnection = await database.configureTelegramConnection({
    organizationId: ORGANIZATION_ID,
    accountId: "support",
    botToken: "telegram-secret",
  });

  const candidate = {
    expectedRevisionId: initial.id,
    resource: {
      environments: {
        work: {
          kind: "daemon",
          daemon: "daemon-10000000",
          cwd: "/workspace/app",
        },
      },
      agents: {
        coding: {
          provider: "codex",
          model: "gpt-5.6",
        },
      },
    },
    policy: { enabled: true },
    accounts: [
      {
        channel: "telegram",
        accountId: "support",
        enabled: true,
        connectionId: channelConnection.connectionId,
        transport: { mode: "polling" },
        routes: [
          { match: { kind: "dm" }, agent: "coding", environment: "work" },
          {
            match: { kind: "group", ids: ["-100123"] },
            workflow: "handoff",
          },
          { match: { kind: "topic", ids: ["42"] }, workflow: "handoff" },
        ],
        fallback: { deny: true },
      },
    ],
  };
  const { expectedRevisionId: _, ...candidateWithoutRevision } = candidate;
  const validation = await api.handle(
    request("/channel-configuration/validate", "POST", candidateWithoutRevision),
  );
  assert.equal(validation.status, 200, JSON.stringify(await validation.clone().json()));
  assert.equal((await validation.json()).effective.accounts.length, 1);
  assert.equal((await database.findActiveChannelConfiguration(ORGANIZATION_ID))?.id, initial.id);

  const invalidValidation = await api.handle(
    request("/channel-configuration/validate", "POST", {
      ...candidateWithoutRevision,
      accounts: [
        {
          ...candidate.accounts[0],
          routes: [{ match: { kind: "dm" }, agent: "missing", environment: "work" }],
        },
      ],
    }),
  );
  assert.equal(invalidValidation.status, 422);
  assert.equal((await invalidValidation.json()).error, "invalid_configuration");
  assert.equal((await database.findActiveChannelConfiguration(ORGANIZATION_ID))?.id, initial.id);

  const update = await api.handle(request("/channel-configuration", "PUT", candidate));
  assert.equal(update.status, 200, JSON.stringify(await update.clone().json()));
  const body = await update.json();
  assert.equal(body.accounts[0].routes[0].agent, "coding");
  assert.equal(body.accounts[0].routes[1].workflow, "handoff");
  assert.equal(body.resource.agents.coding.model, "gpt-5.6");
  assert.equal(body.effective.accounts[0].routes[0].target.kind, "agent");
  assert.equal(body.effective.accounts[0].routes[1].target.kind, "workflow");

  const runtimeStatus = await api.handle(request("/channel-accounts/status", "GET"));
  assert.equal(runtimeStatus.status, 200);
  assert.deepEqual(await runtimeStatus.json(), {
    runtimeAvailable: true,
    accounts: [
      {
        channel: "telegram",
        account: "support",
        integrity: "ok",
        loadTrace: "ok",
        transport: "failed",
        detail: "provider connection closed",
      },
    ],
  });

  await bundle.runtime
    .drizzle()
    .insert(schema.threadBindings)
    .values({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      accountId: "support",
      externalConversationId: "-100123",
      externalThreadId: "42",
      status: "bound",
      pendingExecutionId: null,
      agentId: "observed-agent",
      daemonId: null,
      initiator: "telegram:10001",
      route: {
        match: { kind: "topic", id: "42" },
        conversationLabel: "Customer support",
      },
      resolvedAt: new Date("2026-09-03T10:00:00Z"),
    });
  const observedConversations = await api.handle(
    request("/channel-accounts/telegram/support/conversations", "GET"),
  );
  assert.equal(observedConversations.status, 200);
  assert.deepEqual(
    (await observedConversations.json()).conversations.map(
      (conversation: { id: string; kind: string; rootConversationId: string; label: string }) => ({
        id: conversation.id,
        kind: conversation.kind,
        rootConversationId: conversation.rootConversationId,
        label: conversation.label,
      }),
    ),
    [
      {
        id: "-100123",
        kind: "group",
        rootConversationId: "-100123",
        label: "Customer support",
      },
      {
        id: "42",
        kind: "topic",
        rootConversationId: "-100123",
        label: "Customer support",
      },
    ],
  );

  const retry = await api.handle(request("/channel-accounts/telegram/support/retry", "POST", {}));
  assert.equal(retry.status, 200, JSON.stringify(await retry.clone().json()));
  assert.deepEqual(await retry.json(), {
    result: {
      channel: "telegram",
      account: "support",
      installed: false,
      transport: "started",
    },
    status: {
      channel: "telegram",
      account: "support",
      integrity: "ok",
      loadTrace: "ok",
      transport: "started",
    },
  });
  assert.deepEqual(retryStarts, [{ channel: "telegram", account: "support" }]);

  const testMessage = await api.handle(
    request("/channel-accounts/telegram/support/test", "POST", {
      conversationId: "-100123",
    }),
  );
  assert.equal(testMessage.status, 200);
  assert.deepEqual(await testMessage.json(), {
    ok: true,
    externalMessageId: "test-message-1",
  });
  assert.deepEqual(testPosts, [
    {
      channel: "telegram",
      accountId: "support",
      conversationId: "-100123",
    },
  ]);
  const previewResponse = await api.handle(
    request("/channel-accounts/telegram/support/test-preview?conversationId=-100123", "GET"),
  );
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.text, CHANNEL_TEST_MESSAGE);
  assert.equal(preview.conversationId, "-100123");
  assert.equal(preview.threadId, null);
  assert.deepEqual(preview.attachments, []);
  assert.equal(testPosts.length, 1, "preview never sends a provider message");
  const readsBeforeUnknownParent = metadataReads.length;
  const unknownParent = await api.handle(
    request(
      "/channel-accounts/telegram/support/test-preview?conversationId=-999&threadId=42",
      "GET",
    ),
  );
  assert.equal(unknownParent.status, 200);
  assert.equal((await unknownParent.json()).label, null);
  assert.equal(
    metadataReads.length,
    readsBeforeUnknownParent,
    "configured topic ID cannot authorize an unknown parent metadata read",
  );
  const knownParent = await api.handle(
    request(
      "/channel-accounts/telegram/support/test-preview?conversationId=-100123&threadId=42",
      "GET",
    ),
  );
  assert.equal((await knownParent.json()).label, "Customer support");
  const general = await api.handle(
    request(
      "/channel-accounts/telegram/support/test-preview?conversationId=-100123&threadId=1",
      "GET",
    ),
  );
  assert.equal((await general.json()).threadId, null);
  assert.equal(
    (
      await api.handle(
        request("/channel-accounts/telegram/support/test-preview?conversationId=-999", "GET"),
      )
    ).status,
    422,
  );
  for (const overrides of [
    { expectedText: "a different message" },
    { expectedRevisionId: initial.id },
    { threadId: "42" },
    { expectedPreviewId: "other-preview" },
  ]) {
    const rejected = await api.handle(
      request("/channel-accounts/telegram/support/test", "POST", {
        conversationId: preview.conversationId,
        expectedText: preview.text,
        expectedRevisionId: preview.revisionId,
        expectedPreviewId: preview.previewId,
        ...overrides,
      }),
    );
    assert.equal(rejected.status, 409);
  }
  assert.equal(testPosts.length, 1, "stale or changed previews never send");
  const confirmed = await api.handle(
    request("/channel-accounts/telegram/support/test", "POST", {
      conversationId: preview.conversationId,
      expectedText: preview.text,
      expectedPreviewId: preview.previewId,
    }),
  );
  assert.equal(confirmed.status, 200);
  assert.equal(testPosts.length, 2);
  assert.equal(
    testPosts[1]?.expectedRevisionId,
    preview.revisionId,
    "preview fingerprint also enforces applied runtime revision when the client omits the redundant revision field",
  );
  const unconfiguredTest = await api.handle(
    request("/channel-accounts/telegram/support/test", "POST", {
      conversationId: "-100999",
    }),
  );
  assert.equal(unconfiguredTest.status, 422);
  assert.equal((await unconfiguredTest.json()).error, "conversation_not_configured");

  const channelHistory = await api.handle(request("/channel-configuration/revisions", "GET"));
  assert.equal(channelHistory.status, 200);
  assert.deepEqual(
    (await channelHistory.json()).revisions.map(
      (revision: { version: number }) => revision.version,
    ),
    [2, 1],
  );

  const automationDetail = await api.handle(request(`/automations/${automation.id}`, "GET"));
  assert.equal(automationDetail.status, 200);
  assert.equal((await automationDetail.json()).name, "handoff");
  const automationHistory = await api.handle(
    request(`/automations/${automation.id}/revisions`, "GET"),
  );
  assert.equal(automationHistory.status, 200);
  assert.deepEqual(
    (await automationHistory.json()).revisions.map(
      (revision: { version: number }) => revision.version,
    ),
    [1],
  );
  const automationActivity = await api.handle(
    request(`/automations/${automation.id}/activity`, "GET"),
  );
  assert.equal(automationActivity.status, 200);
  assert.deepEqual(await automationActivity.json(), { activity: [] });

  const catalogResponse = await api.handle(request("/access-catalog", "GET"));
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.deepEqual(
    catalog.resources
      .filter((resource: { kind: string }) =>
        ["channel_account", "automation"].includes(resource.kind),
      )
      .map((resource: { kind: string; id: string }) => ({
        kind: resource.kind,
        id: resource.id,
      })),
    [
      { kind: "automation", id: automation.id },
      { kind: "channel_account", id: "telegram/support" },
    ],
  );

  const assignment = await api.handle(
    request("/access-assignments", "POST", {
      subjectKind: "member",
      subjectId: MEMBERSHIP_ID,
      resourceKind: "channel_account",
      resourceId: "telegram/support",
      privileges: ["channel.use"],
      constraints: {
        conversation: { kind: "specific", conversationIds: ["C-CUSTOMER"] },
      },
    }),
  );
  assert.equal(assignment.status, 201);

  const guessed = await api.handle(
    request("/access-assignments", "POST", {
      subjectKind: "member",
      subjectId: MEMBERSHIP_ID,
      resourceKind: "channel_account",
      resourceId: "slack/unknown",
      privileges: ["channel.use"],
      constraints: {
        conversation: { kind: "specific", conversationIds: ["C-CUSTOMER"] },
      },
    }),
  );
  assert.equal(guessed.status, 404);
  assert.equal((await guessed.json()).error, "resource_unavailable");

  const stale = await api.handle(request("/channel-configuration", "PUT", candidate));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, "revision_conflict");
});

it("stores provider credentials in the Connection owner and never returns them", async () => {
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await bundle.runtime.drizzle().insert(schema.organizations).values({
    id: ORGANIZATION_ID,
    name: "Org",
    slug: "org",
  });
  await bundle.runtime.drizzle().insert(schema.users).values({
    id: USER_ID,
    name: "Owner",
    email: "owner@example.test",
    emailVerified: true,
  });
  await bundle.runtime.drizzle().insert(schema.members).values({
    id: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "owner",
  });
  await bundle.runtime.drizzle().insert(schema.users).values({
    id: "member-user",
    name: "Member",
    email: "member@example.test",
    emailVerified: true,
  });
  await bundle.runtime.drizzle().insert(schema.members).values({
    id: "member-membership",
    organizationId: ORGANIZATION_ID,
    userId: "member-user",
    role: "member",
  });
  const access = new AccessStore(bundle.runtime);
  const credentialRestarts: Array<{ channel: string; account: string }> = [];
  const api = new ManagementApi({
    database,
    runtime: bundle.runtime,
    auth: ownerAccess(),
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: {
      startAccount: async (channel, account) => {
        credentialRestarts.push({ channel, account });
        return { channel, account, installed: false, transport: "started" };
      },
    } as ChannelSupervisor,
  });

  const create = await api.handle(
    request("/connections", "POST", {
      provider: "telegram",
      accountId: "support",
      credentials: { botToken: "telegram-secret" },
    }),
  );
  assert.equal(create.status, 201);
  const connection = await create.json();
  assert.equal(connection.provider, "telegram");
  assert.equal(connection.name, "support");
  assert.equal(JSON.stringify(connection).includes("telegram-secret"), false);

  const list = await api.handle(request("/connections", "GET"));
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.connections.length, 1);
  assert.equal(JSON.stringify(listBody).includes("telegram-secret"), false);
  assert.deepEqual(
    await database.resolveChannelConnection({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      connectionId: connection.id,
    }),
    { botToken: "telegram-secret" },
  );

  const identity = await api.handle(
    request("/channel-identities", "POST", {
      memberId: "member-membership",
      connectionId: connection.id,
      externalSubjectId: "10001",
      displayName: "Owner on Telegram",
    }),
  );
  assert.equal(identity.status, 201);
  assert.equal((await identity.json()).verificationMethod, "administrator");
  const organizationAdminAuth = ownerAccess();
  organizationAdminAuth.resolveAccount = async () => ({
    session: { id: "session", activeOrganizationId: ORGANIZATION_ID },
    account: {
      id: "organization-admin",
      name: "Organization Admin",
      email: "admin@example.test",
    },
    isInstanceOperator: false,
  });
  const organizationAdminApi = new ManagementApi({
    database,
    runtime: bundle.runtime,
    auth: organizationAdminAuth,
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: null,
  });
  const unverifiedIdentity = await organizationAdminApi.handle(
    request("/channel-identities", "POST", {
      memberId: "member-membership",
      connectionId: connection.id,
      externalSubjectId: "unverified-user",
    }),
  );
  assert.equal(unverifiedIdentity.status, 403);
  assert.equal((await unverifiedIdentity.json()).error, "channel_identity_verification_required");

  await database.saveChannelConfiguration({
    organizationId: ORGANIZATION_ID,
    files: [
      {
        path: ".paseo/channels/telegram/support.yml",
        content: `channel: telegram\naccountId: support\nenabled: true\nconnectionId: ${connection.id}\ntransport:\n  mode: polling\n`,
      },
    ],
    contentHash: "channel-access",
    createdByUserId: USER_ID,
  });
  const rotate = await api.handle(
    request("/connections", "POST", {
      provider: "telegram",
      accountId: "support",
      credentials: { botToken: "telegram-secret-rotated" },
    }),
  );
  assert.equal(rotate.status, 201);
  assert.equal((await rotate.json()).id, connection.id);
  assert.deepEqual(credentialRestarts, [{ channel: "telegram", account: "support" }]);
  assert.deepEqual(
    await database.resolveChannelConnection({
      organizationId: ORGANIZATION_ID,
      channel: "telegram",
      connectionId: connection.id,
    }),
    { botToken: "telegram-secret-rotated" },
  );
  await access.saveAssignment(
    ORGANIZATION_ID,
    {
      subjectKind: "member",
      subjectId: "member-membership",
      resourceKind: "channel_account",
      resourceId: "telegram/support",
      privileges: ["channel.use"],
      constraints: {
        conversation: { kind: "specific", conversationIds: ["customer-1"] },
      },
    },
    USER_ID,
  );
  assert.equal(
    await access.allowsChannelPrivilege({
      organizationId: ORGANIZATION_ID,
      connectionId: connection.id,
      channel: "telegram",
      accountId: "support",
      senderIdentity: "telegram:10001",
      conversation: {
        kind: "group",
        id: "customer-1",
        rootConversationId: "customer-1",
      },
      privilege: "channel.use",
    }),
    true,
  );
  assert.equal(
    await access.allowsChannelPrivilege({
      organizationId: ORGANIZATION_ID,
      connectionId: connection.id,
      channel: "telegram",
      accountId: "support",
      senderIdentity: "telegram:10001",
      conversation: {
        kind: "group",
        id: "customer-2",
        rootConversationId: "customer-2",
      },
      privilege: "channel.use",
    }),
    false,
  );

  await enrollTestDaemon(database, ORGANIZATION_ID);
  const [managedProject] = await access.replaceDaemonProjects(ORGANIZATION_ID, TEST_DAEMON_ID, [
    { projectId: "project-support", name: "Support" },
  ]);
  assert.ok(managedProject);
  await access.saveAssignments(
    ORGANIZATION_ID,
    [
      {
        subjectKind: "member",
        subjectId: "member-membership",
        resourceKind: "daemon",
        resourceId: TEST_DAEMON_ID,
        privileges: ["daemon.connect"],
        constraints: {},
      },
      {
        subjectKind: "member",
        subjectId: "member-membership",
        resourceKind: "project",
        resourceId: managedProject.id,
        privileges: ["project.use", "approval.command"],
        constraints: {},
      },
    ],
    USER_ID,
  );
  const teamResponse = await api.handle(request("/teams", "POST", { name: "Support Engineering" }));
  assert.equal(teamResponse.status, 201);
  const supportTeam = await teamResponse.json();
  const teamMemberResponse = await api.handle(
    request(`/teams/${supportTeam.id}/members`, "POST", {
      userId: "member-user",
    }),
  );
  assert.equal(teamMemberResponse.status, 201);
  await access.saveAssignment(
    ORGANIZATION_ID,
    {
      subjectKind: "team",
      subjectId: supportTeam.id,
      resourceKind: "project",
      resourceId: managedProject.id,
      privileges: ["project.use", "terminal.use"],
      constraints: {},
    },
    USER_ID,
  );
  assert.equal(
    await access.allowsChannelApproval({
      organizationId: ORGANIZATION_ID,
      connectionId: connection.id,
      channel: "telegram",
      senderIdentity: "telegram:10001",
      daemonReference: TEST_DAEMON_ID,
      projectId: "project-support",
      privilege: "approval.command",
    }),
    true,
  );
  assert.equal(
    await access.allowsChannelApproval({
      organizationId: ORGANIZATION_ID,
      connectionId: connection.id,
      channel: "telegram",
      senderIdentity: "telegram:10001",
      daemonReference: TEST_DAEMON_ID,
      projectId: "project-support",
      privilege: "approval.command.destructive",
    }),
    false,
  );

  const memberApi = new ManagementApi({
    database,
    runtime: bundle.runtime,
    auth: memberAccess(),
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: null,
  });
  const memberConnections = await memberApi.handle(request("/connections", "GET"));
  assert.equal(memberConnections.status, 200);
  assert.deepEqual(
    (await memberConnections.json()).connections.map(({ id }: { id: string }) => id),
    [connection.id],
  );
  const effectiveAccess = await memberApi.handle(request("/access-assignments/effective", "GET"));
  assert.equal(effectiveAccess.status, 200);
  const effective = await effectiveAccess.json();
  assert.equal(effective.owner, false);
  assert.deepEqual(
    effective.grants
      .filter((grant: { resource: { kind: string } }) => grant.resource.kind === "project")
      .map(
        (grant: {
          resource: { name: string };
          privileges: string[];
          source: { kind: string; teamName?: string };
        }) => ({
          resource: grant.resource.name,
          privileges: grant.privileges,
          source: grant.source.kind === "team" ? `Via ${grant.source.teamName}` : "Direct access",
        }),
      ),
    [
      {
        resource: "Support",
        privileges: ["project.use", "approval.command"],
        source: "Direct access",
      },
      {
        resource: "Support",
        privileges: ["project.use", "terminal.use"],
        source: "Via Support Engineering",
      },
    ],
  );
  const ownerEffectiveAccess = await api.handle(request("/access-assignments/effective", "GET"));
  assert.equal(ownerEffectiveAccess.status, 200);
  assert.deepEqual(await ownerEffectiveAccess.json(), {
    owner: true,
    grants: [],
  });
  const challengeResponse = await memberApi.handle(
    request("/channel-identities/challenges", "POST", {
      connectionId: connection.id,
    }),
  );
  assert.equal(challengeResponse.status, 201);
  const challenge = await challengeResponse.json();
  assert.match(challenge.command, /^\/link [A-Z2-9]{5}-[A-Z2-9]{5}$/u);
  const consumed = await access.consumeChannelIdentityChallenge({
    organizationId: ORGANIZATION_ID,
    connectionId: connection.id,
    externalSubjectId: "10003",
    displayName: "Member verified in Channel",
    code: challenge.command.slice("/link ".length),
  });
  assert.equal(consumed.status, "linked");
  assert.equal(consumed.identity?.memberId, "member-membership");
  assert.equal(consumed.identity?.verificationMethod, "channel_challenge");
  assert.equal(
    (
      await access.consumeChannelIdentityChallenge({
        organizationId: ORGANIZATION_ID,
        connectionId: connection.id,
        externalSubjectId: "10003",
        code: challenge.command.slice("/link ".length),
      })
    ).status,
    "invalid",
  );
  for (const path of [
    "/access-catalog",
    "/access-assignments",
    "/channel-configuration",
    "/channel-configuration/revisions",
    "/channel-accounts/status",
    "/channel-accounts/telegram/support/conversations",
    "/automations",
    "/provider-applications",
  ]) {
    const forbidden = await memberApi.handle(request(path, "GET"));
    assert.equal(forbidden.status, 403, `${path} must require resource management`);
  }

  const inUse = await api.handle(request(`/connections/${connection.id}`, "DELETE"));
  assert.equal(inUse.status, 409);
  assert.deepEqual((await inUse.json()).consumers, [
    {
      resourceKind: "channel_account",
      resourceId: "telegram/support",
      name: "telegram · support",
    },
  ]);

  await database.saveChannelConfiguration({
    organizationId: ORGANIZATION_ID,
    files: [],
    contentHash: "channel-removed",
    createdByUserId: USER_ID,
  });
  const disconnected = await api.handle(request(`/connections/${connection.id}`, "DELETE"));
  assert.equal(disconnected.status, 204);
  assert.equal(
    (
      await bundle.runtime
        .drizzle()
        .select()
        .from(schema.channelIdentities)
        .where(eq(schema.channelIdentities.connectionId, connection.id))
    ).length,
    0,
  );
  assert.equal(
    (await (await api.handle(request("/connections", "GET"))).json()).connections.length,
    0,
  );

  const unavailableConnection = await api.handle(
    request("/channel-identities", "POST", {
      memberId: MEMBERSHIP_ID,
      connectionId: "00000000-0000-0000-0000-000000000000",
      externalSubjectId: "10002",
    }),
  );
  assert.equal(unavailableConnection.status, 404);
  assert.equal((await unavailableConnection.json()).error, "resource_unavailable");
});

it("reuses Provider Application capabilities for management reads, saves, and Connections", async () => {
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await bundle.runtime.drizzle().insert(schema.organizations).values({
    id: ORGANIZATION_ID,
    name: "Org",
    slug: "org",
  });
  await bundle.runtime.drizzle().insert(schema.users).values({
    id: USER_ID,
    name: "Owner",
    email: "owner@example.test",
    emailVerified: true,
  });
  await bundle.runtime.drizzle().insert(schema.members).values({
    id: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "owner",
  });
  const calls: {
    saved: ProviderApplicationConfiguration[];
    connections: Array<{
      provider: string;
      providerApplicationId: string;
      organizationId: string;
    }>;
  } = { saved: [], connections: [] };
  const providerApplications = providerApplicationsFixture(calls);
  const access = new AccessStore(bundle.runtime);
  const api = new ManagementApi({
    database,
    runtime: bundle.runtime,
    auth: ownerAccess(),
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: null,
    providerApplications,
  });

  const overviewResponse = await api.handle(request("/provider-applications", "GET"));
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.applications.github[0].identity.name, "Paseo GitHub");
  assert.equal("configuration" in overview.applications.github[0], false);
  assert.equal(overview.setupGuides.length, 5);
  const slackSocketGuide = overview.setupGuides.find(
    (guide: { provider: string; transport?: string }) =>
      guide.provider === "slack" && guide.transport === "socket",
  );
  assert.equal(
    slackSocketGuide.groups[0].steps.some((step: { manifest?: string }) =>
      step.manifest?.includes("socket_mode_enabled: true"),
    ),
    true,
  );
  assert.equal(
    overview.setupGuides
      .flatMap(
        (guide: { groups: Array<{ fields: Array<Record<string, unknown>> }> }) => guide.groups,
      )
      .flatMap((group: { fields: Array<Record<string, unknown>> }) => group.fields)
      .some((field: Record<string, unknown>) => "value" in field),
    false,
  );

  const saveResponse = await api.handle(
    request("/provider-applications", "POST", {
      provider: "github",
      appId: "42",
      appSlug: "paseo-github",
      clientId: "client-id",
      clientSecret: "client-secret",
      privateKey: "private-key",
      webhookSecret: "webhook-secret",
    }),
  );
  assert.equal(saveResponse.status, 201);
  assert.equal((await saveResponse.json()).status, "verified");
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0]?.provider, "github");

  const connectionResponse = await api.handle(
    request("/connections", "POST", {
      provider: "github",
      providerApplicationId: "42",
    }),
  );
  assert.equal(connectionResponse.status, 202);
  assert.deepEqual(await connectionResponse.json(), {
    status: "continuing",
    provider: "github",
    url: "https://github.example.test/install",
  });
  assert.deepEqual(calls.connections, [
    {
      provider: "github",
      providerApplicationId: "42",
      organizationId: ORGANIZATION_ID,
    },
  ]);

  const connections = await api.handle(request("/connections", "GET"));
  assert.equal(connections.status, 200);
  assert.deepEqual((await connections.json()).providerApplications, [
    { provider: "github", id: "42", name: "Paseo GitHub" },
  ]);
});

it("authenticates the daemon and atomically replaces its Project catalog", async () => {
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await bundle.runtime.drizzle().insert(schema.organizations).values({
    id: ORGANIZATION_ID,
    name: "Org",
    slug: "org",
  });
  await enrollTestDaemon(database, ORGANIZATION_ID);
  const credential = "daemon-secret";
  await bundle.runtime
    .drizzle()
    .update(schema.daemons)
    .set({
      credentialVerifier: createHash("sha256").update(credential).digest("base64url"),
    });
  const access = new AccessStore(bundle.runtime);
  const response = await replaceDaemonProjects(
    new Request(`https://hub.example.test/api/daemons/${TEST_DAEMON_ID}/projects`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projects: [
          {
            projectId: "project-alpha",
            name: "Alpha",
            agentConfigurationCatalog: {
              providers: [
                {
                  id: "codex",
                  label: "Codex",
                  models: [
                    {
                      id: "gpt-5.6",
                      label: "GPT-5.6",
                      thinkingOptions: [{ id: "high", label: "High" }],
                    },
                  ],
                },
              ],
            },
          },
          { projectId: "project-beta", name: "Beta" },
        ],
      }),
    }),
    TEST_DAEMON_ID,
    database,
    access,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    (await access.listDaemonProjects(ORGANIZATION_ID, TEST_DAEMON_ID)).map(
      ({ projectId, available }) => ({ projectId, available }),
    ),
    [
      { projectId: "project-alpha", available: true },
      { projectId: "project-beta", available: true },
    ],
  );
  const alphaResource = (await access.listResources(ORGANIZATION_ID)).find(
    ({ kind, name }) => kind === "project" && name === "Alpha",
  );
  assert.deepEqual(alphaResource?.agentConfigurationCatalog, {
    providers: [
      {
        id: "codex",
        label: "Codex",
        models: [
          {
            id: "gpt-5.6",
            label: "GPT-5.6",
            thinkingOptions: [{ id: "high", label: "High" }],
          },
        ],
      },
    ],
  });

  await replaceDaemonProjects(
    new Request(`https://hub.example.test/api/daemons/${TEST_DAEMON_ID}/projects`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projects: [{ projectId: "project-beta", name: "Beta renamed" }],
      }),
    }),
    TEST_DAEMON_ID,
    database,
    access,
  );
  assert.deepEqual(
    (await access.listDaemonProjects(ORGANIZATION_ID, TEST_DAEMON_ID)).map(
      ({ projectId, name, available }) => ({ projectId, name, available }),
    ),
    [
      { projectId: "project-alpha", name: "Alpha", available: false },
      { projectId: "project-beta", name: "Beta renamed", available: true },
    ],
  );
});

it("atomically grants Project access with its preserved Daemon connection access", async () => {
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await bundle.runtime.drizzle().insert(schema.organizations).values({
    id: ORGANIZATION_ID,
    name: "Org",
    slug: "org",
  });
  await bundle.runtime
    .drizzle()
    .insert(schema.users)
    .values([
      {
        id: USER_ID,
        name: "Owner",
        email: "owner@example.test",
        emailVerified: true,
      },
      {
        id: "member-user",
        name: "Member",
        email: "member@example.test",
        emailVerified: true,
      },
    ]);
  await bundle.runtime
    .drizzle()
    .insert(schema.members)
    .values([
      {
        id: MEMBERSHIP_ID,
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        role: "owner",
      },
      {
        id: "member-membership",
        organizationId: ORGANIZATION_ID,
        userId: "member-user",
        role: "member",
      },
    ]);
  await enrollTestDaemon(database, ORGANIZATION_ID);
  const access = new AccessStore(bundle.runtime);
  const [project] = await access.replaceDaemonProjects(ORGANIZATION_ID, TEST_DAEMON_ID, [
    { projectId: "project-alpha", name: "Alpha" },
  ]);
  assert.ok(project);
  const api = new ManagementApi({
    database,
    runtime: bundle.runtime,
    auth: ownerAccess(),
    access,
    tickets: new AccessTicketService(bundle.runtime, access),
    channelSupervisor: null,
  });

  const response = await api.handle(
    request("/access-assignments/batch", "POST", {
      assignments: [
        {
          subjectKind: "member",
          subjectId: "member-membership",
          resourceKind: "daemon",
          resourceId: TEST_DAEMON_ID,
          privileges: ["daemon.connect", "daemon.manage"],
          constraints: {},
        },
        {
          subjectKind: "member",
          subjectId: "member-membership",
          resourceKind: "project",
          resourceId: project.id,
          privileges: ["project.use", "agent.interact", "agent.create"],
          constraints: {
            agentConfigurations: [
              {
                providerId: "codex",
                modelIds: ["gpt-5.6"],
                thinkingOptionIds: ["high"],
              },
            ],
          },
        },
      ],
    }),
  );

  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const assignments = (await response.json()).assignments;
  assert.equal(assignments.length, 2);
  assert.deepEqual(assignments[0].privileges, ["daemon.connect", "daemon.manage"]);
  const authority = await access.resolveDaemonAccess({
    organizationId: ORGANIZATION_ID,
    daemonId: TEST_DAEMON_ID,
    userId: "member-user",
    membershipId: "member-membership",
  });
  assert.equal(authority?.resourceMode, "daemon");
});

it("stores the daemon Connection Offer and managed access mode with an off compatibility default", async () => {
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await bundle.runtime.drizzle().insert(schema.organizations).values({
    id: ORGANIZATION_ID,
    name: "Org",
    slug: "org",
  });
  await enrollTestDaemon(database, ORGANIZATION_ID);
  const credential = "daemon-secret";
  await bundle.runtime
    .drizzle()
    .update(schema.daemons)
    .set({
      credentialVerifier: createHash("sha256").update(credential).digest("base64url"),
    });
  const connectionOffer = {
    v: 2 as const,
    serverId: "server-managed",
    daemonPublicKeyB64: "public-key",
    relay: { endpoint: "relay.example.test:443", useTls: true },
  };

  const response = await replaceDaemonConnectionOffer(
    new Request(`https://hub.example.test/api/daemons/${TEST_DAEMON_ID}/connection-offer`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        connectionOffer,
        managedAccessMode: "external",
      }),
    }),
    TEST_DAEMON_ID,
    database,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    (await database.findDaemonById(TEST_DAEMON_ID))?.connectionOffer,
    connectionOffer,
  );
  assert.equal((await database.findDaemonById(TEST_DAEMON_ID))?.managedAccessMode, "external");

  const compatibilityResponse = await replaceDaemonConnectionOffer(
    new Request(`https://hub.example.test/api/daemons/${TEST_DAEMON_ID}/connection-offer`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ connectionOffer }),
    }),
    TEST_DAEMON_ID,
    database,
  );

  assert.equal(compatibilityResponse.status, 200);
  assert.equal((await database.findDaemonById(TEST_DAEMON_ID))?.managedAccessMode, "off");
});

function request(path: string, method: string, body?: unknown): Request {
  return new Request(
    `https://hub.example.test/api/management/v1/organizations/${ORGANIZATION_ID}${path}`,
    {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    },
  );
}

function automationYaml(mode: string): string {
  return [
    "name: public-handoff",
    "enabled: true",
    "on:",
    "  manual.run: {}",
    "run:",
    "  target: { daemon: daemon-10000000, cwd: /workspace/app }",
    `  agent: { provider: codex, mode: ${mode} }`,
    "  prompt: hand off",
    "  max_runtime: 1h",
    "  idle_timeout: 5m",
  ].join("\n");
}

function ownerAccess(): BrowserOrganizationAccess {
  const value = {
    session: { id: "session" },
    account: { id: USER_ID, name: "Owner", email: "owner@example.test" },
    organization: { id: ORGANIZATION_ID, name: "Org", slug: "org" },
    membership: { id: MEMBERSHIP_ID, role: "owner" as const },
    capabilities: {
      view: true as const,
      manageMembers: true,
      manageOwners: true,
      manageResources: true,
    },
  };
  return {
    resolveOrganizationAccess: async () => value,
    resolveAccount: async () => ({
      session: { id: "session", activeOrganizationId: ORGANIZATION_ID },
      account: value.account,
      isInstanceOperator: true,
    }),
    rejectCookieMutation: () => undefined,
  };
}

function memberAccess(): BrowserOrganizationAccess {
  const value = {
    session: { id: "member-session" },
    account: {
      id: "member-user",
      name: "Member",
      email: "member@example.test",
    },
    organization: { id: ORGANIZATION_ID, name: "Org", slug: "org" },
    membership: { id: "member-membership", role: "member" as const },
    capabilities: {
      view: true as const,
      manageMembers: false,
      manageOwners: false,
      manageResources: false,
    },
  };
  return {
    resolveOrganizationAccess: async () => value,
    resolveAccount: async () => ({
      session: { id: "member-session", activeOrganizationId: ORGANIZATION_ID },
      account: value.account,
      isInstanceOperator: false,
    }),
    rejectCookieMutation: () => undefined,
  };
}

function providerApplicationsFixture(calls: {
  saved: ProviderApplicationConfiguration[];
  connections: Array<{
    provider: string;
    providerApplicationId: string;
    organizationId: string;
  }>;
}): ProviderApplications {
  const unavailable = (provider: "github" | "slack" | "discord" | "linear") => ({
    provider,
    status: "notConfigured" as const,
    managedByEnvironment: false,
    identifiers: {},
    identity: null,
    connections: [],
    eventsConfigured: false,
    lastEventAt: null,
    replaceable: true,
    configurationVersion: null,
  });
  const github = {
    ...unavailable("github"),
    status: "verified" as const,
    identifiers: {
      appId: "42",
      appSlug: "paseo-github",
      clientId: "client-id",
    },
    identity: {
      provider: "github" as const,
      id: "42",
      name: "Paseo GitHub",
      ownerLogin: "acme",
    },
    configurationVersion: 1,
  };
  return {
    overview: async () => ({
      callbackOrigin: "https://hub.example.test",
      providers: {
        github,
        slack: unavailable("slack"),
        discord: unavailable("discord"),
        linear: unavailable("linear"),
      },
      applications: { github: [github], slack: [], discord: [], linear: [] },
    }),
    connectionCatalog: async () => [{ provider: "github", id: "42", name: "Paseo GitHub" }],
    verifyAndSave: async (_request, provider, input) => {
      assert.equal(provider, input.provider);
      calls.saved.push(input);
      return {
        status: "verified",
        provider,
        identity: {
          provider: "github",
          id: "42",
          name: "Paseo GitHub",
          ownerLogin: "acme",
        },
        configurationVersion: 2,
      };
    },
    beginConnection: async (_request, provider, providerApplicationId, organizationId) => {
      calls.connections.push({
        provider,
        providerApplicationId,
        organizationId,
      });
      return { url: "https://github.example.test/install" };
    },
    configureSlackSocket: async () => {
      throw new Error("not used");
    },
    retrySlackSocket: async () => undefined,
  };
}
