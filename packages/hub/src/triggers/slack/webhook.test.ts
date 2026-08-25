import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "vitest";
import type { DurableProviderEvent, ProviderEventAcceptance } from "../../db/types.js";
import { createSlackWebhookSource, verifySlackSignature } from "./webhook.js";

const SECRET = "slack-signing-secret";
const APP_ID = "A123";
const NOW = 1_700_000_000_000;

describe("Slack webhook", () => {
  it("verifies the exact raw bytes and rejects stale, future, and malformed evidence", () => {
    const timestamp = String(NOW / 1_000);
    const body = new TextEncoder().encode('{"text":"héllo"}');
    const signature = sign(timestamp, body);

    assert.equal(verifySlackSignature(SECRET, timestamp, body, signature, NOW), true);
    assert.equal(
      verifySlackSignature(SECRET, timestamp, body, sign(timestamp, "different"), NOW),
      false,
    );
    assert.equal(
      verifySlackSignature(SECRET, String(Number(timestamp) - 301), body, signature, NOW),
      false,
    );
    assert.equal(
      verifySlackSignature(SECRET, String(Number(timestamp) + 301), body, signature, NOW),
      false,
    );
    assert.equal(verifySlackSignature(SECRET, "not-a-time", body, signature, NOW), false);
    assert.equal(verifySlackSignature(SECRET, timestamp, body, "v0=short", NOW), false);
  });

  it("answers a signed URL verification without accepting an event", async () => {
    let accepted = false;
    const endpoint = source(() => {
      accepted = true;
      return Promise.reject(new Error("unused"));
    });
    const response = await endpoint.handle(
      request({ type: "url_verification", api_app_id: APP_ID, challenge: "challenge-token" }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { challenge: "challenge-token" });
    assert.equal(accepted, false);
  });

  it("normalizes, durably accepts, and dispatches an app mention once", async () => {
    const accepted: unknown[] = [];
    const dispatched: DurableProviderEvent[] = [];
    const endpoint = source((input) => {
      accepted.push(input);
      return Promise.resolve({
        status: "accepted",
        receiptId: `receipt-${input.deliveryId}`,
        events: [
          {
            providerEventReceiptId: "trigger-1",
            organizationId: "org-1",
            projectId: "project-1",
            configurationRevisionId: "11111111-1111-4111-8111-111111111132",
            deliveryId: input.deliveryId,
            source: input.source,
            payload: input.payload,
            receivedAt: input.receivedAt,
            connectionId: "slack-connection",
            resourceId: input.teamId,
          },
        ],
      });
    });
    await endpoint.start((trigger) => {
      dispatched.push(trigger);
      return Promise.resolve({ providerEventReceiptId: trigger.providerEventReceiptId });
    });

    const response = await endpoint.handle(request(mentionEnvelope()));

    assert.equal(response.status, 200);
    assert.equal(accepted.length, 1);
    assert.deepEqual(
      dispatched.map(({ deliveryId, source: eventSource }) => ({
        deliveryId,
        source: eventSource,
      })),
      [{ deliveryId: "slack-Ev123", source: "slack.mention" }],
    );
    assert.deepEqual(
      dispatched.map(({ connectionId, resourceId }) => ({ connectionId, resourceId })),
      [{ connectionId: "slack-connection", resourceId: "T123" }],
    );
    assert.deepEqual(dispatched[0]?.payload, {
      type: "mention",
      id: "Ev123",
      teamId: "T123",
      appId: APP_ID,
      channelId: "C123",
      messageTs: "1700000000.000100",
      threadTs: "1699999999.000001",
      eventTs: "1700000000.000100",
      eventTime: 1_700_000_900,
      content: "<@U999> investigate",
      author: { id: "U123" },
      createdAt: "2023-11-14T22:13:20.000Z",
      attachments: [],
    });
  });

  it("acknowledges duplicate and unsupported signed events", async () => {
    let accepts = 0;
    const endpoint = source(() => {
      accepts += 1;
      return Promise.resolve({
        status: "duplicate",
        triggerIds: ["trigger-1"],
        receiptId: "slack-Ev123",
      });
    });
    await endpoint.start(() => Promise.reject(new Error("must not dispatch duplicate")));

    assert.equal((await endpoint.handle(request(mentionEnvelope()))).status, 200);
    assert.equal(
      (await endpoint.handle(request({ ...mentionEnvelope(), event: { type: "reaction_added" } })))
        .status,
      200,
    );
    assert.equal(accepts, 1);
  });

  it("replays a duplicate durable trigger through idempotent dispatch", async () => {
    const trigger: DurableProviderEvent = {
      providerEventReceiptId: "trigger-1",
      organizationId: "org-1",
      projectId: "project-1",
      configurationRevisionId: "11111111-1111-4111-8111-111111111132",
      deliveryId: "slack-Ev123",
      source: "slack.mention",
      payload: {},
      receivedAt: new Date(NOW),
      connectionId: "slack-connection",
      resourceId: "T123",
    };
    const endpoint = createSlackWebhookSource({
      appId: APP_ID,
      signingSecret: SECRET,
      now: () => NOW,
      accept: () =>
        Promise.resolve({
          status: "accepted",
          events: [trigger],
          receiptId: trigger.deliveryId,
        }),
    });
    let dispatches = 0;
    await endpoint.start(() => {
      dispatches += 1;
      return Promise.resolve({ providerEventReceiptId: trigger.providerEventReceiptId });
    });

    assert.equal((await endpoint.handle(request(mentionEnvelope()))).status, 200);
    assert.equal(dispatches, 1);
  });

  it("does not dispatch duplicate acceptance", async () => {
    const endpoint = createSlackWebhookSource({
      appId: APP_ID,
      signingSecret: SECRET,
      now: () => NOW,
      accept: () =>
        Promise.resolve({
          status: "duplicate" as const,
          receiptId: "slack-Ev123",
        }),
    });
    let dispatches = 0;
    await endpoint.start((trigger) => {
      dispatches += 1;
      return Promise.resolve({ providerEventReceiptId: trigger.providerEventReceiptId });
    });

    assert.equal((await endpoint.handle(request(mentionEnvelope()))).status, 200);
    assert.equal(dispatches, 0);
  });

  it("rejects unauthenticated, wrong-app, oversized, and unavailable handoffs", async () => {
    const endpoint = source(() => Promise.reject(new Error("database offline")));
    const unsigned = new Request("https://hub.test/api/integrations/slack/events", {
      method: "POST",
      body: JSON.stringify(mentionEnvelope()),
    });
    assert.equal((await endpoint.handle(unsigned)).status, 401);
    assert.equal(
      (await endpoint.handle(request({ ...mentionEnvelope(), api_app_id: "A_WRONG" }))).status,
      400,
    );
    assert.equal((await endpoint.handle(request(mentionEnvelope()))).status, 503);

    const oversized = new Request("https://hub.test/api/integrations/slack/events", {
      method: "POST",
      headers: {
        "content-length": "1048577",
        "x-slack-request-timestamp": String(NOW / 1_000),
        "x-slack-signature": sign(String(NOW / 1_000), ""),
      },
      body: "x",
    });
    assert.equal((await endpoint.handle(oversized)).status, 413);
  });
});

function source(
  accept: (
    input: Parameters<Parameters<typeof createSlackWebhookSource>[0]["accept"]>[0],
  ) => Promise<ProviderEventAcceptance>,
) {
  return createSlackWebhookSource({ appId: APP_ID, signingSecret: SECRET, now: () => NOW, accept });
}

function request(payload: unknown): Request {
  const body = JSON.stringify(payload);
  const timestamp = String(NOW / 1_000);
  return new Request("https://hub.test/api/integrations/slack/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": sign(timestamp, body),
    },
    body,
  });
}

function sign(timestamp: string, body: string | Uint8Array): string {
  return `v0=${createHmac("sha256", SECRET).update("v0:").update(timestamp).update(":").update(body).digest("hex")}`;
}

function mentionEnvelope() {
  return {
    type: "event_callback",
    team_id: "T123",
    api_app_id: APP_ID,
    event_id: "Ev123",
    event_time: 1_700_000_900,
    event: {
      type: "app_mention",
      user: "U123",
      channel: "C123",
      text: "<@U999> investigate",
      ts: "1700000000.000100",
      thread_ts: "1699999999.000001",
      event_ts: "1700000000.000100",
    },
  };
}
