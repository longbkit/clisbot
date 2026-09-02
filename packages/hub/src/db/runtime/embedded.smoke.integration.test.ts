import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { createApplicationRuntime } from "../../application-runtime.js";
import { createAuthServer } from "../../auth/server.js";
import { composeEntitlements } from "../../auth/entitlements.js";
import { createDatabase } from "../pg.js";
import { embeddedDatabaseRuntime } from "./index.js";
import { createTestCredentialCipher } from "../../credentials/test-utils.js";

it("joins runtime queries to the active embedded transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-pglite-transaction-"));
  const { runtime } = await embeddedDatabaseRuntime(join(root, "database"));
  try {
    await runtime.query("create table nested_query (value text not null)");
    await runtime.transaction(async () => {
      await runtime.query("insert into nested_query (value) values ($1)", ["joined"]);
    });
    const result = await runtime.query<{ value: string }>("select value from nested_query");
    assert.deepEqual(result.rows, [{ value: "joined" }]);
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("persists organization Workflow ownership without a runtime Project", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-pglite-workflow-owner-"));
  const { runtime, locks } = await embeddedDatabaseRuntime(join(root, "database"));
  await runtime.migrate();
  const database = createDatabase(runtime, locks, createTestCredentialCipher());
  try {
    await runtime.query(`insert into organization (id, name, slug) values ($1, $2, $3)`, [
      "workflow-org",
      "Workflow organization",
      "workflow-organization",
    ]);
    const workflow = await database.saveOrganizationTrigger({
      organizationId: "workflow-org",
      name: "channel-workflow",
      enabled: true,
      format: "legacy_multistep",
      yaml: "name: channel-workflow",
      normalizedConfiguration: { environments: [], triggers: [] },
      contentHash: "channel-workflow-v1",
      sourceKind: "manual",
      sourceEvidence: { kind: "embedded-owner-test" },
      createdByUserId: null,
      routes: [],
    });
    const persisted = await database.persistChannelEvent({
      organizationId: "workflow-org",
      triggerId: workflow.id,
      triggerRevisionId: workflow.activeRevisionId,
      deliveryId: "workflow-owner-delivery",
      source: "channel.message",
      payload: {},
      receivedAt: new Date(),
    });
    assert.equal(persisted.status, "accepted");
    if (persisted.status !== "accepted") throw new Error("Channel event was not accepted");
    assert.equal(persisted.event.workflowId, workflow.id);

    const run = await database.createAcceptedTriggerRun({
      organizationId: "workflow-org",
      workflowId: workflow.id,
      configurationRevisionId: workflow.activeRevisionId,
      providerEventReceiptId: persisted.event.providerEventReceiptId,
      configuredTriggerName: "channel-workflow",
      prompt: "run",
      inputs: {},
      triggerContext: {},
      outputContext: {},
      deadlineAt: new Date(Date.now() + 60_000),
      stepIds: ["step"],
    });
    const [step] = await database.listWorkflowStepRunsForTriggerRun(run.run.id);
    assert.ok(step);
    const execution = await database.createWorkflowStepExecution({
      triggerRunId: run.run.id,
      stepId: step.stepId,
      ordinal: step.ordinal,
      executionId: randomUUID(),
      execution: {
        organizationId: "workflow-org",
        workflowId: workflow.id,
        machineId: null,
        triggerContext: {},
        outputContext: {},
        configurationRevisionId: workflow.activeRevisionId,
        deadlineAt: new Date(Date.now() + 60_000),
        idleDeadlineAt: new Date(Date.now() + 30_000),
        startedAt: new Date(),
      },
    });
    assert.equal(execution.created, true);
    assert.equal(execution.execution?.workflowId, workflow.id);
    assert.deepEqual(await database.listProjectsForOrganization("workflow-org"), []);
  } finally {
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("runs the bootstrap, credential lock, and lease claim flows on embedded storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-pglite-smoke-"));
  const { runtime, locks } = await embeddedDatabaseRuntime(join(root, "database"));
  await runtime.migrate();
  const database = createDatabase(runtime, locks, createTestCredentialCipher());
  const entitlements = composeEntitlements(database, runtime);
  const auth = createAuthServer({
    database: runtime,
    locks,
    entitlements: entitlements.service,
    secret: "embedded-smoke-secret".padEnd(32, "-"),
    baseURL: "http://embedded.test",
    policy: {
      registrationMode: "invite_only",
      organizationCreation: "disabled",
      bootstrap: {
        ownerEmail: "owner@embedded.test",
        ownerPassword: "embedded-owner-password",
        organizationName: "Embedded organization",
      },
    },
  });
  const application = await createApplicationRuntime({
    database,
    auth,
    entitlements: entitlements.service,
    billing: null,
    registrations: [],
    publicBaseUrl: "http://embedded.test",
    async close() {
      await auth.close();
      await entitlements.close();
      await database.close();
    },
  });

  try {
    await auth.initialize?.();
    const owner = await runtime.query<{ organization_id: string; user_id: string }>(
      `select member.organization_id, member.user_id
         from member where member.role = 'owner'`,
    );
    const identity = owner.rows[0];
    assert.ok(identity);

    const apiKey = await auth.apiKeys!.create(
      identity.organization_id,
      identity.user_id,
      "embedded smoke",
      ["daemons:enroll"],
    );
    const tokenIssued = await database.issueEnrollmentToken({
      id: randomUUID(),
      verifier: "embedded-smoke-enrollment",
      organizationId: identity.organization_id,
      issuedByApiKeyId: apiKey.summary.id,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    assert.equal(tokenIssued, true);

    const workflow = await database.saveOrganizationTrigger({
      organizationId: identity.organization_id,
      name: "embedded-smoke",
      enabled: true,
      format: "legacy_multistep",
      yaml: "name: embedded-smoke",
      normalizedConfiguration: { environments: [], triggers: [] },
      contentHash: "embedded-smoke-configuration",
      sourceKind: "manual",
      sourceEvidence: { kind: "embedded-smoke" },
      createdByUserId: null,
      routes: [],
    });
    const receipt = await database.persistManualEvent({
      organizationId: identity.organization_id,
      triggerId: workflow.id,
      triggerRevisionId: workflow.activeRevisionId,
      deliveryId: "embedded-smoke-delivery",
      source: "embedded.smoke",
      payload: {},
      receivedAt: new Date(),
    });
    assert.equal(receipt.status, "accepted");
    if (receipt.status !== "accepted") throw new Error("manual event was not accepted");
    const run = await database.createAcceptedTriggerRun({
      organizationId: identity.organization_id,
      workflowId: workflow.id,
      configurationRevisionId: workflow.activeRevisionId,
      providerEventReceiptId: receipt.event.providerEventReceiptId,
      configuredTriggerName: "embedded-smoke",
      prompt: "embedded smoke",
      inputs: {},
      triggerContext: {},
      outputContext: {},
      deadlineAt: new Date(Date.now() + 60_000),
      stepIds: ["embedded-step"],
    });
    const wakeup = await database.claimWorkflowWakeup(new Date(), 30_000);
    assert.equal(wakeup?.triggerRunId, run.run.id);
    assert.ok(application.hub);
  } finally {
    await application.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
