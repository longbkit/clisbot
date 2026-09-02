import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "./memory.js";

describe("machine model database contract", () => {
  it("inserts, selects, and transitions machines and agent executions", async () => {
    const database = createMemoryDatabase();
    const workflow = await createWorkflowFixture(database);
    const triggerContext = { provider: "manual", deliveryId: "delivery-1" };

    const machine = await database.insertMachine({
      orgId: "org-1",
      source: { kind: "daemon", daemonId: "mob-hetzner" },
      status: "alive",
      triggerName: null,
      triggerContext,
      specs: { os: "linux" },
    });

    assert.equal(machine.status, "alive");
    assert.deepEqual(await database.findMachineById(machine.id), machine);

    const executionId = randomUUID();
    const execution = await database.insertAgentExecution({
      id: executionId,
      organizationId: "org-1",
      workflowId: workflow.id,
      machineId: machine.id,
      triggerContext,
      outputContext: triggerContext,
      configurationRevisionId: workflow.activeRevisionId,
    });

    assert.equal(execution.status, "spawning");
    assert.equal(execution.id, executionId);
    assert.deepEqual(execution.triggerContext, triggerContext);
    assert.deepEqual(execution.outputContext, triggerContext);

    const running = await database.transitionAgentExecution(execution.id, "running");
    assert.equal(running.transitioned, true);
    assert.equal(running.execution.status, "running");
    assert.equal(running.execution.completedAt, null);

    const succeeded = await database.transitionAgentExecution(execution.id, "succeeded", {
      result: { summary: "done" },
    });
    assert.equal(succeeded.transitioned, true);
    assert.equal(succeeded.execution.status, "succeeded");
    assert.notEqual(succeeded.execution.completedAt, null);
    assert.deepEqual(succeeded.execution.result, { summary: "done" });

    const finalOutput = await database.beginAgentExecutionOutput(
      execution.id,
      "telegram.reply",
      1,
      new Date(),
    );
    assert.ok(finalOutput);

    const terminated = await database.transitionMachine(machine.id, "terminated", {
      reason: "daemon_disconnected",
    });
    assert.equal(terminated.status, "terminated");
    assert.equal(terminated.shutdownReason, "daemon_disconnected");
    assert.notEqual(terminated.terminatedAt, null);
  });

  it("does not overwrite terminal agent executions", async () => {
    const database = createMemoryDatabase();
    const workflow = await createWorkflowFixture(database);
    const machine = await database.insertMachine({
      orgId: "org-1",
      source: { kind: "daemon", daemonId: "mob-hetzner" },
      status: "alive",
    });
    const execution = await database.insertAgentExecution({
      organizationId: "org-1",
      workflowId: workflow.id,
      machineId: machine.id,
      triggerContext: null,
      outputContext: null,
      configurationRevisionId: workflow.activeRevisionId,
    });

    const failed = await database.transitionAgentExecution(execution.id, "failed", {
      result: { status: "failed", reason: "daemon_disconnected" },
    });
    const succeeded = await database.transitionAgentExecution(execution.id, "succeeded", {
      result: { status: "succeeded" },
    });

    assert.equal(failed.transitioned, true);
    assert.equal(succeeded.transitioned, false);
    assert.equal(succeeded.execution.status, "failed");
    assert.deepEqual(succeeded.execution.result, {
      status: "failed",
      reason: "daemon_disconnected",
    });
    assert.equal(
      await database.beginAgentExecutionOutput(execution.id, "telegram.reply", 1, new Date()),
      undefined,
    );
  });
});

async function createWorkflowFixture(database: ReturnType<typeof createMemoryDatabase>) {
  return database.saveOrganizationTrigger({
    organizationId: "org-1",
    name: `machine-model-${randomUUID()}`,
    enabled: true,
    format: "single_run",
    yaml: "",
    normalizedConfiguration: {},
    contentHash: randomUUID(),
    sourceKind: "manual",
    sourceEvidence: { kind: "test" },
    createdByUserId: null,
    routes: [],
  });
}
