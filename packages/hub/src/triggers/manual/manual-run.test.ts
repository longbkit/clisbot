import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import { HubHarness } from "../../daemons/test-utils/hub-harness.js";

describe("production Phase 1 manual runs", () => {
  let hub: HubHarness;

  beforeEach(async () => {
    hub = await HubHarness.start();
  }, 120_000);

  afterEach(async () => {
    await hub.stop();
  }, 120_000);

  it("requires machine authentication for installation and enqueue", async () => {
    await hub.connectDaemon();
    const yaml = hub.manualConfigurationYaml();
    assert.equal((await hub.installConfiguration({ yaml, auth: "missing" })).status, 401);
    assert.equal((await hub.installConfiguration({ yaml, auth: "wrong" })).status, 401);
    assert.equal((await hub.runManual({ auth: "missing" })).status, 401);
    assert.equal((await hub.runManual({ auth: "wrong" })).status, 401);
  });

  it("enqueues one durable run for the requested one-step manual trigger", async () => {
    await hub.connectDaemon();
    const installed = await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });
    const run = await hub.runManual({ expectedVersionId: installed.versionId });

    assert.equal(run.status, 200);
    assert.equal(typeof run.providerEventReceiptId, "string");
    assert.equal(typeof run.triggerRunId, "string");
    assert.equal(run.configuredTriggerName, "deploy");
    assert.equal(run.workflowStatus, "running");
  });

  it("keeps duplicate provider delivery idempotent at the enqueue boundary", async () => {
    await hub.connectDaemon();
    await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });
    const first = await hub.runManual({ deliveryKey: "stable-delivery" });
    const duplicate = await hub.runManual({ deliveryKey: "stable-delivery" });

    assert.deepEqual(duplicate, first);
  });

  it("carries required-output validation through canonical manual public dispatch", async () => {
    await hub.connectDaemon();
    const yaml = hub
      .manualConfigurationYaml()
      .replace(
        '        prompt: [{ text: "Deploy the requested service" }] ',
        [
          '        prompt: [{ text: "Deploy the requested service" }] ',
          "        allow_outputs:",
          "          - type: discord.reply",
          "            max: 1",
          "            required: true",
        ].join("\n"),
      );
    await hub.installConfiguration({ yaml });
    const run = await hub.runCanonicalManual({ deliveryKey: "required-output-public-dispatch" });
    assert.equal(run.status, 200);
    assert.ok(run.triggerRunId);
    const rejected = await hub.failedTriggerRun(run.triggerRunId);
    assert.equal(rejected.outcome, "accepted");
    assert.match(
      rejected.outcome === "accepted" ? (rejected.failureReason ?? "") : "",
      /required output capability unavailable.*discord\.reply/iu,
    );
    assert.equal(await hub.pendingExecutionCount(), 0);
  });

  it("selects the requested trigger and preserves the version guard", async () => {
    await hub.connectDaemon();
    const first = await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });
    const current = await hub.installConfiguration({ yaml: hub.manualConfigurationYaml() });
    const accepted = await hub.runManual({
      trigger: "rollback",
      expectedVersionId: current.versionId,
      deliveryKey: "current-version",
    });
    const stale = await hub.runManual({
      expectedVersionId: first.versionId,
      deliveryKey: "stale-version",
    });

    assert.equal(accepted.status, 200);
    assert.deepEqual(
      { status: stale.status, error: stale.error },
      { status: 409, error: "configuration_changed" },
    );
  });
});
