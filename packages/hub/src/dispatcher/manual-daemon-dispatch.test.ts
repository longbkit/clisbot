import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  compileHubConfig,
  compiledConfigurationHash,
  type CompiledHubConfig,
} from "../config/compiler.js";
import { createMemoryDatabase } from "../db/memory.js";
import type { ManualTriggerInput } from "../triggers/manual/schema.js";
import type { TriggerProvider } from "../triggers/index.js";
import { createManualTriggerSource, dispatchManualTrigger } from "../triggers/manual/source.js";
import { createUnlimitedEntitlementsService } from "../entitlements/test-utils.js";
import { createDispatcherWithEngine } from "./index.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

describe("manual trigger durable workflow boundary", () => {
  it("records a manual delivery as dropped when no provider matches", async () => {
    const database = createMemoryDatabase();
    const { project, revision } = await createManualProject(database);
    const source = createManualTriggerSource(database);
    const { handler } = createDispatcherWithEngine({
      database,
      entitlements: createUnlimitedEntitlementsService(),
      providers: [noMatchingProvider()],
      configurationRevisionId: revision.id,
    });
    await source.start(handler);

    await dispatchManualTrigger(source, manualTrigger("manual-no-match", project.id));

    const receipt = await database.findProviderEventReceiptByDeliveryId("manual-no-match", "org_1");
    assert.equal(receipt?.droppedReason, "no_trigger_for_source");
    assert.deepEqual(
      receipt === undefined
        ? []
        : await database.findTriggerRunsByProviderEventReceiptId(receipt.id),
      [],
    );
  });

  it("persists one manual run and lets the workflow worker own the step dispatch", async () => {
    const database = createMemoryDatabase();
    const project = await database.createProject({
      organizationId: "org_1",
      name: "Manual",
      slug: "manual",
      createdByUserId: "user-1",
    });
    const configuration = manualWorkflowConfiguration();
    const revision = await database.insertProjectConfigurationRevision({
      projectId: project.id,
      sourceKind: "manual",
      sourceEvidence: { kind: "test" },
      normalizedConfiguration: configuration,
      contentHash: compiledConfigurationHash(configuration),
      createdByUserId: "user-1",
    });
    await database.activateProjectConfigurationRevision(project.id, revision.id);
    const source = createManualTriggerSource(database);
    const dispatches: string[] = [];
    const { handler, engine } = createDispatcherWithEngine({
      database,
      entitlements: createUnlimitedEntitlementsService(),
      providers: [matchingProvider(configuration, revision.id)],
      configurationRevisionId: revision.id,
      dispatchLaunchMachineIntent: async (intent) => {
        dispatches.push(intent.workflowStepRunId ?? "");
        if (intent.workflowStepRunId === undefined) throw new Error("workflow step is required");
        const execution = await database.findAgentExecutionByWorkflowStepRunId(
          intent.workflowStepRunId,
        );
        if (execution === undefined) throw new Error("workflow execution was not persisted");
        return { execution };
      },
    });
    await source.start(handler);

    const outcome = await dispatchManualTrigger(
      source,
      manualTrigger("manual-durable", project.id),
    );
    await engine.processAvailable();

    assert.equal(outcome?.providerEventReceiptId !== undefined, true);
    const triggerId = outcome?.providerEventReceiptId;
    assert.ok(triggerId);
    const run = (await database.findTriggerRunsByProviderEventReceiptId(triggerId))[0];
    assert.ok(run);
    const step = await database.findWorkflowStepRunByTriggerRun(run.id);
    assert.ok(step);
    assert.deepEqual(dispatches, [step.id]);
    assert.equal(
      (await database.findAgentExecutionByWorkflowStepRunId(step.id))?.workflowStepRunId,
      step.id,
    );
  });
});

async function createManualProject(database: ReturnType<typeof createMemoryDatabase>) {
  const project = await database.createProject({
    organizationId: "org_1",
    name: "Manual",
    slug: "manual",
    createdByUserId: "user-1",
  });
  const configuration = manualWorkflowConfiguration();
  const revision = await database.insertProjectConfigurationRevision({
    projectId: project.id,
    sourceKind: "manual",
    sourceEvidence: { kind: "test" },
    normalizedConfiguration: configuration,
    contentHash: compiledConfigurationHash(configuration),
    createdByUserId: "user-1",
  });
  await database.activateProjectConfigurationRevision(project.id, revision.id);
  return { project, revision };
}

function manualTrigger(deliveryId: string, projectId = PROJECT_ID): ManualTriggerInput {
  return {
    organizationId: "org_1",
    projectId,
    source: "manual.run",
    deliveryId,
    receivedAt: new Date("2026-08-05T12:00:00.000Z"),
    payload: { trigger: "deploy", actor: "operator", input: "run" },
  };
}

function noMatchingProvider(): TriggerProvider {
  return {
    name: "manual",
    eventNames: ["manual.run"],
    async match() {
      return [];
    },
  };
}

function matchingProvider(configuration: CompiledHubConfig, revisionId: string): TriggerProvider {
  return {
    name: "manual",
    eventNames: ["manual.run"],
    async match(trigger) {
      return [
        {
          triggerName: "deploy",
          triggerContext: trigger.payload,
          outputContext: { provider: "manual" },
          configurationRevisionId: revisionId,
          hubConfig: configuration,
          invocation: {
            status: "accepted",
            prompt: "run",
            inputs: {},
          },
        },
      ];
    },
  };
}

function manualWorkflowConfiguration(): CompiledHubConfig {
  const compiled = compileHubConfig({
    environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/repo" }],
    triggers: [
      {
        name: "deploy",
        on: "manual.run",
        max_runtime: "1m",
        filters: { from_users: ["operator"] },
        steps: [
          {
            id: "deploy-agent",
            environment: "runner",
            max_runtime: "30s",
            idle_timeout: "5s",
            agent: { provider: "opencode" },
            prompt: [{ text: "run" }],
          },
        ],
      },
    ],
  });
  return {
    environments: [
      {
        name: "runner",
        kind: "daemon",
        daemon: "runner",
        daemonId: "daemon-1",
        cwd: "/repo",
      },
    ],
    triggers: compiled.triggers,
  };
}
