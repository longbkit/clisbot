import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import { HubE2E } from "./harness/index.js";

const describeRealAgent = process.env["RUN_HUB_REAL_AGENT_E2E"] === "1" ? describe : describe.skip;

describeRealAgent("Hub execution MCP real-agent smoke", () => {
  let hub: HubE2E;

  beforeEach(async () => {
    hub = await HubE2E.start({ realAgent: true });
  }, 120_000);

  afterEach(async () => {
    const shutdown = await hub?.stop();
    assert.deepEqual(shutdown?.leakedProcesses ?? [], []);
  }, 120_000);

  it("lets a real Codex agent finalize a production manual run through MCP", async () => {
    await hub.connect();
    await hub.daemonIsConnected();
    await hub.installRealAgentConfiguration("codex");

    const run = await hub.runRealAgentManual("real-agent-finalize");
    const evidence = await hub.realAgentCompletionEvidence(run, "codex");

    assert.equal(evidence.status, "succeeded");
    assert.equal(evidence.completedByAgent, true);
    assert.equal(evidence.completedToolCall, true);
    assert.equal(evidence.completionHelperLaunched, false);
  }, 300_000);

  it("lets a real Claude agent finalize a production manual run through MCP", async () => {
    await hub.connect();
    await hub.daemonIsConnected();
    await hub.installRealAgentConfiguration("claude");

    const run = await hub.runRealAgentManual("real-claude-finalize");
    const evidence = await hub.realAgentCompletionEvidence(run, "claude");

    assert.equal(evidence.status, "succeeded");
    assert.equal(evidence.completedByAgent, true);
    assert.equal(evidence.completedToolCall, true);
    assert.equal(evidence.completionHelperLaunched, false);
  }, 300_000);

  it("lets a permissioned real OpenCode agent finalize through preapproved Hub MCP", async () => {
    await hub.connect();
    await hub.daemonIsConnected();
    await hub.installRealAgentConfiguration("opencode");

    const run = await hub.runRealAgentManual("real-opencode-finalize");
    const evidence = await hub.realAgentCompletionEvidence(run, "opencode");

    assert.equal(evidence.status, "succeeded");
    assert.equal(evidence.completedByAgent, true);
    assert.equal(evidence.completedToolCall, true);
    assert.equal(evidence.completionHelperLaunched, false);
  }, 300_000);

  it("routes deterministic input and classifier fallback through the real daemon", async () => {
    await hub.connect();
    await hub.daemonIsConnected();
    await hub.installRealAgentRoutingConfiguration("codex");

    const deterministicRun = await hub.runRealAgentRouting(
      "routing-deterministic",
      "repo=paseo task",
    );
    const deterministic = await hub.realAgentRoutingEvidence(deterministicRun, "codex");
    assert.deepEqual(
      deterministic.steps.map((step) => [step.stepId, step.status]),
      [
        ["classify", "skipped"],
        ["work-paseo", "succeeded"],
        ["work-hub", "skipped"],
      ],
    );

    const classifiedRun = await hub.runRealAgentRouting("routing-classifier", "investigate");
    const classified = await hub.realAgentRoutingEvidence(classifiedRun, "codex");
    assert.deepEqual(
      classified.steps.map((step) => [step.stepId, step.status]),
      [
        ["classify", "succeeded"],
        ["work-paseo", "skipped"],
        ["work-hub", "succeeded"],
      ],
    );
    assert.deepEqual(classified.steps[0]?.output, { repo: "hub" });
  }, 600_000);

  it("routes classifier fallback through a real Claude multi-step workflow", async () => {
    await hub.connect();
    await hub.daemonIsConnected();
    await hub.installRealAgentRoutingConfiguration("claude");

    const run = await hub.runRealAgentRouting(
      "claude-routing-classifier",
      "investigate Hub workflows",
    );
    const evidence = await hub.realAgentRoutingEvidence(run, "claude");

    assert.deepEqual(
      evidence.steps.map((step) => [step.stepId, step.status]),
      [
        ["classify", "succeeded"],
        ["work-paseo", "skipped"],
        ["work-hub", "succeeded"],
      ],
    );
    assert.deepEqual(evidence.steps[0]?.output, { repo: "hub" });
  }, 600_000);
});
