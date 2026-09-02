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
import {
  createManualTriggerSource,
  dispatchManualTrigger,
} from "../triggers/manual/source.js";
import { createUnlimitedEntitlementsService } from "../entitlements/test-utils.js";
import { createDispatcherWithEngine } from "./index.js";
import { createChannelWorkflowProvider } from "../triggers/channel/provider.js";

describe("manual trigger durable workflow boundary", () => {
  it("persists a channel delivery and invokes the named workflow through the durable worker", async () => {
    const database = createMemoryDatabase();
    const configuration = manualWorkflowConfiguration();
    const trigger = await database.saveOrganizationTrigger({
      organizationId: "org_1",
      name: "deploy",
      enabled: true,
      format: "legacy_multistep",
      yaml: "name: deploy",
      normalizedConfiguration: configuration,
      contentHash: compiledConfigurationHash(configuration),
      sourceKind: "manual",
      sourceEvidence: { kind: "test" },
      createdByUserId: null,
      routes: [],
    });
    const revision = await database.findOrganizationTriggerRevision(
      trigger.id,
      trigger.activeRevisionId,
    );
    assert.ok(revision);
    const dispatches: import("./launch-machine-intent.js").LaunchMachineIntent[] =
      [];
    const { handler, engine } = createDispatcherWithEngine({
      database,
      entitlements: createUnlimitedEntitlementsService(),
      providers: [createChannelWorkflowProvider(database)],
      dispatchLaunchMachineIntent: async (intent) => {
        dispatches.push(intent);
        const execution = await database.findAgentExecutionByWorkflowStepRunId(
          intent.workflowStepRunId!,
        );
        assert.ok(execution);
        return { execution };
      },
    });
    const persisted = await database.persistChannelEvent({
      organizationId: "org_1",
      triggerId: trigger.id,
      triggerRevisionId: trigger.activeRevisionId,
      deliveryId: "slack:account:1712.1",
      source: "channel.message",
      payload: {
        workflow: "deploy",
        workflow_id: trigger.id,
        workflow_revision_id: trigger.activeRevisionId,
        text: "run",
        channel: {
          name: "slack",
          account_id: "account",
          binding_key: '["slack","account","C1","1712.0"]',
          external_conversation_id: "C1",
          external_thread_id: "1712.0",
          sender_identity: "slack:U1",
          root_kind: "channel",
          trigger_thread_id: "1712.0",
          trigger_message_id: "1712.1",
          route: {
            defaultRoles: [],
            assignments: [],
            defaults: {},
            approval: [],
          },
        },
      },
      receivedAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    assert.equal(persisted.status, "accepted");
    if (persisted.status !== "accepted") return;

    await handler(persisted.event);
    await engine.processAvailable();

    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0]!.triggerName, "deploy");
    assert.equal(
      dispatches[0]!.outputContext &&
        Reflect.get(dispatches[0]!.outputContext, "provider"),
      "channel",
    );
    assert.equal(
      (
        await database.findProviderEventReceiptById(
          persisted.event.providerEventReceiptId,
        )
      )?.provider,
      "channel",
    );
    assert.equal(revision.id, persisted.event.configurationRevisionId);
    assert.equal(persisted.event.workflowId, trigger.id);
    const run = (
      await database.findTriggerRunsByProviderEventReceiptId(
        persisted.event.providerEventReceiptId,
      )
    )[0];
    assert.equal(run?.workflowId, trigger.id);
    assert.equal(dispatches[0]?.workflowId, trigger.id);
  });

  it("records a manual delivery as dropped when no provider matches", async () => {
    const database = createMemoryDatabase();
    const { workflow, revision } = await createManualWorkflow(database);
    const source = createManualTriggerSource(database);
    const { handler } = createDispatcherWithEngine({
      database,
      entitlements: createUnlimitedEntitlementsService(),
      providers: [noMatchingProvider()],
      configurationRevisionId: revision.id,
    });
    await source.start(handler);

    await dispatchManualTrigger(
      source,
      manualTrigger("manual-no-match", workflow.id, revision.id),
    );

    const receipt = await database.findProviderEventReceiptByDeliveryId(
      "manual-no-match",
      "org_1",
    );
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
    const configuration = manualWorkflowConfiguration();
    const workflow = await database.saveOrganizationTrigger({
      organizationId: "org_1",
      name: "deploy",
      enabled: true,
      format: "legacy_multistep",
      yaml: "name: deploy",
      normalizedConfiguration: configuration,
      contentHash: compiledConfigurationHash(configuration),
      sourceKind: "manual",
      sourceEvidence: { kind: "test" },
      createdByUserId: null,
      routes: [],
    });
    const revision = await database.findOrganizationTriggerRevision(
      workflow.id,
      workflow.activeRevisionId,
    );
    assert.ok(revision);
    const source = createManualTriggerSource(database);
    const dispatches: string[] = [];
    const { handler, engine } = createDispatcherWithEngine({
      database,
      entitlements: createUnlimitedEntitlementsService(),
      providers: [matchingProvider(configuration, revision.id)],
      configurationRevisionId: revision.id,
      dispatchLaunchMachineIntent: async (intent) => {
        dispatches.push(intent.workflowStepRunId ?? "");
        if (intent.workflowStepRunId === undefined)
          throw new Error("workflow step is required");
        const execution = await database.findAgentExecutionByWorkflowStepRunId(
          intent.workflowStepRunId,
        );
        if (execution === undefined)
          throw new Error("workflow execution was not persisted");
        return { execution };
      },
    });
    await source.start(handler);

    const outcome = await dispatchManualTrigger(
      source,
      manualTrigger("manual-durable", workflow.id, revision.id),
    );
    await engine.processAvailable();

    assert.equal(outcome?.providerEventReceiptId !== undefined, true);
    const triggerId = outcome?.providerEventReceiptId;
    assert.ok(triggerId);
    const run = (
      await database.findTriggerRunsByProviderEventReceiptId(triggerId)
    )[0];
    assert.ok(run);
    const step = await database.findWorkflowStepRunByTriggerRun(run.id);
    assert.ok(step);
    assert.deepEqual(dispatches, [step.id]);
    assert.equal(
      (await database.findAgentExecutionByWorkflowStepRunId(step.id))
        ?.workflowStepRunId,
      step.id,
    );
  });
});

async function createManualWorkflow(
  database: ReturnType<typeof createMemoryDatabase>,
) {
  const configuration = manualWorkflowConfiguration();
  const workflow = await database.saveOrganizationTrigger({
    organizationId: "org_1",
    name: "deploy",
    enabled: true,
    format: "legacy_multistep",
    yaml: "name: deploy",
    normalizedConfiguration: configuration,
    contentHash: compiledConfigurationHash(configuration),
    sourceKind: "manual",
    sourceEvidence: { kind: "test" },
    createdByUserId: null,
    routes: [],
  });
  const revision = await database.findOrganizationTriggerRevision(
    workflow.id,
    workflow.activeRevisionId,
  );
  assert.ok(revision);
  return { workflow, revision };
}

function manualTrigger(
  deliveryId: string,
  triggerId: string,
  triggerRevisionId: string,
): ManualTriggerInput {
  return {
    organizationId: "org_1",
    triggerId,
    triggerRevisionId,
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

function matchingProvider(
  configuration: CompiledHubConfig,
  revisionId: string,
): TriggerProvider {
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
    environments: [
      { name: "runner", kind: "daemon", daemon: "runner", cwd: "/repo" },
    ],
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
