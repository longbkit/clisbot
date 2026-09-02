import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresQueryRuntime } from "./test-utils/runtime.js";
import { createDatabase } from "./test-utils/runtime.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";

describe("trigger acceptance persistence", () => {
  let postgres: StartedPostgreSqlContainer;
  let databaseUrl: string;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    databaseUrl = postgres.getConnectionUri();
  }, 120_000);

  afterAll(async () => {
    await postgres.stop();
  }, 120_000);

  it("does not resolve another organization when delivery keys collide", async () => {
    const database = await createDatabase(databaseUrl);
    const client = await createPostgresQueryRuntime(databaseUrl);

    await client.query(`
      insert into organization (id, name, slug) values
        ('manual-org-a', 'Manual A', 'manual-a'),
        ('manual-org-b', 'Manual B', 'manual-b');
    `);
    await client.close();
    const firstWorkflow = await saveWorkflow(database, "manual-org-a", "manual-org-a-config");
    const secondWorkflow = await saveWorkflow(database, "manual-org-b", "manual-org-b-config");

    const first = await database.persistManualEvent(
      input("manual-org-a", firstWorkflow.id, firstWorkflow.activeRevisionId),
    );
    const second = await database.persistManualEvent(
      input("manual-org-b", secondWorkflow.id, secondWorkflow.activeRevisionId),
    );
    assert.equal(first.status, "accepted");
    assert.equal(second.status, "accepted");
    if (first.status !== "accepted" || second.status !== "accepted")
      throw new Error("expected accepted triggers");
    assert.notEqual(first.event.providerEventReceiptId, second.event.providerEventReceiptId);

    const duplicate = await database.persistManualEvent(
      input("manual-org-a", firstWorkflow.id, firstWorkflow.activeRevisionId),
    );
    assert.equal(duplicate.status, "accepted");
    if (duplicate.status !== "accepted") throw new Error("expected replayed accepted trigger");
    assert.equal(duplicate.event.providerEventReceiptId, first.event.providerEventReceiptId);
    assert.equal(duplicate.event.organizationId, "manual-org-a");
    assert.equal(duplicate.event.workflowId, firstWorkflow.id);
    await database.close();
  }, 120_000);

  it("lists only receipts with a committed bounded drop reason", async () => {
    const database = await createDatabase(databaseUrl);
    const client = await createPostgresQueryRuntime(databaseUrl);

    await client.query(
      `
      insert into organization (id, name, slug)
      values ('drop-reason-org', 'Drop Reason', 'drop-reason');
    `,
    );
    await client.close();
    const workflow = await saveWorkflow(database, "drop-reason-org", "drop-reason-config");
    const receipt = await database.persistManualEvent({
      organizationId: "drop-reason-org",
      triggerId: workflow.id,
      triggerRevisionId: workflow.activeRevisionId,
      source: "manual.run",
      deliveryId: "drop-reason-delivery",
      receivedAt: new Date(),
      payload: { private: "PRIVATE-EVENT-BODY" },
    });
    if (receipt.status !== "accepted") throw new Error("expected accepted receipt");

    assert.deepEqual(
      await database.listUnroutedProviderEventsForOrganization("drop-reason-org"),
      [],
    );
    await database.markProviderEventDropped(
      receipt.event.providerEventReceiptId,
      "trigger_filters_rejected",
    );
    const [unrouted] = await database.listUnroutedProviderEventsForOrganization("drop-reason-org");
    assert.equal(unrouted?.droppedReason, "trigger_filters_rejected");
    assert.equal("payload" in (unrouted ?? {}), false);
    await database.close();
  }, 120_000);

  it("durably drops Linear events until the connection has the required scopes", async () => {
    const database = await createDatabase(databaseUrl);
    const client = await createPostgresQueryRuntime(databaseUrl);
    const organizationId = "linear-scope-org";
    const connectionId = "40000000-0000-4000-8000-000000000002";
    const credentialEnvelope = createTestCredentialCipher().encrypt(
      "linear-connection:linear-app:linear-scope-workspace",
      { accessToken: "linear-access-token", refreshToken: "linear-refresh-token" },
    );

    await client.query(
      `
      insert into organization (id, name, slug)
      values ('${organizationId}', 'Linear Scope', 'linear-scope');
      insert into linear_connections
        (id, organization_id, linear_organization_id, provider_application_id, slug,
         linear_organization_name, app_user_id, credential_envelope, refresh_token_available, scopes)
      values
        ('${connectionId}', '${organizationId}', 'linear-scope-workspace', 'linear-app',
         'linear-scope', 'Linear Scope', 'linear-app-user', $1, true, '["read"]'::jsonb);
    `,
      [JSON.stringify(credentialEnvelope)],
    );
    const workflow = await saveWorkflow(database, organizationId, "linear-scope-config", [
      {
        provider: "linear",
        connectionId,
        resourceId: "linear-project",
        configuredEventName: "linear.issue",
      },
    ]);

    const dropped = await database.acceptLinearEvent({
      linearOrganizationId: "linear-scope-workspace",
      projectId: "linear-project",
      deliveryId: "linear-under-scoped",
      source: "linear.issue",
      payload: {},
      receivedAt: new Date(0),
    });
    assert.equal(dropped.status, "dropped");
    if (dropped.status !== "dropped") throw new Error("expected an under-scoped drop");
    assert.equal(dropped.reason, "configuration_unavailable");
    assert.equal(
      (await database.findProviderEventReceiptByDeliveryId("linear-under-scoped", organizationId))
        ?.droppedReason,
      "configuration_unavailable",
    );

    await client.query(
      `update linear_connections set scopes = '["read", "comments:create"]'::jsonb
       where id = '${connectionId}'`,
    );
    const accepted = await database.acceptLinearEvent({
      linearOrganizationId: "linear-scope-workspace",
      projectId: "linear-project",
      deliveryId: "linear-reauthorized",
      source: "linear.issue",
      payload: {},
      receivedAt: new Date(1),
    });
    assert.equal(accepted.status, "accepted");
    if (accepted.status === "accepted") assert.equal(accepted.events[0]?.workflowId, workflow.id);

    await client.query(
      `update linear_connections
       set refresh_token_available = false, access_token_expires_at = '1970-01-01T00:00:00.000Z'
       where id = '${connectionId}'`,
    );
    const expired = await database.acceptLinearEvent({
      linearOrganizationId: "linear-scope-workspace",
      projectId: "linear-project",
      deliveryId: "linear-expired-without-refresh",
      source: "linear.issue",
      payload: {},
      receivedAt: new Date(120_000),
    });
    assert.equal(expired.status, "dropped");
    if (expired.status !== "dropped") throw new Error("expected an expired-token drop");
    assert.equal(expired.reason, "configuration_unavailable");

    await client.close();
    await database.close();
  }, 120_000);
});

function input(organizationId: string, triggerId: string, triggerRevisionId: string) {
  return {
    organizationId,
    triggerId,
    triggerRevisionId,
    source: "manual.run",
    deliveryId: "same-delivery-key",
    receivedAt: new Date(),
    payload: { authenticatedBy: { kind: "api-key", keyId: `key-${organizationId}` } },
  } as const;
}

function saveWorkflow(
  database: Awaited<ReturnType<typeof createDatabase>>,
  organizationId: string,
  contentHash: string,
  routes: import("./types.js").OrganizationTriggerRoute[] = [],
) {
  return database.saveOrganizationTrigger({
    organizationId,
    name: `workflow-${contentHash}`,
    enabled: true,
    format: "legacy_multistep",
    yaml: `name: workflow-${contentHash}`,
    normalizedConfiguration: { environments: [], triggers: [] },
    contentHash,
    sourceKind: "manual",
    sourceEvidence: { kind: "test" },
    createdByUserId: null,
    routes,
  });
}
