import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import {
  deriveAgentExecutionCompletionToken,
  hashAgentExecutionCompletionToken,
} from "../agent-executions/completion-token.js";
import { createMemoryDatabase } from "../db/memory.js";
import type { JsonValue } from "../config/compiler.js";
import type { LaunchMachineIntent } from "../dispatcher/launch-machine-intent.js";
import {
  AgentExecutionOutputValidationFailure,
  createDaemonDispatchLifecycle,
} from "./lifecycle.js";

describe("structured daemon completion", () => {
  it("rejects invalid output for retry, then atomically completes and deduplicates", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org-1"] });
    const executionId = randomUUID();
    const token = deriveAgentExecutionCompletionToken("completion-secret", executionId);
    const schema: JsonValue = {
      type: "object",
      additionalProperties: false,
      required: ["repo"],
      $defs: { repo: { type: "string", minLength: 3, enum: ["paseo", "hub"] } },
      properties: { repo: { $ref: "#/$defs/repo" } },
    };
    const intent: LaunchMachineIntent = {
      kind: "launch_machine",
      organizationId: "org-1",
      projectId: "project-1",
      triggerRunId: "trigger-run-1",
      workflowStepRunId: "step-run-1",
      triggerName: "route",
      environmentName: "runner",
      environment: {
        kind: "daemon",
        daemonId: "daemon-1",
        authoredSlug: "runner",
        cwd: "/workspace",
      },
      prompt: "classify",
      agent: { provider: "codex", mode: "default" },
      allowOutputs: [],
      autoArchive: false,
      triggerContext: { provider: "manual" },
      outputContext: { provider: "manual" },
      outputSchema: schema,
      configurationRevisionId: "revision-1",
      hubConfig: { environments: [], triggers: [] },
    };
    const createdRun = await database.createAcceptedTriggerRun({
      organizationId: "org-1",
      projectId: "project-1",
      configurationRevisionId: "revision-1",
      providerEventReceiptId: "trigger-1",
      configuredTriggerName: "route",
      prompt: "investigate",
      inputs: {},
      triggerContext: intent.triggerContext,
      outputContext: intent.outputContext,
      deadlineAt: new Date(Date.now() + 60_000),
      stepIds: ["classify"],
    });
    const step = await database.findWorkflowStepRunByTriggerRun(createdRun.run.id);
    assert.ok(step);
    const execution = await database.insertAgentExecution({
      id: executionId,
      organizationId: "org-1",
      projectId: "project-1",
      machineId: null,
      triggerContext: intent.triggerContext,
      outputContext: intent.outputContext,
      configurationRevisionId: "revision-1",
      completionTokenHash: hashAgentExecutionCompletionToken(token),
      workflowStepRunId: step.id,
      launchIntent: intent,
    });
    await database.linkWorkflowStepRunExecution(step.id, execution.id, intent);
    const lifecycle = createDaemonDispatchLifecycle({
      database,
      connectionForDaemon: () => undefined,
      completionTokenSecret: "completion-secret",
    });

    await assert.rejects(
      lifecycle.completeAgentExecutionFromCallback({
        executionId,
        token,
        output: { repo: "other" },
      }),
      (error: unknown) =>
        error instanceof AgentExecutionOutputValidationFailure && /repo/u.test(error.message),
    );
    assert.equal((await database.findAgentExecutionById(executionId))?.status, "spawning");
    assert.equal((await database.findWorkflowStepRunById(step.id))?.status, "running");

    const completed = await lifecycle.completeAgentExecutionFromCallback({
      executionId,
      token,
      output: { repo: "hub" },
    });
    assert.equal(completed.status, "succeeded");
    assert.deepEqual((await database.findWorkflowStepRunById(step.id))?.output, { repo: "hub" });
    assert.equal((await database.findTriggerRunById(createdRun.run.id))?.status, "running");

    const duplicate = await lifecycle.completeAgentExecutionFromCallback({
      executionId,
      token,
      output: { repo: "paseo" },
    });
    assert.equal(duplicate.id, completed.id);
    assert.equal(duplicate.status, "succeeded");
    await lifecycle.stop();
  });
});
