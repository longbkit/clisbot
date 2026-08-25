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

it("runs the bootstrap, credential lock, and lease claim flows on embedded storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-pglite-smoke-"));
  const { runtime, locks } = await embeddedDatabaseRuntime(join(root, "database"));
  await runtime.migrate();
  const database = createDatabase(runtime, locks);
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
    const owner = await runtime.query<{
      organization_id: string;
      project_id: string;
      user_id: string;
    }>(
      `select member.organization_id, projects.id as project_id, member.user_id
         from member
         join projects on projects.organization_id = member.organization_id
         where member.role = 'owner'`,
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

    const revision = await database.insertProjectConfigurationRevision({
      projectId: identity.project_id,
      sourceKind: "manual",
      sourceEvidence: { kind: "embedded-smoke" },
      normalizedConfiguration: { environments: [], triggers: [] },
      contentHash: "embedded-smoke-configuration",
    });
    await database.activateProjectConfigurationRevision(identity.project_id, revision.id);
    const receipt = await database.persistManualEvent({
      organizationId: identity.organization_id,
      projectId: identity.project_id,
      deliveryId: "embedded-smoke-delivery",
      source: "embedded.smoke",
      payload: {},
      receivedAt: new Date(),
    });
    assert.equal(receipt.status, "accepted");
    if (receipt.status !== "accepted") throw new Error("manual event was not accepted");
    const run = await database.createAcceptedTriggerRun({
      organizationId: identity.organization_id,
      projectId: identity.project_id,
      configurationRevisionId: revision.id,
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
