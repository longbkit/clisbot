import { compileHubConfig } from "../config/compiler.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import { createDatabase } from "../db/pg.js";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import * as schema from "../db/schema.js";
import type { Database } from "../db/types.js";
import { readChannelWorkflowRuns } from "./channel-status.js";
import { stopChannelWorkflowRuns } from "./channel-stop.js";

it.each(["memory", "embedded"])(
  "stops only exact route runs durably and idempotently (%s)",
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "hub-channel-stop-"));
    const bundle = kind === "embedded" ? await embeddedDatabaseRuntime(root) : undefined;
    let database: Database;
    if (bundle !== undefined) {
      await bundle.runtime.migrate();
      await bundle.runtime
        .drizzle()
        .insert(schema.organizations)
        .values([
          { id: "org", name: "Org", slug: "org" },
          { id: "other", name: "Other", slug: "other" },
        ]);
      database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
    } else database = createMemoryDatabase({ organizationIds: ["org", "other"] });
    try {
      const stopped = await createRun(database);
      const otherConversation = await createRun(database, { bindingKey: "other" });
      const otherOrganization = await createRun(database, { organizationId: "other" });
      const otherWorkflow = await createRun(database, { workflowName: "other" });
      const otherProvider = await createRun(database, { provider: "manual" });
      const recovered: string[] = [];
      const input = {
        database,
        organizationId: "org",
        bindingKey: "binding",
        workflowName: "work",
        authorizeTarget: async () => true,
        recoverExecutions: async (ids: readonly string[]) => {
          recovered.push(...ids);
        },
      };
      await expect(
        stopChannelWorkflowRuns({
          ...input,
          authorizeTarget: async (target) => target.projectId !== "project-second",
        }),
      ).rejects.toThrow("every target Project");
      expect((await database.findTriggerRunById(stopped.runId))?.status).toBe("running");
      let lateRun: Awaited<ReturnType<typeof createRun>> | undefined;
      expect(
        await stopChannelWorkflowRuns({
          ...input,
          authorizeTarget: async () => {
            if (!lateRun) lateRun = await createRun(database);
            return true;
          },
        }),
      ).toBe(1);
      expect((await database.findTriggerRunById(lateRun!.runId))?.status).toBe("running");
      expect(recovered).toEqual([stopped.executionId]);
      expect(await database.findTriggerRunById(stopped.runId)).toMatchObject({
        status: "failed",
        failureReason: "channel_stop",
        deadlineKind: null,
      });
      expect(await database.findAgentExecutionById(stopped.executionId)).toMatchObject({
        status: "failed",
        result: { status: "failed", reason: "channel_stop" },
      });
      const steps = await database.listWorkflowStepRunsForTriggerRun(stopped.runId);
      expect(steps.map(({ status }) => status)).toEqual(["failed", "failed"]);
      for (const run of [otherConversation, otherOrganization, otherWorkflow, otherProvider]) {
        expect((await database.findTriggerRunById(run.runId))?.status).toBe("running");
      }
      expect(await stopChannelWorkflowRuns(input)).toBe(1);
      expect(await stopChannelWorkflowRuns(input)).toBe(0);
      await database.completeWorkflowStep(stopped.executionId, "succeeded", { done: true });
      expect((await database.findTriggerRunById(stopped.runId))?.status).toBe("failed");
      expect((await database.listWorkflowStepRunsForTriggerRun(stopped.runId))[1]?.status).toBe(
        "failed",
      );
    } finally {
      await database.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it("reads all active workflow runs with pending steps and the actual execution Host", async () => {
  const database = createMemoryDatabase({ organizationIds: ["org", "other"] });
  try {
    const first = await createRun(database);
    const second = await createRun(database);
    await createRun(database, { organizationId: "other" });
    await createRun(database, { workflowName: "other" });
    const firstHost = await enrollStatusDaemon(database, "server-first");
    const secondHost = await enrollStatusDaemon(database, "server-second");
    await database.attachAgentToExecution(first.executionId, firstHost, "agent-first");
    await database.attachAgentToExecution(second.executionId, secondHost, "agent-second");
    const input = {
      database,
      organizationId: "org",
      workflowName: "work",
      bindingKey: "binding",
      authorizeTarget: async () => true,
    };
    await expect(
      readChannelWorkflowRuns({
        ...input,
        authorizeTarget: async (target) => target.projectId !== "project-second",
      }),
    ).rejects.toThrow("every target Project");
    const results = await readChannelWorkflowRuns(input);
    expect(results).toHaveLength(2);
    expect(results.find(({ id }) => id === first.runId)?.steps).toEqual([
      { id: "first", status: "running", agentId: "agent-first", serverId: "server-first" },
      { id: "second", status: "pending" },
    ]);
    expect(results.find(({ id }) => id === second.runId)?.steps[0]).toMatchObject({
      agentId: "agent-second",
      serverId: "server-second",
    });
    expect((await database.findTriggerRunById(first.runId))?.status).toBe("running");
  } finally {
    await database.close();
  }
});

async function enrollStatusDaemon(database: Database, serverId: string): Promise<string> {
  const daemonId = randomUUID();
  const verifier = randomUUID();
  const now = new Date();
  await database.issueEnrollmentToken({
    id: randomUUID(),
    verifier,
    organizationId: "org",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  await database.enrollDaemon({
    tokenVerifier: verifier,
    daemonId,
    idempotencyKey: randomUUID(),
    serverId,
    daemonPublicKey: `key-${serverId}`,
    credentialVerifier: randomUUID(),
    permissions: ["hub.execute"],
    now,
  });
  return daemonId;
}

async function createRun(
  database: Database,
  options: {
    organizationId?: string;
    bindingKey?: string;
    workflowName?: string;
    provider?: string;
  } = {},
) {
  const organizationId = options.organizationId ?? "org";
  const workflow = await database.saveOrganizationTrigger({
    organizationId,
    name: `workflow-${randomUUID()}`,
    enabled: true,
    format: "legacy_multistep",
    yaml: "name: workflow",
    sourceKind: "manual",
    sourceEvidence: { kind: "test" },
    normalizedConfiguration: stopConfiguration(options.workflowName ?? "work"),
    contentHash: randomUUID(),
    createdByUserId: null,
    routes: [],
  });
  const receipt = await database.persistManualEvent({
    organizationId,
    triggerId: workflow.id,
    triggerRevisionId: workflow.activeRevisionId,
    deliveryId: randomUUID(),
    source: "manual.run",
    payload: {},
    receivedAt: new Date(),
  });
  if (receipt.status !== "accepted") throw new Error("Test receipt was not accepted");
  const outputContext = {
    provider: options.provider ?? "channel",
    channel: { binding_key: options.bindingKey ?? "binding" },
  };
  const { run } = await database.createAcceptedTriggerRun({
    organizationId,
    workflowId: workflow.id,
    configurationRevisionId: workflow.activeRevisionId,
    providerEventReceiptId: receipt.event.providerEventReceiptId,
    configuredTriggerName: options.workflowName ?? "work",
    prompt: "run",
    inputs: {},
    triggerContext: {},
    outputContext,
    deadlineAt: new Date(Date.now() + 60_000),
    stepIds: ["first", "second"],
  });
  const [step] = await database.listWorkflowStepRunsForTriggerRun(run.id);
  const execution = await database.insertAgentExecution({
    organizationId,
    workflowId: workflow.id,
    machineId: null,
    triggerContext: {},
    outputContext,
    configurationRevisionId: workflow.activeRevisionId,
    workflowStepRunId: step!.id,
  });
  await database.linkWorkflowStepRunExecution(step!.id, execution.id);
  return { runId: run.id, executionId: execution.id };
}

function stopConfiguration(workflowName: string) {
  const compiled = compileHubConfig({
    environments: ["first", "second"].map((name) => ({
      name,
      kind: "daemon",
      daemon: "runner",
      cwd: `/workspace/${name}`,
    })),
    triggers: [
      {
        name: workflowName,
        on: "manual.run",
        max_runtime: "2m",
        steps: ["first", "second"].map((name) => ({
          id: name,
          environment: name,
          max_runtime: "1m",
          idle_timeout: "20s",
          agent: { provider: "codex" },
          prompt: [{ text: "run" }],
        })),
      },
    ],
  });
  return {
    ...compiled,
    environments: compiled.environments.map((environment) =>
      Object.assign({}, environment, {
        daemonId: "daemon-test",
        projectId: `project-${environment.name}`,
      }),
    ),
  };
}
