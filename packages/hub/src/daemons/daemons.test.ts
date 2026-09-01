import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import { DaemonDispatchFailure } from "./index.js";
import { DaemonCreateResponseLostError } from "./protocol.js";
import { ENROLLMENT_LIFETIME_MS } from "./registration.js";
import { HubHarness } from "./test-utils/hub-harness.js";
import { currentProjectConfigurationFiles } from "../test-utils/current-project-configuration.js";

describe("daemon enrollment and execution", () => {
  let hub: HubHarness;
  beforeEach(async () => {
    hub = await HubHarness.start();
  }, 120_000);
  afterEach(async () => {
    await hub.stop();
  }, 120_000);

  it("protects short-lived enrollment issuance and expires unused tokens deterministically", async () => {
    const missing = await hub.issueEnrollment("missing");
    const wrong = await hub.issueEnrollment("wrong");
    const issued = await hub.issueEnrollment();
    await hub.advanceEnrollmentBeyondExpiry();
    const expired = await hub.consumeLastEnrollment();

    assert.equal(issued.status, 201);
    assert.equal(hub.issuedEnrollmentLifetime(), ENROLLMENT_LIFETIME_MS);
    assert.deepEqual(
      { missing: missing.status, wrong: wrong.status, expired },
      { missing: 401, wrong: 401, expired: 401 },
    );
  });

  it("keeps the daemon credential private and records durable connected presence", async () => {
    const daemonId = await hub.connectDaemon();

    assert.deepEqual(await hub.enrollmentPrivacy(), {
      daemonHasCredential: true,
      databaseHasVerifierOnly: true,
    });
    const daemon = await hub.daemon(daemonId);
    assert.deepEqual(
      {
        id: daemon.id,
        status: daemon.status,
        presence: daemon.presence,
        connected: daemon.connectedAt !== null,
      },
      {
        id: daemonId,
        status: "active",
        presence: "connected",
        connected: true,
      },
    );
  });

  it("keeps a connected-only daemon online without execution permission", async () => {
    const daemonId = await hub.connectDaemon(undefined, []);
    const daemon = await hub.daemon(daemonId);

    assert.deepEqual(
      {
        permissions: daemon.permissions,
        presence: daemon.presence,
        connected: daemon.connectedAt !== null,
      },
      { permissions: [], presence: "connected", connected: true },
    );
  });

  it("lets the authenticated daemon update semantic permissions without reconnecting", async () => {
    const daemonId = await hub.connectDaemon(undefined, []);

    assert.equal(await hub.updateConnectedDaemonPermissions(["hub.execute"]), 200);
    assert.deepEqual((await hub.daemon(daemonId)).permissions, ["hub.execute"]);

    assert.equal(await hub.updateConnectedDaemonPermissions([]), 200);
    assert.deepEqual((await hub.daemon(daemonId)).permissions, []);
  });

  it("rejects permission changes that do not carry the daemon credential", async () => {
    const daemonId = await hub.connectDaemon(undefined, []);

    assert.equal(
      await hub.updateConnectedDaemonPermissions(["hub.execute"], "wrong-credential"),
      401,
    );
    assert.deepEqual((await hub.daemon(daemonId)).permissions, []);
  });

  it("maps a legacy enrollment scope to hub.execute at the compatibility boundary", async () => {
    const enrollment = await hub.enrollLegacyDaemon();

    assert.deepEqual(enrollment.scopes, ["hub.execution.*"]);
    assert.deepEqual((await hub.daemon(enrollment.daemonId)).permissions, ["hub.execute"]);
  });

  it("replays one enrollment ceremony with a stable daemon", async () => {
    const enrollment = await hub.connectWithEnrollmentReplay();

    assert.equal(enrollment.replayedDaemonId, enrollment.firstDaemonId);
    assert.deepEqual(
      { first: enrollment.firstSlug, replay: enrollment.replayedSlug },
      { first: "replay-host-local", replay: "replay-host-local" },
    );
    assert.deepEqual(
      {
        consumedTokenStatus: enrollment.consumedTokenStatus,
        persistedDaemons: enrollment.persistedDaemons,
      },
      { consumedTokenStatus: 401, persistedDaemons: 1 },
    );
  });

  it("derives unique default daemon slugs from the enrolling hostnames", async () => {
    const first = await hub.enrollDaemon("Studio Mac.local");
    const second = await hub.enrollDaemon("Studio Mac.local");

    assert.equal(first.slug, "studio-mac-local");
    assert.equal(second.slug, `studio-mac-local-${second.daemonId.slice(0, 8)}`);
  });

  it("rejects invalid and revoked credentials on reconnect", async () => {
    await hub.connectDaemon();
    assert.equal(await hub.invalidCredentialReconnectStatus(), 403);
    assert.equal(await hub.revokeDaemon(), 4403);
    assert.equal(await hub.revokedCredentialReconnectStatus(), 403);
  });

  it("replaces generations safely and records offline presence only for the current socket", async () => {
    const daemonId = await hub.connectDaemon();
    await hub.replaceDaemon();
    assert.equal((await hub.daemon(daemonId)).presence, "connected");

    await hub.disconnectDaemon();
    await hub.observeOfflinePresence();
    assert.equal((await hub.daemon(daemonId)).presence, "offline");
  });

  it("revokes the active daemon with code 4403 and persists revoked offline presence", async () => {
    const daemonId = await hub.connectDaemon();
    const closeCode = await hub.revokeDaemon();

    assert.equal(closeCode, 4403);
    const daemon = await hub.daemon(daemonId);
    assert.deepEqual(
      { status: daemon.status, presence: daemon.presence },
      { status: "revoked", presence: "offline" },
    );
  });

  it("dispatches through the daemon and persists the daemon agent association", async () => {
    const daemonId = await hub.connectDaemon();
    const result = await hub.dispatch();
    const execution = await hub.execution(result.execution.id);

    assert.deepEqual(
      {
        status: execution.status,
        daemonId: execution.daemonId,
        daemonAgentId: execution.daemonAgentId,
      },
      { status: "running", daemonId: daemonId, daemonAgentId: result.agentId },
    );
    const agent = hub.createdAgentLaunch();
    assert.deepEqual({ worktree: agent.worktree }, { worktree: undefined });
    assert.equal(agent.cwd, "/workspace");
    assert.equal(agent.prompt, "Reply pong.");
    assert.equal(agent.thinkingOptionId, "xhigh");
    assert.deepEqual(agent.toolPolicy, {
      preapproved: [{ kind: "mcp", server: "hub", tool: "finish_execution" }],
    });
    assert.deepEqual(agent.env, {
      USER_DEFINED: "yes",
      PASEO_AGENT_PROVIDER: "opencode",
      PASEO_AGENT_MODE: "full-access",
      PASEO_HUB_CONFIG_JSON: JSON.stringify({
        triggers: [{ name: "discord-ping" }],
      }),
    });
    assert.deepEqual(agent.mcpServers, {
      hub: {
        type: "http",
        url: `${hub.originUrl()}/agent-executions/${result.execution.id}/mcp`,
        headers: { Authorization: "Bearer <private>" },
      },
    });
  });

  it("does not infer GitHub authority from a GitHub trigger source", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      triggerContext: { provider: "github", deliveryId: "github-authority" },
    });
    const launchEnv = hub.createdAgentLaunch().env;
    assert.ok(isRecord(launchEnv));

    assert.equal(launchEnv["GH_TOKEN"], undefined);
    assert.equal(launchEnv["GIT_CONFIG_COUNT"], undefined);
    assert.equal((await hub.execution(result.execution.id)).launchIntent?.github, undefined);
    assert.deepEqual(hub.authorityMintInputs(), []);
  });

  it("identifies available Hub MCP tools through daemon-native channels", async () => {
    await hub.connectDaemon();

    await hub.dispatch({
      outputContext: { provider: "discord", channelId: "channel-1" },
    });
    assert.equal(hub.createdAgentLaunch().prompt, "Reply pong.");
    assert.deepEqual(hub.createdAgentLaunch().toolPolicy, {
      preapproved: [
        { kind: "mcp", server: "hub", tool: "finish_execution" },
        { kind: "mcp", server: "hub", tool: "reply" },
      ],
    });

    await hub.dispatch({
      outputContext: { provider: "manual", channelId: "channel-1" },
    });
    assert.equal(hub.createdAgentLaunch().prompt, "Reply pong.");
    assert.deepEqual(hub.createdAgentLaunch().toolPolicy, {
      preapproved: [{ kind: "mcp", server: "hub", tool: "finish_execution" }],
    });
  });

  it("passes provider options unchanged and keeps an omitted mode omitted", async () => {
    await hub.connectDaemon();
    const options = {
      sandbox_workspace_write: {
        writable_roots: ["/var/cache/npm"],
        network_access: false,
      },
    };

    const result = await hub.dispatch({
      agent: { provider: "codex", options },
      allowOutputs: [],
    });
    const launch = hub.createdAgentLaunch();
    const persisted = await hub.execution(result.execution.id);

    assert.equal(launch.modeId, undefined);
    assert.deepEqual(launch.providerOptions, options);
    assert.deepEqual(persisted.launchIntent?.agent, { provider: "codex", options });
    assert.equal(isRecord(launch.env) ? launch.env["PASEO_AGENT_MODE"] : undefined, undefined);
  });

  it("surfaces daemon provider-option validation at the authored YAML path", async () => {
    await hub.connectDaemon();
    hub.rejectNextCreate({
      code: "provider_options_invalid",
      provider: "codex",
      issues: [
        {
          path: ["sandbox_workspace_write", "network-access"],
          message: "Expected boolean, received string",
        },
      ],
      message:
        "Invalid providerOptions for 'codex': providerOptions.sandbox_workspace_write.network_access: Expected boolean, received string",
    });

    const handedOff = await hub.handoff({
      agent: {
        provider: "codex",
        options: { sandbox_workspace_write: { network_access: "sometimes" } },
      },
    });
    const failed = await hub.waitForExecutionStatus(handedOff.execution.id, "failed");

    assert.deepEqual(failed.result, {
      status: "failed",
      reason:
        "provider 'codex': agent.options.sandbox_workspace_write[\"network-access\"]: Expected boolean, received string",
    });
  });

  it("surfaces unsupported exact MCP preapproval without waiting for a timeout", async () => {
    await hub.connectDaemon();
    hub.rejectNextCreate({
      code: "tool_policy_unsupported",
      provider: "test-provider",
      message: "Provider test-provider does not support exact MCP tool preapproval",
    });

    const handedOff = await hub.handoff({ agent: { provider: "test-provider" } });
    const failed = await hub.waitForExecutionStatus(handedOff.execution.id, "failed");

    assert.deepEqual(failed.result, {
      status: "failed",
      reason:
        "tool_policy_unsupported: Provider test-provider does not support exact MCP tool preapproval",
    });
  });

  it("keeps the authored prompt exact while exposing the capability inventory through MCP", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      outputContext: { provider: "discord", channelId: "channel-1" },
    });

    assert.equal(hub.createdAgentLaunch().prompt, "Reply pong.");
    assert.deepEqual(
      (await hub.listExecutionTools(result.execution.id)).map(({ name, description }) => ({
        name,
        description,
      })),
      [
        {
          name: "finish_execution",
          description: "Completes this execution and records its optional structured output.",
        },
        {
          name: "reply",
          description:
            "Sends a reply to the conversation that triggered this execution. (up to 1 times).",
        },
      ],
    );
  });

  it("renders the structured classifier MCP contract sent to the daemon", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      prompt: "Classify the request.",
      allowOutputs: [],
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["repo"],
        properties: { repo: { type: "string", enum: ["paseo", "hub"] } },
      },
    });

    const launch = hub.createdAgentLaunch();
    const exposedTools = await hub.listExecutionTools(result.execution.id);

    assert.deepEqual(
      exposedTools.map(({ name, description }) => ({ name, description })),
      [
        {
          name: "finish_execution",
          description: "Completes this execution and records the configured structured output.",
        },
      ],
    );
    assert.equal(launch.prompt, "Classify the request.");
    assert.deepEqual(exposedTools[0]?.inputSchema, {
      type: "object",
      additionalProperties: false,
      required: ["output"],
      properties: {
        output: {
          $id: "urn:paseo:hub:finish-execution-output",
          type: "object",
          additionalProperties: false,
          required: ["repo"],
          properties: { repo: { type: "string", enum: ["paseo", "hub"] } },
        },
      },
    });
  });

  it("installs and routes the exact current-project bundle from a real Slack event", async () => {
    await hub.connectDaemon();
    await hub.renameConnectedDaemon("local");
    const slackConnectionId = await hub.seedCurrentProjectResources();

    const installed = await hub.installBundle({ files: await currentProjectConfigurationFiles() });
    assert.equal(installed.status, 201, JSON.stringify(installed));
    const delivered = await hub.deliverCurrentProjectSlackMention(slackConnectionId);
    assert.equal(delivered.status, 200);

    await hub.waitForCreatedAgentRequests(1);
    const classifier = await hub.waitForPendingExecution();
    const classifierLaunch = hub.createdAgentLaunch();
    assert.equal(classifierLaunch.provider, "claude");
    assert.equal(classifierLaunch.modeId, "bypassPermissions");
    assert.equal(classifierLaunch.cwd, "/workspace/hub");
    assert.equal(
      classifierLaunch.prompt,
      "Choose one configured repository environment and one complete named agent configuration.\n\n<@UBOT> investigate the routing failure",
    );
    assert.deepEqual(
      (await hub.listExecutionTools(classifier.id)).map(({ name }) => name),
      ["finish_execution"],
    );

    const completion = await hub.callExecutionTool(classifier.id, "finish_execution", {
      output: { environment: "paseo", agent: "codex" },
    });
    assert.equal(completion["error"], undefined);
    assert.equal(toolResultIsError(completion), undefined, JSON.stringify(completion));
    await hub.drainWorkflowOutbox();
    await hub.drainWorkflowOutbox();
    assert.deepEqual(await hub.workflowExecutionState(classifier.id), {
      executionStatus: "succeeded",
      stepStatus: "succeeded",
      stepOutput: { environment: "paseo", agent: "codex" },
      stepFailure: null,
      runStatus: "running",
      runFailure: null,
    });
    await hub.waitForCreatedAgentRequests(2);
    const worker = await hub.waitForPendingExecution();
    const workerLaunch = hub.createdAgentLaunch();
    assert.equal(workerLaunch.provider, "codex");
    assert.equal(workerLaunch.cwd, "/workspace/paseo");
    assert.equal(workerLaunch.prompt, "<@UBOT> investigate the routing failure");
    assert.equal(workerLaunch.thinkingOptionId, "xhigh");
    assert.deepEqual(workerLaunch.providerOptions, {
      sandbox_workspace_write: {
        writable_roots: ["/var/cache/npm"],
        network_access: false,
      },
    });
    assert.deepEqual(
      (await hub.listExecutionTools(worker.id)).map(({ name }) => name),
      ["finish_execution", "reply"],
    );
  });

  it("deduplicates durable fan-out per configured trigger match", async () => {
    await hub.connectDaemon();
    await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });

    const first = await hub.handoff({ triggerName: "first" });
    await hub.spawnBegins();
    const duplicate = await hub.handoff({ triggerName: "first" }, first.providerEventReceiptId);
    const second = await hub.handoff({ triggerName: "second" }, first.providerEventReceiptId);
    await hub.waitForRecoveredExecution(second.execution.id);

    assert.equal(duplicate.execution.id, first.execution.id);
    assert.notEqual(second.execution.id, first.execution.id);
    assert.equal(await hub.pendingExecutionCount(), 2);
    assert.equal(hub.createdAgentRequestCount(), 2);
  });

  it("resumes persisted but unlaunched durable fan-out on retry", async () => {
    await hub.connectDaemon();
    await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });
    const persisted = await hub.persistUnlaunchedBatch(["first", "second"], 1);

    assert.equal(hub.createdAgentRequestCount(), 0);
    const retried = await hub.handoffBatch(["first", "second"], persisted.providerEventReceiptId);
    await Promise.all(
      retried.executions.map((execution) => hub.waitForRecoveredExecution(execution.id)),
    );

    assert.equal(await hub.pendingExecutionCount(), 2);
    assert.equal(hub.createdAgentRequestCount(), 2);
    await hub.handoffBatch(["first", "second"], persisted.providerEventReceiptId);
    assert.equal(hub.createdAgentRequestCount(), 2);
  });

  it("materializes provider-owned environment values without rewriting the authored prompt", async () => {
    const daemonId = await hub.connectDaemon();
    await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });
    hub.holdLaunchMaterialization();

    try {
      const handedOff = await hub.handoff({
        prompt: "token=<secret>",
        environment: {
          kind: "daemon",
          daemonId,
          authoredSlug: hub.connectedDaemonSlug(),
          cwd: "/workspace",
          env: { TOKEN: "<secret>" },
          worktree: { mode: "checkout-branch", branch: "branch-<secret>" },
        },
      });
      const persisted = await hub.execution(handedOff.execution.id);

      assert.equal(hub.createdAgentRequestCount(), 0);
      assert.equal(persisted.launchIntent?.prompt, "token=<secret>");
      assert.deepEqual(persisted.launchIntent?.environment.env, {
        TOKEN: "<secret>",
      });
      assert.deepEqual(persisted.launchIntent?.environment.worktree, {
        mode: "checkout-branch",
        branch: "branch-<secret>",
      });

      hub.releaseLaunchMaterialization();
      await hub.waitForRecoveredExecution(handedOff.execution.id);
      assert.equal(hub.createdAgentLaunch().prompt, "token=<secret>");
      assert.equal(Reflect.get(Object(hub.createdAgentLaunch().env), "TOKEN"), "resolved-secret");
      assert.deepEqual(hub.createdAgentLaunch().worktree, {
        mode: "checkout-branch",
        branch: "branch-resolved-secret",
      });
      assert.equal(hub.launchMaterializationCount(), 1);
    } finally {
      hub.releaseLaunchMaterialization();
    }
  });

  it("materializes step authority only at the durable daemon launch boundary", async () => {
    await hub.connectDaemon();
    const handedOff = await hub.handoff({
      env: {
        SOME_TOKEN: "prefix-${{ paseo.connections.some-connection.token }}",
      },
      github: {
        connection: "getpaseo-github",
        repositories: ["getpaseo/paseo"],
        permissions: { contents: "write", pull_requests: "write" },
        durationMs: 60 * 60 * 1000,
      },
      triggerContext: { provider: "manual", deliveryId: "authority-durable" },
    });

    const persisted = await hub.execution(handedOff.execution.id);
    const persistedIntent = JSON.stringify(persisted.launchIntent);
    assert.match(persistedIntent, /paseo\.connections\.some-connection\.token/iu);
    assert.doesNotMatch(persistedIntent, /resolved-secret|durable-scoped-token/iu);
    assert.deepEqual(persisted.launchIntent?.env, {
      SOME_TOKEN: "prefix-${{ paseo.connections.some-connection.token }}",
    });
    assert.deepEqual(persisted.launchIntent?.github, {
      connection: "getpaseo-github",
      repositories: ["getpaseo/paseo"],
      permissions: { contents: "write", pull_requests: "write" },
      durationMs: 60 * 60 * 1000,
    });

    const launch = await hub.waitForCreatedAgentLaunch();
    const launchEnv = launch.env;
    assert.ok(isRecord(launchEnv));
    assert.equal(launchEnv["SOME_TOKEN"], "prefix-resolved-secret");
    assert.equal(launchEnv["GH_TOKEN"], "durable-scoped-token-1");
    assert.equal(launchEnv["GIT_CONFIG_COUNT"], "5");
    assert.deepEqual(hub.authorityMintInputs(), [
      {
        projectId: "00000000-0000-4000-8000-000000000001",
        connectionSlug: "getpaseo-github",
        repositories: ["getpaseo/paseo"],
        permissions: { contents: "write", pull_requests: "write" },
      },
    ]);

    assert.equal(await hub.completeExecution(handedOff.execution.id), 200);
    assert.deepEqual(hub.authorityRevokedTokens(), ["durable-scoped-token-1"]);
  });

  it("reconstructs authority on graceful restart and revokes the old lease before recovery remints", async () => {
    await hub.connectDaemon();
    await hub.handoff({
      github: {
        connection: "getpaseo-github",
        repositories: ["getpaseo/paseo"],
        permissions: { contents: "write" },
        durationMs: 60 * 60 * 1000,
      },
    });
    await hub.waitForCreatedAgentLaunch();
    assert.deepEqual(hub.authorityRevokedTokens(), []);

    await hub.restartApp();
    await hub.waitForCreatedAgentRequests(2);

    assert.deepEqual(hub.authorityRevokedTokens(), ["durable-scoped-token-1"]);
    assert.equal(hub.authorityMintInputs().length, 2);
    assert.equal(hub.createdAgentRequestCount(), 2);
  });

  it("bounds Hub shutdown when terminal cleanup follows a permanently unresolved authority mint", async () => {
    await hub.connectDaemon();
    hub.issueConnectionLeaseOnAuthorityMaterialization();
    hub.hangAuthorityMintPermanently();
    const dispatch = hub.beginDispatch({
      env: { TOKEN: "${{ paseo.connections.some-connection.token }}" },
      github: {
        connection: "getpaseo-github",
        repositories: ["getpaseo/paseo"],
        permissions: { contents: "read" },
        durationMs: 60 * 60 * 1000,
      },
    });
    const dispatchOutcome = dispatch.then(
      () => undefined,
      (error: unknown) => error,
    );
    const execution = await hub.waitForPendingExecution();
    await hub.waitForAuthorityMint();

    await hub.advanceDispatchTime(30_000);
    await hub.waitForAuthorityRevocation();
    assert.deepEqual(hub.authorityRevokedTokens(), ["durable-connection-token"]);

    const shutdownStartedAt = Date.now();
    await hub.stopRuntimeResources();
    const shutdownElapsedMs = Date.now() - shutdownStartedAt;
    const stopResult = await hub.authorityStopResult();

    assert.ok(shutdownElapsedMs < 15_000, `Hub shutdown took ${shutdownElapsedMs}ms`);
    assert.ok((await dispatchOutcome) instanceof DaemonDispatchFailure);
    assert.equal(hub.createdAgentRequestCount(), 0);
    assert.deepEqual(stopResult, {
      residualExposures: [
        {
          executionId: execution.id,
          leaseCount: 0,
          pendingMaterializations: 1,
        },
      ],
    });
    assert.equal(JSON.stringify(stopResult).includes("durable-connection-token"), false);
    assert.equal(JSON.stringify(stopResult).includes("durable-scoped-token"), false);
  }, 30_000);

  it("preserves literal worktree evidence during restart recovery", async () => {
    const daemonId = await hub.connectDaemon();
    await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });
    const persisted = await hub.persistUnlaunchedBatch(["recovery"], 1, {
      prompt: "token=<secret>",
      environment: {
        kind: "daemon",
        daemonId,
        authoredSlug: hub.connectedDaemonSlug(),
        cwd: "/workspace",
        env: { TOKEN: "<secret>" },
        worktree: {
          mode: "checkout-branch",
          branch: "branch-static",
        },
      },
      triggerContext: {
        provider: "manual-discord",
        deliveryId: "durable-delivery",
        event: { manual: { delivery_id: "durable-delivery" } },
      },
    });
    assert.equal(persisted.executions[0]?.launchIntent?.prompt, "token=<secret>");
    assert.equal(await hub.triggerPrompt(persisted.providerEventReceiptId), "token=<secret>");
    assert.deepEqual(persisted.executions[0]?.launchIntent?.environment.worktree, {
      mode: "checkout-branch",
      branch: "branch-static",
    });
    assert.equal(
      JSON.stringify(persisted.executions[0]?.launchIntent).includes("mcpServers"),
      false,
    );
    assert.equal(JSON.stringify(persisted.executions[0]?.launchIntent).includes("Bearer "), false);

    await hub.restartApp();
    const execution = persisted.executions[0];
    assert(execution !== undefined);
    await hub.waitForRecoveredExecution(execution.id);

    assert.equal(hub.createdAgentLaunch().prompt, "token=<secret>");
    assert.equal(Reflect.get(Object(hub.createdAgentLaunch().env), "TOKEN"), "resolved-secret");
    assert.deepEqual(hub.createdAgentLaunch().worktree, {
      mode: "checkout-branch",
      branch: "branch-static",
    });
    assert.deepEqual(hub.createdAgentLaunch().mcpServers, {
      hub: {
        type: "http",
        url: `${hub.originUrl()}/agent-executions/${execution.id}/mcp`,
        headers: { Authorization: "Bearer <private>" },
      },
    });
    assert.equal(hub.launchMaterializationCount(), 1);
  });

  it("does not materialize a stale recovery candidate after it becomes terminal", async () => {
    await hub.connectDaemon();
    await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });
    const persisted = await hub.persistUnlaunchedBatch(["recovery"]);
    const execution = persisted.executions[0];
    assert(execution !== undefined);
    hub.holdRecoveryRefresh(execution.id);

    const restart = hub.restartApp();
    await hub.recoveryRefreshBegins();
    await hub.terminateExecutionDirectly(execution.id);
    hub.releaseRecoveryRefresh();
    await restart;

    assert.equal(hub.createdAgentRequestCount(), 0);
    assert.equal(hub.launchMaterializationCount(), 0);
  });

  it.each([
    ["current slug first", ["<connected>", "stale-authored-slug"]],
    ["stale slug first", ["stale-authored-slug", "<connected>"]],
  ])(
    "dispatches by immutable daemon ID regardless of authored slug evidence: %s",
    async (_label, slugs) => {
      await hub.connectDaemon();
      await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });

      const batch = await hub.handoffAuthoredSlugBatch(slugs);
      assert.equal(batch.executions.length, 2);
      assert.equal(
        batch.executions.every((execution) => execution.machineId !== null),
        true,
      );
      await Promise.all(
        batch.executions.map((execution) => hub.waitForRecoveredExecution(execution.id)),
      );
      assert.equal(hub.createdAgentRequestCount(), 2);
      assert.equal(hub.failureHookCount(), 0);

      const retried = await hub.handoffAuthoredSlugBatch(slugs, batch.providerEventReceiptId);
      assert.equal(retried.executions.length, 2);
      assert.equal(hub.createdAgentRequestCount(), 2);
      assert.equal(hub.failureHookCount(), 0);
    },
  );

  it("publishes lifecycle hooks once for the complete durable fan-out", async () => {
    await hub.connectDaemon();
    await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });

    const batch = await hub.handoffBatch(["first", "second"]);
    const [first, second] = await Promise.all(
      batch.executions.map((execution) => hub.waitForRecoveredExecution(execution.id)),
    );
    assert(first?.daemonAgentId !== null && first?.daemonAgentId !== undefined);
    assert(second?.daemonAgentId !== null && second?.daemonAgentId !== undefined);

    await hub.startExecution(first.daemonAgentId);
    await hub.completeExecution(first.id);
    await hub.waitForCompletionHookCount(1);
    assert.equal(hub.hookContexts().completed.length, 1);

    await hub.startExecution(second.daemonAgentId);
    assert.equal(hub.hookContexts().started.length, 0);
    await hub.completeExecution(second.id);
    await hub.waitForCompletionHookCount(2);
    assert.equal(hub.hookContexts().completed.length, 2);
    assert.equal(hub.failureHookCount(), 0);
  });

  it("publishes only failure when a durable fan-out has mixed results", async () => {
    await hub.connectDaemon();
    await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });

    const batch = await hub.handoffBatch(["first", "second"]);
    const [first, second] = await Promise.all(
      batch.executions.map((execution) => hub.waitForRecoveredExecution(execution.id)),
    );
    assert(first?.daemonAgentId !== null && first?.daemonAgentId !== undefined);
    assert(second?.daemonAgentId !== null && second?.daemonAgentId !== undefined);

    await hub.completeExecution(first.id);
    await hub.waitForCompletionHookCount(1);
    assert.equal(hub.hookContexts().completed.length, 1);
    await hub.agentTerminates(second.id, second.daemonAgentId, "error");
    await hub.failureNotified();

    assert.equal(hub.failureHookCount(), 1);
    assert.equal(hub.hookContexts().completed.length, 1);
  });

  it.each([
    [
      {
        mode: "branch-off",
        newBranch: "hub-delivery-1",
        base: "main",
      },
      { mode: "branch-off", newBranch: "hub-delivery-1", base: "main" },
      false,
    ],
    [
      {
        mode: "checkout-branch",
        branch: "release-delivery-1",
      },
      { mode: "checkout-branch", branch: "release-delivery-1" },
      true,
    ],
    [{ mode: "checkout-pr", prNumber: 42 }, { mode: "checkout-pr", prNumber: 42 }, false],
  ] as const)(
    "serializes configured worktree target %# without trigger policy",
    async (configured, expected, autoArchive) => {
      const daemonId = await hub.connectDaemon();
      const result = await hub.dispatchWithWorktree(configured, autoArchive);
      const launch = hub.createdAgentLaunch();
      const execution = await hub.execution(result.execution.id);

      assert.deepEqual({ worktree: launch.worktree }, { worktree: expected });
      assert.equal(execution.launchIntent?.autoArchive, autoArchive);
      assert.deepEqual(
        { daemon: execution.daemonId, agent: execution.daemonAgentId },
        { daemon: daemonId, agent: result.agentId },
      );
    },
  );

  it("dispatches after generation replacement through the surviving socket", async () => {
    const daemonId = await hub.connectDaemon();
    await hub.replaceDaemon();
    const result = await hub.dispatch();
    const execution = await hub.execution(result.execution.id);

    assert.deepEqual(
      { daemon: execution.daemonId, agent: execution.daemonAgentId },
      { daemon: daemonId, agent: result.agentId },
    );
  });

  it("retains one auto-archive cleanup for terminal activity before spawn acknowledgement", async () => {
    const daemonId = await hub.connectDaemon();
    hub.holdSpawnAcknowledgement();
    const dispatch = hub.beginDispatch({ autoArchive: true });
    void dispatch.catch(() => undefined);
    await hub.spawnBegins();
    const pending = await hub.pendingExecution();

    const agentId = hub.interruptPendingSpawn();
    hub.interruptPendingSpawn();
    await hub.failureNotified();
    const action = await hub.acceptSpawnAndObserveControl(pending.id);
    await dispatch.catch(() => undefined);

    const execution = await hub.execution(pending.id);
    assert.deepEqual(
      {
        status: execution.status,
        daemon: execution.daemonId,
        agent: execution.daemonAgentId,
        hubAction: execution.hubAction,
        hubActionCompleted: execution.hubActionCompletedAt !== null,
        action,
        actions: hub.controlActions(),
        failureNotifications: hub.failureHookCount(),
      },
      {
        status: "failed",
        daemon: daemonId,
        agent: agentId,
        hubAction: "archive",
        hubActionCompleted: true,
        action: "archive",
        actions: ["archive"],
        failureNotifications: 1,
      },
    );
  });

  it("retains MCP completion cleanup before spawn acknowledgement", async () => {
    const daemonId = await hub.connectDaemon();
    hub.holdSpawnAcknowledgement();
    const dispatch = hub.beginDispatch({ autoArchive: true });
    await hub.spawnBegins();
    const pending = await hub.pendingExecution();

    assert.equal(await hub.completeExecution(pending.id), 200);
    assert.deepEqual(hub.controlActions(), []);
    await hub.completeCurrentTurn(`agent-${pending.id}`);
    await hub.pendingControlAction(pending.id);
    await hub.completePendingCleanup();

    const completed = await hub.execution(pending.id);
    assert.deepEqual(
      {
        status: completed.status,
        daemon: completed.daemonId,
        agent: completed.daemonAgentId,
        hubAction: completed.hubAction,
        hubActionCompleted: completed.hubActionCompletedAt !== null,
        actions: hub.controlActions(),
      },
      {
        status: "succeeded",
        daemon: daemonId,
        agent: null,
        hubAction: "archive",
        hubActionCompleted: true,
        actions: ["archive"],
      },
    );
    hub.acceptSpawn();
    await dispatch;
  });

  it("retains deadline cleanup when spawn never materializes", async () => {
    const daemonId = await hub.connectDaemon();
    hub.holdSpawnAcknowledgement();
    hub.leaveSpawnUnmaterialized();
    const dispatch = hub.beginDispatch({ autoArchive: true, timeoutMs: 1_000 });
    void dispatch.catch(() => undefined);
    await hub.spawnBegins();
    const pending = await hub.pendingExecution();

    await hub.advanceDispatchTime(1_000);
    await assert.rejects(dispatch);

    const expired = await hub.execution(pending.id);
    assert.deepEqual(
      {
        status: expired.status,
        daemon: expired.daemonId,
        agent: expired.daemonAgentId,
        hubAction: expired.hubAction,
        hubActionCompleted: expired.hubActionCompletedAt !== null,
        actions: hub.controlActions(),
        agents: hub.createdAgentCount(),
      },
      {
        status: "failed",
        daemon: daemonId,
        agent: null,
        hubAction: "archive",
        hubActionCompleted: true,
        actions: ["archive"],
        agents: 0,
      },
    );
  });

  it.each(["closed", "error"] as const)(
    "retains cleanup when ambiguous recovery returns %s snapshot",
    async (status) => {
      const daemonId = await hub.connectDaemon();
      hub.holdSpawnAcknowledgement();
      const dispatch = hub.beginDispatch({ autoArchive: true });
      void dispatch.catch(() => undefined);
      await hub.spawnBegins();
      const pending = await hub.pendingExecution();
      hub.markPendingSpawnInterrupted(status);

      await hub.restartApp();
      await assert.rejects(dispatch, DaemonCreateResponseLostError);
      await hub.failureNotified();
      await hub.completePendingCleanup(daemonId);

      const recovered = await hub.execution(pending.id);
      assert.deepEqual(
        {
          status: recovered.status,
          daemon: recovered.daemonId,
          hubAction: recovered.hubAction,
          hubActionCompleted: recovered.hubActionCompletedAt !== null,
          actions: hub.controlActions(),
          failureNotifications: hub.failureHookCount(),
        },
        {
          status: "failed",
          daemon: daemonId,
          hubAction: "archive",
          hubActionCompleted: true,
          actions: ["archive"],
          failureNotifications: 1,
        },
      );
    },
  );

  it("recovers an ambiguous production create after replacement without another daemon agent", async () => {
    const daemonId = await hub.connectDaemon();
    await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });
    hub.holdSpawnAcknowledgement();
    const dispatch = hub.beginManual({ deliveryKey: "ambiguous-recovery" });
    void dispatch.catch(() => undefined);
    await hub.spawnBegins();
    hub.omitAgentSnapshotOnReconnect();
    const pending = await hub.pendingExecution();
    assert.deepEqual(
      {
        status: (await hub.execution(pending.id)).status,
        daemon: (await hub.execution(pending.id)).daemonId,
        agent: (await hub.execution(pending.id)).daemonAgentId,
      },
      { status: "spawning", daemon: daemonId, agent: null },
    );

    await hub.restartApp();
    await dispatch;

    const recovered = await hub.waitForRecoveredExecution(pending.id);
    assert.deepEqual(
      {
        status: recovered.status,
        daemon: recovered.daemonId,
        agent: recovered.daemonAgentId,
        daemonAgents: hub.createdAgentCount(),
        createAttempts: hub.createdAgentRequestCount(),
      },
      {
        status: "running",
        daemon: daemonId,
        agent: `agent-${pending.id}`,
        daemonAgents: 1,
        createAttempts: 2,
      },
    );
  });

  it("retries a durable create after live daemon replacement rejects the active request", async () => {
    await hub.connectDaemon();
    await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });
    hub.holdSpawnAcknowledgement();
    const batch = await hub.handoffBatch(["live-replacement-recovery"]);
    await hub.spawnBegins();
    const pending = batch.executions[0];
    assert(pending !== undefined);

    assert.equal(pending.daemonAgentId, null);
    await hub.replaceDaemon({ acceptSpawns: true });

    await hub.waitForRecoveredExecution(pending.id);
    const recovered = await hub.waitForExecutionStatus(pending.id, "running");
    assert.equal(recovered.status, "running");
    assert.equal(hub.createdAgentRequestCount(), 2);
    assert.equal(hub.createdAgentCount(), 1);
  });

  it("keeps an ambiguous direct create nonterminal when its socket closes", async () => {
    const daemonId = await hub.connectDaemon();
    hub.holdSpawnAcknowledgement();
    const dispatch = hub.beginDispatch();
    void dispatch.catch(() => undefined);
    await hub.spawnBegins();
    const pending = await hub.pendingExecution();

    await hub.disconnectDaemon();

    await assert.rejects(dispatch, DaemonCreateResponseLostError);
    assert.deepEqual(
      {
        status: (await hub.execution(pending.id)).status,
        daemon: (await hub.execution(pending.id)).daemonId,
        agent: (await hub.execution(pending.id)).daemonAgentId,
      },
      { status: "spawning", daemon: daemonId, agent: null },
    );
  });

  it("keeps the socket usable after prior execution cleanup unsubscribes", async () => {
    await hub.connectDaemon();
    const first = await hub.dispatch();
    assert.equal(await hub.completeExecution(first.execution.id), 200);

    const second = await hub.dispatch();
    assert.equal((await hub.execution(second.execution.id)).status, "running");
  });

  it("authenticates MCP completion and rejects a duplicate after termination", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch();
    await hub.startExecution(result.agentId);
    assert.equal(await hub.completeExecution(result.execution.id, "missing"), 401);
    assert.equal(await hub.completeExecution(result.execution.id, "wrong"), 401);
    assert.equal(await hub.completeExecution(result.execution.id), 200);
    assert.equal(await hub.completeExecution(result.execution.id), 409);
    assert.equal((await hub.execution(result.execution.id)).status, "succeeded");
    assert.equal(hub.terminalHookCount(), 1);
  });

  it("finishes through the execution MCP using the existing completion lifecycle", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch();
    await hub.startExecution(result.agentId);

    const response = await hub.callExecutionTool(result.execution.id, "finish_execution", {});

    assert.equal(response["error"], undefined);
    assert.equal((await hub.execution(result.execution.id)).status, "succeeded");
    assert.equal(hub.terminalHookCount(), 1);
  });

  it("keeps a required output completion recoverable through the application MCP route", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      allowOutputs: [{ type: "discord.reply", max: 1, required: true }],
      outputContext: { provider: "discord", channelId: "channel-1", messageId: "message-1" },
    });
    await hub.startExecution(result.agentId);

    const missing = await hub.callExecutionTool(result.execution.id, "finish_execution", {});
    assert.equal(toolResultIsError(missing), true);
    assert.equal((await hub.execution(result.execution.id)).status, "running");

    const reply = await hub.callExecutionTool(result.execution.id, "reply", {
      content: "hello",
    });
    assert.equal(reply["error"], undefined);

    const completed = await hub.callExecutionTool(result.execution.id, "finish_execution", {});
    assert.equal(completed["error"], undefined);
    assert.equal(toolResultIsError(completed), undefined);
    assert.equal((await hub.execution(result.execution.id)).status, "succeeded");
  });

  it("archives an associated run after successful auto-archive completion", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({ autoArchive: true });

    assert.equal(await hub.completeExecution(result.execution.id), 200);
    assert.equal(await hub.completeExecution(result.execution.id), 409);
    assert.deepEqual(hub.controlActions(), []);
    assert.equal((await hub.execution(result.execution.id)).hubActionReadyAt, null);
    await hub.completeCurrentTurn(result.agentId);
    await hub.pendingControlAction(result.execution.id);
    await hub.completePendingCleanup();
    await hub.completeCurrentTurn(result.agentId);
    await hub.waitForCompletionHookCount(1);

    const execution = await hub.execution(result.execution.id);
    assert.deepEqual(hub.controlActions(), ["archive"]);
    assert.equal(hub.hookContexts().completed.length, 1);
    assert.equal(execution.hubAction, "archive");
    assert.notEqual(execution.hubActionCompletedAt, null);
  });

  it("waits for the provider turn acknowledgement after the MCP completion response", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({ autoArchive: true });
    hub.holdCompletionHook();

    const completion = hub.completeExecution(result.execution.id);
    await hub.waitForCompletionHookCount(1);

    assert.deepEqual(hub.controlActions(), []);
    assert.equal((await hub.execution(result.execution.id)).hubActionCompletedAt, null);

    hub.releaseCompletionHook();
    assert.equal(await completion, 200);
    assert.deepEqual(hub.controlActions(), []);
    await hub.completeCurrentTurn(result.agentId);
    await hub.pendingControlAction(result.execution.id);
    await hub.completePendingCleanup();
    assert.deepEqual(hub.controlActions(), ["archive"]);
    assert.notEqual((await hub.execution(result.execution.id)).hubActionCompletedAt, null);
  });

  it("keeps MCP finish completion durable when the response acknowledgement is lost", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({ autoArchive: true });

    assert.equal(await hub.completeExecution(result.execution.id), 200);
    const completed = await hub.execution(result.execution.id);
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.hubActionAcknowledgements.finishExecutionCall?.callId, null);
    assert.equal(completed.hubActionAcknowledgements.finishExecutionCall?.status, "completed");
    assert.equal(completed.hubActionReadyAt, null);
    assert.equal(completed.hubActionCompletedAt, null);
    assert.equal(await hub.completeExecution(result.execution.id), 409);

    await hub.completeCurrentTurnWithoutFinishTimeline(result.agentId);
    await hub.pendingControlAction(result.execution.id);
    await hub.completePendingCleanup();

    const archived = await hub.execution(result.execution.id);
    assert.deepEqual(hub.controlActions(), ["archive"]);
    assert.equal(archived.hubActionAcknowledgements.finishExecutionCall?.status, "completed");
    assert.notEqual(archived.hubActionReadyAt, null);
    assert.notEqual(archived.hubActionCompletedAt, null);
  });

  it("completes successful non-archived runs without daemon control", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({ autoArchive: false });

    assert.equal(await hub.completeExecution(result.execution.id), 200);
    await hub.completionHookBegins();

    const execution = await hub.execution(result.execution.id);
    assert.deepEqual(hub.controlActions(), []);
    assert.equal(execution.hubAction, null);
    assert.notEqual(execution.hubActionCompletedAt, null);
  });

  it("keeps archival pending until a provider acknowledgement after daemon reconnect", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({ autoArchive: true });
    await hub.disconnectDaemon();

    assert.equal(await hub.completeExecution(result.execution.id), 200);
    assert.equal((await hub.execution(result.execution.id)).hubActionCompletedAt, null);
    assert.equal((await hub.execution(result.execution.id)).hubActionReadyAt, null);

    await hub.reconnectDaemon();
    await hub.runtimeResources({ recoveredExecutionSubscriptions: 1 });
    await hub.completeCurrentTurn(result.agentId);
    await hub.pendingControlAction(result.execution.id);
    await hub.completePendingCleanup();
    const execution = await hub.execution(result.execution.id);
    assert.deepEqual(hub.controlActions(), ["archive"]);
    assert.equal(execution.hubAction, "archive");
    assert.notEqual(execution.hubActionReadyAt, null);
    assert.notEqual(execution.hubActionCompletedAt, null);
  });

  it("recovers a pending archive after restart and a missed provider acknowledgement", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({ autoArchive: true });
    await hub.disconnectDaemon();

    assert.equal(await hub.completeExecution(result.execution.id), 200);
    const pending = await hub.execution(result.execution.id);
    assert.equal(pending.status, "succeeded");
    assert.equal(pending.hubAction, "archive");
    assert.equal(pending.hubActionReadyAt, null);
    assert.equal(pending.hubActionCompletedAt, null);

    await hub.restartAppWithoutDaemonReconnect();
    const recovered = await hub.execution(result.execution.id);
    assert.equal(recovered.hubAction, "archive");
    assert.equal(recovered.hubActionReadyAt, null);
    assert.equal(recovered.hubActionCompletedAt, null);

    await hub.reconnectDaemon();
    await hub.runtimeResources({ recoveredExecutionSubscriptions: 1 });
    await hub.completeCurrentTurn(result.agentId);
    await hub.pendingControlAction(result.execution.id);
    await hub.completePendingCleanup();
    const execution = await hub.execution(result.execution.id);
    assert.deepEqual(hub.controlActions(), ["archive"]);
    assert.notEqual(execution.hubActionReadyAt, null);
    assert.notEqual(execution.hubActionCompletedAt, null);
  });

  it("observes a live recovery while an older cleanup remains slow", async () => {
    const daemonId = await hub.connectDaemon();
    const cleanup = await hub.dispatch({ autoArchive: true });
    const live = await hub.dispatch();
    await hub.disconnectDaemon();
    assert.equal(await hub.completeExecution(cleanup.execution.id), 200);
    hub.holdControlAcknowledgements();

    await hub.restartApp();
    await hub.runtimeResources({ recoveredExecutionSubscriptions: 2 });
    await hub.completeCurrentTurn(cleanup.agentId);
    assert.equal(await hub.pendingControlAction(cleanup.execution.id), "archive");
    await hub.spawnBegins();
    hub.interruptAgent(live.agentId);
    assert.equal(await hub.pendingControlAction(live.execution.id), "interrupt");

    hub.releaseControl(live.execution.id);
    await hub.failureNotified();
    assert.notEqual((await hub.execution(live.execution.id)).hubActionCompletedAt, null);
    assert.equal((await hub.execution(cleanup.execution.id)).hubActionCompletedAt, null);

    hub.releaseControl(cleanup.execution.id);
    await hub.completePendingCleanup(daemonId);

    const [cleaned, observed] = await Promise.all([
      hub.execution(cleanup.execution.id),
      hub.execution(live.execution.id),
    ]);
    assert.deepEqual(
      {
        cleanupCompleted: cleaned.hubActionCompletedAt !== null,
        liveStatus: observed.status,
        liveCleanupCompleted: observed.hubActionCompletedAt !== null,
        actions: hub.controlActions(),
        failureNotifications: hub.failureHookCount(),
      },
      {
        cleanupCompleted: true,
        liveStatus: "failed",
        liveCleanupCompleted: true,
        actions: ["archive", "interrupt"],
        failureNotifications: 1,
      },
    );
  });

  it("reports provider started and completed hooks with exact execution contexts", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch();
    const execution = await hub.execution(result.execution.id);
    await hub.startExecution(result.agentId);
    assert.equal(await hub.completeExecution(result.execution.id), 200);
    await hub.waitForCompletionHookCount(1);

    assert.deepEqual(hub.hookContexts(), {
      started: [
        {
          triggerContext: execution.triggerContext,
          outputContext: execution.outputContext,
        },
      ],
      completed: [
        {
          triggerContext: execution.triggerContext,
          outputContext: execution.outputContext,
        },
      ],
    });
  });

  it("inserts the execution before acceptance hooks and cleans up hook failure", async () => {
    await hub.connectDaemon();
    hub.failAcceptanceHook();

    await assert.rejects(
      hub.dispatch(),
      (error: unknown) => error instanceof DaemonDispatchFailure && error.reason === "internal",
    );

    const execution = await hub.acceptanceExecution();
    assert.deepEqual(
      { status: execution.status, result: execution.result },
      {
        status: "failed",
        result: { status: "failed", reason: "internal" },
      },
    );
    await hub.drainWorkflowOutbox();
    await hub.failureNotified();
    assert.equal(hub.failureHookCount(), 1);
    assert.equal(hub.createdAgentCount(), 0);
  });

  it("re-arms future deadlines after restart and expires exactly once", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({ timeoutMs: 10_000 });
    const beforeRestart = await hub.execution(result.execution.id);
    await hub.restartApp();
    const afterRestart = await hub.execution(result.execution.id);
    assert.equal(afterRestart.deadlineAt?.getTime(), beforeRestart.deadlineAt?.getTime());
    assert.equal(afterRestart.idleDeadlineAt?.getTime(), beforeRestart.idleDeadlineAt?.getTime());
    await hub.advanceDispatchTime(10_000);
    await hub.advanceDispatchTime(10_000);

    const execution = await hub.execution(result.execution.id);
    assert.deepEqual(
      { status: execution.status, result: execution.result },
      { status: "failed", result: { status: "failed", reason: "timeout" } },
    );
    await hub.drainWorkflowOutbox();
    await hub.failureNotified();
    assert.equal(hub.failureHookCount(), 1);
    assert.deepEqual(hub.controlActions(), ["interrupt"]);
    assert.equal(await hub.completeExecution(result.execution.id), 409);
  });

  it("expires an execution after five idle minutes", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      timeoutMs: 60 * 60_000,
      idleTimeoutMs: 5 * 60_000,
    });

    await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(5 * 60_000);

    const execution = await hub.execution(result.execution.id);
    assert.deepEqual(
      { status: execution.status, result: execution.result },
      { status: "failed", result: { status: "failed", reason: "idle_timeout" } },
    );
    assert.deepEqual(hub.controlActions(), ["interrupt"]);
  });

  it("archives an auto-archive run after idle timeout", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      timeoutMs: 60 * 60_000,
      idleTimeoutMs: 5 * 60_000,
      autoArchive: true,
    });

    await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(5 * 60_000);

    assert.deepEqual(hub.controlActions(), ["archive"]);
    assert.notEqual((await hub.execution(result.execution.id)).hubActionCompletedAt, null);
  });

  it("archives an auto-archive run after hard timeout", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({ timeoutMs: 1_000, autoArchive: true });

    await hub.advanceDispatchTime(1_000);

    assert.deepEqual(hub.controlActions(), ["archive"]);
    assert.equal((await hub.execution(result.execution.id)).hubAction, "archive");
  });

  it("resets inactivity when an idle agent reports idle again", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      timeoutMs: 60 * 60_000,
      idleTimeoutMs: 5 * 60_000,
    });
    const firstDeadline = await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(4 * 60_000);

    const secondDeadline = await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(60_000);

    assert.ok(secondDeadline > firstDeadline);
    assert.equal((await hub.execution(result.execution.id)).status, "running");
    await hub.advanceDispatchTime(4 * 60_000);
    assert.equal((await hub.execution(result.execution.id)).status, "failed");
  });

  it("refreshes the idle deadline on meaningful daemon activity", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      timeoutMs: 60 * 60_000,
      idleTimeoutMs: 5 * 60_000,
    });
    await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(4 * 60_000);

    const beforeActivity = await hub.execution(result.execution.id);
    await hub.beginReplacementTurn(result.agentId);
    await hub.advanceDispatchTime(0);
    await hub.advanceDispatchTime(2 * 60_000);

    const afterActivity = await hub.execution(result.execution.id);
    assert.equal(afterActivity.status, "running");
    assert.ok(afterActivity.idleDeadlineAt! > beforeActivity.idleDeadlineAt!);

    await hub.advanceDispatchTime(5 * 60_000);
    assert.equal((await hub.execution(result.execution.id)).status, "failed");
  });

  it("uses the activity receipt time when processing follows the idle deadline", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      timeoutMs: 60 * 60_000,
      idleTimeoutMs: 5 * 60_000,
    });
    await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(4 * 60_000);

    const beforeActivity = await hub.execution(result.execution.id);
    hub.holdActivityRefresh(result.execution.id);
    const activity = hub.emitReplacementTurn(result.agentId);
    await hub.activityRefreshBegins();
    await activity;

    const lateProcessing = hub.advanceDispatchTime(2 * 60_000);
    hub.releaseActivityRefresh();
    await Promise.all([activity, lateProcessing]);

    const afterActivity = await hub.execution(result.execution.id);
    assert.equal(afterActivity.status, "running");
    assert.equal(
      afterActivity.idleDeadlineAt?.getTime(),
      beforeActivity.idleDeadlineAt!.getTime() + 4 * 60_000,
    );
  });

  it("does not resurrect activity received at the idle deadline", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      timeoutMs: 60 * 60_000,
      idleTimeoutMs: 5 * 60_000,
    });
    await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(4 * 60_000);
    hub.advanceDispatchClock(60_000);

    hub.holdActivityRefresh(result.execution.id);
    const activity = hub.emitReplacementTurn(result.agentId);
    await hub.activityRefreshBegins();

    const timeout = hub.advanceDispatchTime(0);
    hub.releaseActivityRefresh();
    await Promise.all([activity, timeout]);

    const afterActivity = await hub.execution(result.execution.id);
    assert.deepEqual(
      { status: afterActivity.status, result: afterActivity.result },
      { status: "failed", result: { status: "failed", reason: "idle_timeout" } },
    );
  });

  it("interrupts a live workflow execution when the whole-run deadline expires", async () => {
    await hub.connectDaemon();
    const daemonSlug = hub.connectedDaemonSlug();
    await hub.installConfiguration({
      yaml: [
        "environments:",
        "  - name: production",
        "    kind: daemon",
        `    daemon: ${daemonSlug}`,
        "    cwd: /workspace/manual",
        "triggers:",
        "  - name: deadline",
        "    on: manual.run",
        "    max_runtime: 10s",
        "    filters:",
        "      from_users: [alice]",
        "    steps:",
        "      - id: deadline-step",
        "        environment: production",
        "        max_runtime: 1m",
        "        idle_timeout: 1m",
        "        agent:",
        "          provider: opencode",
        "          mode: full-access",
        '        prompt: [{ text: "Deadline" }]',
      ].join("\n"),
    });
    hub.holdSpawnAcknowledgement();
    const dispatch = hub.beginManual({ trigger: "deadline", deliveryKey: "whole-run-live" });
    await hub.spawnBegins();
    const pending = await hub.pendingExecution();
    hub.acceptSpawn();
    const result = await dispatch;
    assert.equal(result.status, 200);

    await hub.advanceDispatchTime(10_000);

    assert.equal((await hub.execution(pending.id)).status, "failed");
    assert.deepEqual(hub.controlActions(), ["interrupt"]);
  });

  it("ignores a stale inactivity deadline after a later idle report", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      timeoutMs: 60 * 60_000,
      idleTimeoutMs: 5 * 60_000,
    });
    const staleDeadline = await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(60_000);
    await hub.agentBecomesIdle(result.execution.id, result.agentId);

    assert.equal(
      await hub.staleIdleDeadlineAttemptsExpiry(result.execution.id, staleDeadline),
      false,
    );
    assert.equal((await hub.execution(result.execution.id)).status, "running");
  });

  it("clears inactivity while active and re-arms it on the next idle report", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      timeoutMs: 60 * 60_000,
      idleTimeoutMs: 5 * 60_000,
    });
    await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(4 * 60_000);

    await hub.agentBeginsInitializing(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(6 * 60_000);
    assert.equal((await hub.execution(result.execution.id)).status, "running");

    await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.agentBecomesRunning(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(6 * 60_000);
    assert.equal((await hub.execution(result.execution.id)).status, "running");

    await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(5 * 60_000);
    const execution = await hub.execution(result.execution.id);
    assert.deepEqual(execution.result, {
      status: "failed",
      reason: "idle_timeout",
    });
  });

  it("keeps the hard deadline authoritative across running heartbeats", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      timeoutMs: 10 * 60_000,
      idleTimeoutMs: 5 * 60_000,
    });
    await hub.advanceDispatchTime(9 * 60_000);

    await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.agentBecomesRunning(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(60_000);

    const execution = await hub.execution(result.execution.id);
    assert.deepEqual(execution.result, { status: "failed", reason: "timeout" });
  });

  it("keeps authenticated completion authoritative while idle", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      timeoutMs: 60 * 60_000,
      idleTimeoutMs: 5 * 60_000,
    });
    await hub.agentBecomesIdle(result.execution.id, result.agentId);

    assert.equal(await hub.completeExecution(result.execution.id), 200);
    await hub.advanceDispatchTime(5 * 60_000);

    assert.equal((await hub.execution(result.execution.id)).status, "succeeded");
  });

  it("preserves a persisted inactivity deadline across restart and reconnect", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({
      timeoutMs: 60 * 60_000,
      idleTimeoutMs: 5 * 60_000,
    });
    await hub.agentBecomesIdle(result.execution.id, result.agentId);
    await hub.advanceDispatchTime(4 * 60_000);

    const beforeRestart = await hub.execution(result.execution.id);
    await hub.restartApp();
    const afterRestart = await hub.execution(result.execution.id);
    assert.equal(afterRestart.deadlineAt?.getTime(), beforeRestart.deadlineAt?.getTime());
    assert.equal(afterRestart.idleDeadlineAt?.getTime(), beforeRestart.idleDeadlineAt?.getTime());
    await hub.advanceDispatchTime(60_000);

    const execution = await hub.execution(result.execution.id);
    assert.deepEqual(execution.result, {
      status: "failed",
      reason: "idle_timeout",
    });
  });

  it.each(["error", "closed"] as const)(
    "fails immediately when a live agent reports %s",
    async (status) => {
      await hub.connectDaemon();
      const result = await hub.dispatch();

      const execution = await hub.agentTerminates(result.execution.id, result.agentId, status);

      assert.deepEqual(
        {
          status: execution.status,
          result: execution.result,
          failureHooks: hub.failureHookCount(),
          controls: hub.controlActions(),
        },
        {
          status: "failed",
          result: { status: "failed", reason: "agent_interrupted" },
          failureHooks: 1,
          controls: ["interrupt"],
        },
      );
    },
  );

  it("archives an auto-archive run after agent interruption", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({ autoArchive: true });

    await hub.agentTerminates(result.execution.id, result.agentId, "error");

    assert.deepEqual(hub.controlActions(), ["archive"]);
    assert.equal((await hub.execution(result.execution.id)).hubAction, "archive");
  });

  it("keeps a failed turn running across restart until authenticated completion", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch();
    await hub.startExecution(result.agentId);
    await hub.failCurrentTurn(result.agentId);
    await hub.restartApp();

    assert.equal((await hub.execution(result.execution.id)).status, "running");
    assert.equal(await hub.completeExecution(result.execution.id), 200);
    assert.equal((await hub.execution(result.execution.id)).status, "succeeded");
  });

  it("keeps a completed turn running across restart until authenticated completion", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch();
    await hub.startExecution(result.agentId);
    await hub.completeCurrentTurn(result.agentId);
    await hub.restartApp();

    assert.equal((await hub.execution(result.execution.id)).status, "running");
    assert.equal(await hub.completeExecution(result.execution.id), 200);
    assert.equal((await hub.execution(result.execution.id)).status, "succeeded");
  });

  it("fails an associated running execution when reconnect reports its agent interrupted", async () => {
    const daemonId = await hub.connectDaemon();
    const result = await hub.dispatch();
    await hub.startExecution(result.agentId);

    await hub.reconnectInterruptedAgent(result.agentId);
    const execution = await hub.interruptedExecution(result.execution.id);
    await hub.failureNotified();
    await hub.advanceDispatchTime(24 * 60 * 60 * 1000);

    assert.deepEqual(
      {
        status: execution.status,
        result: execution.result,
        daemonId: execution.daemonId,
        agentId: execution.daemonAgentId,
        createRequests: hub.createdAgentRequestCount(),
        failureHooks: hub.failureHookCount(),
        resources: await hub.runtimeResources(),
      },
      {
        status: "failed",
        result: { status: "failed", reason: "agent_interrupted" },
        daemonId,
        agentId: result.agentId,
        createRequests: 2,
        failureHooks: 1,
        resources: {
          recoveredExecutionSubscriptions: 0,
        },
      },
    );
  });

  it("returns workflow resources to baseline after repeated enqueue/restart boundaries", async () => {
    await hub.connectDaemon();
    await hub.installConfiguration({
      yaml: hub.manualConfigurationYaml(),
    });

    for (let cycle = 0; cycle < 2; cycle += 1) {
      const result = await hub.runManual({
        deliveryKey: `resource-cycle-${cycle}`,
      });
      assert.equal(result.status, 200);
      assert.ok(result.triggerRunId);
      const execution = await hub.waitForExecutionForTriggerRun(result.triggerRunId);
      await hub.waitForExecutionStatus(execution.id, "running");
      await hub.restartApp();
      await hub.waitForRecoveredExecution(execution.id);
      assert.deepEqual(
        await hub.runtimeResources({
          recoveredExecutionSubscriptions: 1,
        }),
        {
          recoveredExecutionSubscriptions: 1,
        },
      );
      assert.equal(await hub.completeExecution(execution.id), 200);
      await hub.waitForExecutionStatus(execution.id, "succeeded");
      assert.deepEqual(
        await hub.runtimeResources({
          recoveredExecutionSubscriptions: 0,
        }),
        { recoveredExecutionSubscriptions: 0 },
      );
    }

    const stopped = await hub.runManual({
      deliveryKey: "resource-runtime-stop",
    });
    assert.equal(stopped.status, 200);
    assert.ok(stopped.triggerRunId);
    const execution = await hub.waitForExecutionForTriggerRun(stopped.triggerRunId);
    await hub.waitForExecutionStatus(execution.id, "running");
    await hub.restartApp();
    await hub.waitForRecoveredExecution(execution.id);
    await hub.runtimeResources({ recoveredExecutionSubscriptions: 1 });
    assert.deepEqual(await hub.stopRuntimeResources(), {
      recoveredExecutionSubscriptions: 0,
    });
  });

  it("releases recovered execution resources on failure, revocation, and runtime stop", async () => {
    await hub.connectDaemon();
    const timedOut = await hub.dispatch({ timeoutMs: 1_000 });
    assert.deepEqual(
      await hub.runtimeResources({
        recoveredExecutionSubscriptions: 0,
      }),
      {
        recoveredExecutionSubscriptions: 0,
      },
    );
    await hub.advanceDispatchTime(1_000);
    assert.equal((await hub.execution(timedOut.execution.id)).status, "failed");
    assert.deepEqual(await hub.runtimeResources(), {
      recoveredExecutionSubscriptions: 0,
    });
  });

  it("fails offline daemons without attempting outbound acquisition", async () => {
    await hub.connectDaemon();
    await hub.disconnectDaemon();

    await assert.rejects(
      hub.dispatch(),
      (error: unknown) =>
        error instanceof DaemonDispatchFailure && error.reason === "daemon_unreachable",
    );
  });

  it("claims singular durable handoff failures immediately", async () => {
    await hub.connectDaemon();

    const handedOff = await hub.handoffMissingDaemon();

    assert.equal(handedOff.execution.status, "failed");
    assert.deepEqual(handedOff.execution.result, {
      status: "failed",
      reason: "daemon_not_registered",
    });
    assert.equal(hub.createdAgentRequestCount(), 0);
  });

  it("distinguishes a missing daemon from an enrolled daemon that is offline", async () => {
    await hub.connectDaemon();

    await assert.rejects(
      hub.dispatchMissingDaemon(),
      (error: unknown) =>
        error instanceof DaemonDispatchFailure && error.reason === "daemon_not_registered",
    );
  });

  it("keeps replacement turns owned until authenticated completion", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch();
    await hub.startExecution(result.agentId);
    await hub.failCurrentTurn(result.agentId);
    await hub.beginReplacementTurn(result.agentId);

    assert.equal((await hub.execution(result.execution.id)).status, "running");
    assert.equal(await hub.completeExecution(result.execution.id), 200);
    assert.equal((await hub.execution(result.execution.id)).status, "succeeded");
  });

  it("keeps completion authoritative when its provider callback fails", async () => {
    await hub.connectDaemon();
    hub.failCompletionHook();
    const completed = await hub.dispatch();
    assert.equal(await hub.completeExecution(completed.execution.id), 200);
    assert.equal((await hub.execution(completed.execution.id)).status, "succeeded");
  });

  it("keeps timeout authoritative when its provider callback fails", async () => {
    await hub.connectDaemon();
    hub.failTimeoutHook();
    const timedOut = await hub.dispatch({ timeoutMs: 1_000 });
    await hub.advanceDispatchTime(1_000);
    assert.equal((await hub.execution(timedOut.execution.id)).status, "failed");
  });

  it("keeps MCP completion when it wins the timeout race", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({ timeoutMs: 1_000 });

    assert.equal(await hub.completeExecution(result.execution.id), 200);
    await hub.advanceDispatchTime(1_000);
    assert.equal((await hub.execution(result.execution.id)).status, "succeeded");
    assert.deepEqual(hub.controlActions(), []);
  });

  it("leaves a timed-out execution failed when completion arrives late", async () => {
    await hub.connectDaemon();
    const result = await hub.dispatch({ timeoutMs: 1_000 });
    await hub.advanceDispatchTime(1_000);

    assert.equal(await hub.completeExecution(result.execution.id), 409);
    assert.equal((await hub.execution(result.execution.id)).status, "failed");
    assert.deepEqual(hub.controlActions(), ["interrupt"]);
  });

  it("fails dispatch when no public capability URL is configured", async () => {
    await hub.connectDaemon();
    await hub.restartWithoutCompletionUrl();

    await assert.rejects(
      hub.dispatch(),
      (error: unknown) =>
        error instanceof DaemonDispatchFailure && error.reason === "completion_url_not_configured",
    );
  });

  it.each(["github", "discord"] as const)(
    "fails closed before %s dispatch when the completion secret is unset",
    async (provider) => {
      await hub.connectDaemon();
      await hub.restartWithoutCompletionTokenSecret();

      await assert.rejects(
        hub.dispatchFrom(provider),
        (error: unknown) =>
          error instanceof DaemonDispatchFailure &&
          error.reason === "completion_auth_not_configured",
      );
      assert.equal(hub.createdAgentCount(), 0);
      assert.equal(await hub.pendingExecutionCount(), 0);
    },
  );

  it("bounds spawn acknowledgement and execution deadlines with the deterministic clock", async () => {
    await hub.connectDaemon();
    hub.holdSpawnAcknowledgement();
    const dispatch = hub.beginDispatch({ timeoutMs: 60_000 });
    await hub.spawnBegins();
    await hub.advanceDispatchTime(30_000);

    await assert.rejects(
      dispatch,
      (error: unknown) =>
        error instanceof DaemonDispatchFailure && error.reason === "daemon_timeout",
    );
  });

  it("expires at the dispatch boundary before creating an agent", async () => {
    await hub.connectDaemon();

    await assert.rejects(
      hub.dispatch({ timeoutMs: 0 }),
      (error: unknown) => error instanceof DaemonDispatchFailure && error.reason === "timeout",
    );
    assert.equal(hub.createdAgentCount(), 0);
  });

  it("tears down sockets, server, database, and container idempotently", async () => {
    await hub.connectDaemon();

    await hub.stop();
    await hub.stop();
  });

  it("rolls back partially acquired startup resources", async () => {
    assert.equal(await HubHarness.startupFailureRollsBack(), true);
  });
});

function toolResultIsError(response: Record<string, unknown>): boolean | undefined {
  const result = response["result"];
  if (!isRecord(result)) throw new Error("execution tool response has no result");
  const isError = result["isError"];
  if (isError !== undefined && typeof isError !== "boolean") {
    throw new Error("execution tool response has an invalid isError field");
  }
  return isError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
