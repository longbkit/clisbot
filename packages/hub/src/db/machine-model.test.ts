import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "./memory.js";

describe("machine model database contract", () => {
  it("inserts, selects, and transitions machines and agent executions", async () => {
    const database = createMemoryDatabase();
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
      projectId: "project-1",
      machineId: machine.id,
      triggerContext,
      outputContext: triggerContext,
      configurationRevisionId: "config-version-1",
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

    const terminated = await database.transitionMachine(machine.id, "terminated", {
      reason: "daemon_disconnected",
    });
    assert.equal(terminated.status, "terminated");
    assert.equal(terminated.shutdownReason, "daemon_disconnected");
    assert.notEqual(terminated.terminatedAt, null);
  });

  it("does not overwrite terminal agent executions", async () => {
    const database = createMemoryDatabase();
    const machine = await database.insertMachine({
      orgId: "org-1",
      source: { kind: "daemon", daemonId: "mob-hetzner" },
      status: "alive",
    });
    const execution = await database.insertAgentExecution({
      organizationId: "org-1",
      projectId: "project-1",
      machineId: machine.id,
      triggerContext: null,
      outputContext: null,
      configurationRevisionId: "config-version-1",
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
  });
});
