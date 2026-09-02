import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { DurableProviderEvent } from "../../db/types.js";
import { createMemoryDatabase } from "../../db/memory.js";
import { createManualTriggerSource, handleManualTriggerRequest } from "./source.js";

describe("manual trigger source", () => {
  it("passes arbitrary provider-namespaced payloads to the handler", async () => {
    const manual = await ManualTriggers.recording();

    assert.deepEqual(
      await manual.deliver({
        organizationId: "org_1",
        triggerId: manual.workflowId,
        triggerRevisionId: manual.revisionId,
        source: "discord.mention",
        deliveryId: "manual-discord-1",
        payload: {
          guildId: "guild-1",
          channelId: "channel-1",
          message: "@paseo ping",
        },
      }),
      {
        status: 200,
        body: { status: "accepted", deliveryId: "manual-discord-1" },
      },
    );
    assert.deepEqual(manual.received(), [
      {
        organizationId: "org_1",
        triggerId: manual.workflowId,
        triggerRevisionId: manual.revisionId,
        source: "discord.mention",
        deliveryId: "manual-discord-1",
        payload: {
          guildId: "guild-1",
          channelId: "channel-1",
          message: "@paseo ping",
        },
      },
    ]);
    assert.deepEqual(manual.evidence(), [{ connectionId: null, resourceId: null }]);
  });

  it("rejects non-namespaced manual payload sources", async () => {
    const manual = await ManualTriggers.recording();

    assert.deepEqual(
      await manual.deliver({
        organizationId: "org_1",
        triggerId: manual.workflowId,
        triggerRevisionId: manual.revisionId,
        source: "manual",
        deliveryId: "manual-legacy-1",
        payload: {},
      }),
      {
        status: 400,
        body: {
          error: "source must be provider-namespaced, for example github.issue_comment",
        },
      },
    );
  });
});

interface ManualDelivery {
  organizationId: string;
  triggerId: string;
  triggerRevisionId: string;
  source: string;
  deliveryId: string;
  payload: unknown;
}

class ManualTriggers {
  private readonly handled: DurableProviderEvent[] = [];

  private constructor(
    private readonly source: ReturnType<typeof createManualTriggerSource>,
    readonly workflowId: string,
    readonly revisionId: string,
  ) {}

  static async recording(): Promise<ManualTriggers> {
    const database = createMemoryDatabase();
    const workflow = await database.saveOrganizationTrigger({
      organizationId: "org_1",
      name: "manual-workflow",
      enabled: true,
      format: "legacy_multistep",
      yaml: "name: manual-workflow",
      sourceKind: "manual",
      sourceEvidence: { kind: "test" },
      normalizedConfiguration: { environments: [], triggers: [] },
      contentHash: "manual-source-test-configuration",
      createdByUserId: null,
      routes: [],
    });
    const manual = new ManualTriggers(
      createManualTriggerSource(database),
      workflow.id,
      workflow.activeRevisionId,
    );
    await manual.source.start(async (trigger) => {
      manual.handled.push(trigger);
    });
    return manual;
  }

  async deliver(delivery: ManualDelivery): Promise<{ status: number; body: unknown }> {
    const response = await handleManualTriggerRequest(
      new Request("http://localhost/test/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(delivery),
      }),
      this.source,
      "trigger",
    );
    return { status: response.status, body: await response.json() };
  }

  received(): ManualDelivery[] {
    return this.handled.map(
      ({ organizationId, workflowId, configurationRevisionId, source, deliveryId, payload }) => ({
        organizationId,
        triggerId: workflowId,
        triggerRevisionId: configurationRevisionId,
        source,
        deliveryId,
        payload,
      }),
    );
  }

  evidence() {
    return this.handled.map(({ connectionId, resourceId }) => ({
      connectionId,
      resourceId,
    }));
  }
}
