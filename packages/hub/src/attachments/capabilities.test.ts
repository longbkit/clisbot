import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import { createDiscordAttachmentResolver } from "../triggers/discord/attachments.js";
import { createAttachmentCapabilityRegistry } from "./capabilities.js";

describe("attachment capability boundary", () => {
  it("streams a provider attachment only through its durable workflow receipt", async () => {
    const fixture = await workflowExecution();
    const resolverCalls: unknown[] = [];
    const registry = createAttachmentCapabilityRegistry({
      database: fixture.database,
      publicBaseUrl: "https://hub.test",
      authoritySecret: "hub-secret",
      resolvers: {
        slack: async (input) => {
          resolverCalls.push(input);
          return new Response("exact bytes", {
            headers: { "content-type": "image/png", "content-length": "11" },
          });
        },
      },
    });
    const attachment = await registry.register({
      providerEventReceiptId: fixture.providerEventReceiptId,
      organizationId: "org-1",
      connectionId: "connection-1",
      provider: "slack",
      sourceId: "F1",
      locator: { fileId: "F1" },
      filename: "pixel.png",
      contentType: "image/png",
      byteSize: 11,
    });

    const response = await registry.handle(
      new Request(registry.urlFor(attachment.id, fixture.executionId)),
      fixture.executionId,
      attachment.id,
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "exact bytes");
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-disposition") ?? "", /pixel\.png/u);
    assert.deepEqual(resolverCalls, [
      {
        organizationId: "org-1",
        connectionId: "connection-1",
        executionId: fixture.executionId,
        locator: { fileId: "F1" },
      },
    ]);
  });

  it("rejects forged, expired, terminal, and cross-receipt capabilities", async () => {
    const fixture = await workflowExecution();
    const other = await workflowExecution(fixture.database, "delivery-2");
    let nowMs = 1_700_000_000_000;
    let resolverCalls = 0;
    const registry = createAttachmentCapabilityRegistry({
      database: fixture.database,
      publicBaseUrl: "https://hub.test",
      authoritySecret: "hub-secret",
      now: () => new Date(nowMs),
      lifetimeSeconds: 10,
      resolvers: {
        discord: async () => {
          resolverCalls += 1;
          return new Response("must not be reached");
        },
      },
    });
    const attachment = await registry.register({
      providerEventReceiptId: fixture.providerEventReceiptId,
      organizationId: "org-1",
      connectionId: "connection-1",
      provider: "discord",
      sourceId: "attachment-1",
      locator: { url: "https://cdn.discordapp.com/attachments/1/2/image.png" },
      filename: "image.png",
      contentType: "image/png",
      byteSize: 4,
    });

    const validUrl = new URL(registry.urlFor(attachment.id, fixture.executionId));
    const forgedUrl = new URL(validUrl);
    forgedUrl.searchParams.set("signature", `${validUrl.searchParams.get("signature")}forged`);
    assert.equal(
      (await registry.handle(new Request(forgedUrl), fixture.executionId, attachment.id)).status,
      404,
    );
    assert.equal(
      (
        await registry.handle(
          new Request(registry.urlFor(attachment.id, other.executionId)),
          other.executionId,
          attachment.id,
        )
      ).status,
      404,
    );
    nowMs += 11_000;
    assert.equal(
      (await registry.handle(new Request(validUrl), fixture.executionId, attachment.id)).status,
      404,
    );
    await fixture.database.transitionAgentExecution(fixture.executionId, "failed");
    assert.equal(
      (
        await registry.handle(
          new Request(registry.urlFor(attachment.id, fixture.executionId)),
          fixture.executionId,
          attachment.id,
        )
      ).status,
      404,
    );
    assert.equal(resolverCalls, 0);
  });

  it("preserves Discord streaming metadata", async () => {
    const fixture = await workflowExecution();
    const resolver = createDiscordAttachmentResolver({
      fetch: async (input) => {
        assert.equal(requestUrl(input), "https://cdn.discordapp.com/attachments/1/2/file.bin");
        return new Response("discord-bytes", { headers: { etag: '"discord-1"' } });
      },
    });
    const registry = createAttachmentCapabilityRegistry({
      database: fixture.database,
      publicBaseUrl: "https://hub.test",
      authoritySecret: "hub-secret",
      resolvers: { discord: resolver },
    });
    const attachment = await registry.register({
      providerEventReceiptId: fixture.providerEventReceiptId,
      organizationId: "org-1",
      connectionId: "connection-1",
      provider: "discord",
      sourceId: "attachment-1",
      locator: { url: "https://cdn.discordapp.com/attachments/1/2/file.bin" },
      filename: "file.bin",
      contentType: "application/octet-stream",
      byteSize: 13,
    });

    const response = await registry.handle(
      new Request(registry.urlFor(attachment.id, fixture.executionId)),
      fixture.executionId,
      attachment.id,
    );
    assert.equal(await response.text(), "discord-bytes");
    assert.equal(response.headers.get("etag"), '"discord-1"');
    assert.equal(response.headers.get("content-length"), "13");
  });

  it("does not forward encoded upstream lengths", async () => {
    const fixture = await workflowExecution();
    const registry = createAttachmentCapabilityRegistry({
      database: fixture.database,
      publicBaseUrl: "https://hub.test",
      authoritySecret: "hub-secret",
      resolvers: {
        slack: async () =>
          new Response("decoded bytes", {
            headers: { "content-encoding": "gzip", "content-length": "123" },
          }),
      },
    });
    const attachment = await registry.register({
      providerEventReceiptId: fixture.providerEventReceiptId,
      organizationId: "org-1",
      connectionId: "connection-1",
      provider: "slack",
      sourceId: "encoded-file",
      locator: { fileId: "encoded-file" },
      filename: "file.bin",
      contentType: "application/octet-stream",
      byteSize: 12,
    });
    const response = await registry.handle(
      new Request(registry.urlFor(attachment.id, fixture.executionId)),
      fixture.executionId,
      attachment.id,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), null);
  });
});

async function workflowExecution(database = createMemoryDatabase(), deliveryId = "delivery-1") {
  let project = (await database.listProjectsForOrganization("org-1"))[0];
  project ??= await database.createProject({
    organizationId: "org-1",
    name: "Project 1",
    slug: "project-1",
    createdByUserId: "test-user",
  });
  let revision = await database.findActiveProjectConfiguration(project.id);
  if (revision === undefined) {
    revision = await database.insertProjectConfigurationRevision({
      projectId: project.id,
      sourceKind: "manual",
      sourceEvidence: { kind: "test" },
      normalizedConfiguration: { environments: [], triggers: [] },
      contentHash: "attachment-test-configuration",
    });
    await database.activateProjectConfigurationRevision(project.id, revision.id);
  }
  const persisted = await database.persistManualEvent({
    organizationId: "org-1",
    projectId: project.id,
    connectionId: null,
    resourceId: null,
    deliveryId,
    source: "manual.run",
    payload: {},
    receivedAt: new Date(),
  });
  if (persisted.status !== "accepted") throw new Error("receipt was not accepted");
  const run = await database.createAcceptedTriggerRun({
    organizationId: "org-1",
    projectId: project.id,
    configurationRevisionId: revision.id,
    providerEventReceiptId: persisted.event.providerEventReceiptId,
    configuredTriggerName: "attachment-run",
    prompt: "inspect",
    inputs: {},
    triggerContext: {},
    outputContext: {},
    deadlineAt: new Date(Date.now() + 60_000),
    stepIds: ["inspect"],
  });
  const step = await database.findWorkflowStepRunByTriggerRun(run.run.id);
  if (step === undefined) throw new Error("step was not created");
  const executionId = randomUUID();
  await database.createWorkflowStepExecution({
    triggerRunId: run.run.id,
    stepId: step.stepId,
    ordinal: step.ordinal,
    executionId,
    execution: {
      id: executionId,
      organizationId: "org-1",
      projectId: project.id,
      machineId: null,
      triggerContext: {},
      outputContext: {},
      configurationRevisionId: run.run.configurationRevisionId,
      deadlineAt: new Date(Date.now() + 60_000),
      idleDeadlineAt: new Date(Date.now() + 30_000),
      startedAt: new Date(),
      workflowStepRunId: step.id,
    },
  });
  return {
    database,
    providerEventReceiptId: persisted.event.providerEventReceiptId,
    executionId,
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}
