import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import { HubE2E } from "./harness/index.js";
import { currentProjectConfigurationFiles } from "../test-utils/current-project-configuration.js";

const describeHubE2E = process.env["RUN_HUB_E2E"] === "1" ? describe : describe.skip;

describeHubE2E("Paseo Hub cross-repository contract", () => {
  let hub: HubE2E;

  beforeEach(async () => {
    hub = await HubE2E.start();
  }, 120_000);

  afterEach(async () => {
    const shutdown = await hub?.stop();
    assert.ok((shutdown?.durationMs ?? 0) < 10_000);
    assert.deepEqual(shutdown?.leakedProcesses ?? [], []);
  }, 120_000);

  it("connects the source-built daemon through an enrollment token", async () => {
    const enrollment = await hub.connect();
    await hub.daemonIsConnected();

    assert.equal((await hub.status()).state, "connected");
    assert.match(
      enrollment.daemonId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    await hub.disconnect();
  }, 120_000);

  it("validates and installs the exact authored bundle through the source-built CLI", async () => {
    await hub.connect();
    await hub.daemonIsConnected();

    const evidence = await hub.deployCurrentProjectBundleWithSourceCli();
    const expectedFiles = (await currentProjectConfigurationFiles()).toSorted((left, right) =>
      left.path.localeCompare(right.path),
    );
    const configuration = evidence.effectiveConfiguration;

    assert.deepEqual(evidence.dryRun, {
      projectSlug: "default",
      valid: true,
      workflows: 4,
      origin: evidence.origin,
    });
    assert.equal(evidence.revisionsAfterDryRun, evidence.revisionsBeforeDryRun);
    assert.equal(evidence.revisionsAfterInstall, evidence.revisionsBeforeDryRun + 1);
    assert.deepEqual(evidence.install, {
      projectSlug: "default",
      versionId: evidence.install["versionId"],
      version: evidence.revisionsAfterInstall,
      active: true,
      workflows: 4,
      origin: evidence.origin,
    });
    assert.deepEqual(evidence.authoredFiles, expectedFiles);
    assert.deepEqual(configuration.environments, [
      {
        name: "hub",
        cwd: "/workspace/hub",
        daemonId: configuration.environments[0]?.daemonId,
      },
      {
        name: "paseo",
        cwd: "/workspace/paseo",
        daemonId: configuration.environments[1]?.daemonId,
      },
    ]);
    assert.equal(configuration.slackWorkerEnvironment, "${{ values.selected_environment }}");
    assert.equal(configuration.slackAgentSelector, "${{ values.selected_agent }}");
    assert.deepEqual(configuration.codexOptions, {
      sandbox_workspace_write: {
        writable_roots: ["/var/cache/npm"],
        network_access: false,
      },
    });
    assert.deepEqual(configuration.classifierPartial, {
      kind: "partial",
      path: ".paseo/workflows/partials/classify.md",
      content:
        "Choose one configured repository environment and one complete named agent configuration.\n",
      contentHash: "dcfb1a4600e287c40ff4da4c38c98ac86a7f5508458b560dde9151aec03f6bf6",
    });
  }, 180_000);

  it("connects a real daemon and completes an isolated manual run without relay authority", async () => {
    const enrollment = await hub.connect();
    await hub.daemonIsConnected();
    const connected = await hub.status();
    const unrelatedAgent = await hub.createUnrelatedLocalAgent();
    await hub.installProductionConfiguration();

    const run = await hub.runManual("canonical-delivery", "payments");
    const completed = await hub.completedRun(run.executionId);
    const capabilityRun = await hub.runCapabilityTrigger("capability-delivery");
    const capability = await hub.completedCapabilityRun(capabilityRun.executionId);
    const denial = await hub.requestForbiddenOperation();
    const steerDenial = await hub.requestForbiddenSteer(unrelatedAgent);

    assert.equal(connected.state, "connected");
    assert.deepEqual(completed, {
      prompt: "Deploy requested for phase-five-operator",
      output: "phase-five:requested",
      status: "succeeded",
      daemonId: enrollment.daemonId,
      agentId: run.agentId,
    });
    assert.deepEqual(capability, {
      reply: "phase-five:mcp-capability",
      outputContext: {
        provider: "discord",
        guildId: "guild-original",
        channelId: "channel-original",
        threadId: "thread-original",
        messageId: "message-original",
      },
      replySucceeded: true,
      duplicateRejected: true,
      secretCompletionEnvPresent: false,
    });
    assert.equal(await hub.isUnrelatedAgentVisible(unrelatedAgent), false);
    assert.deepEqual(denial, {
      type: "rpc_error",
      requestType: "daemon.get_status.request",
      code: "access_denied",
    });
    assert.deepEqual(steerDenial, {
      type: "rpc_error",
      requestType: "send_agent_message_request",
      code: "access_denied",
    });
    assert.deepEqual(hub.relayEvidence(), {
      enabled: false,
      configuredOptions: [],
    });
    assert.equal(hub.daemonAttemptedRelayConnection(), false);

    await hub.disconnect();
    assert.equal((await hub.status()).state, "not_connected");
  }, 120_000);

  it("replays a lost create response across reconnection without duplicating the daemon agent", async () => {
    const enrollment = await hub.connect();
    await hub.daemonIsConnected();
    await hub.installProductionConfiguration();
    const run = await hub.beginAmbiguousManualRun();

    assert.deepEqual(run.beforeRestart, {
      receipts: 1,
      executions: 1,
      status: "running",
      daemonId: enrollment.daemonId,
      agentId: null,
    });

    await hub.recoverAmbiguousManualRun(run.executionId);
    const recovery = await hub.replayEvidence(run.executionId, run.providerEventReceiptId);
    assert.equal(recovery.executionAgentId, recovery.ownerMatchingAgentId);
    assert.deepEqual(recovery, {
      deliveryReceipts: 1,
      executions: 1,
      persistedDaemonAgents: 1,
      ownerMatchingAgentId: recovery.executionAgentId,
      ownerDaemonId: enrollment.daemonId,
      ownerMatchesAssociation: true,
      executionAgentId: recovery.executionAgentId,
      persistedAssociations: 1,
      createAttempts: 2,
      recoveredAgentId: recovery.executionAgentId,
      recoveredCurrentState: true,
    });

    await hub.allowRecoveredCompletion();
    const recovered = await hub.completedRun(run.executionId);

    assert.deepEqual(recovered, {
      prompt: "Deploy requested for phase-five-operator",
      output: "phase-five:requested",
      status: "succeeded",
      daemonId: enrollment.daemonId,
      agentId: recovery.ownerMatchingAgentId,
    });
  }, 120_000);

  it("fails the same owned running agent when a real daemon restart interrupts it", async () => {
    const enrollment = await hub.connect();
    await hub.daemonIsConnected();
    await hub.installProductionConfiguration();
    const run = await hub.beginDaemonRestartRun();

    const recovery = await hub.restartDaemonAndRecover(run.executionId);
    assert.deepEqual(recovery, {
      persistedDaemonAgents: 1,
      executionAgentId: run.agentId,
      ownerAgentId: run.agentId,
      ownerDaemonId: enrollment.daemonId,
      associationDaemonId: enrollment.daemonId,
      createAttempts: 2,
      promptAttempts: 1,
      recoveryCreateAttempts: 1,
      statusImmediatelyBeforeRestart: "running",
      recoveredStatusAfterRestart: "closed",
      executionStatus: "failed",
      executionResult: { status: "failed", reason: "agent_interrupted" },
    });
  }, 120_000);
});
