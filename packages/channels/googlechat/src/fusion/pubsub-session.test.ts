import { describe, expect, it } from "vitest";
import type { GoogleChatAdmissionResult, GoogleChatWebhookAdmission } from "./admission.js";
import type { GoogleChatPubSubClient, PubSubReceivedMessage } from "./pubsub-api.js";
import { startGoogleChatPubSubSession } from "./pubsub-session.js";

const SUBSCRIPTION = "projects/demo-project/subscriptions/chat-events";

function encoded(event: unknown): string {
  return Buffer.from(JSON.stringify(event)).toString("base64");
}

/** A client that serves the given batches, then ends the session. */
function fakeClient(batches: Array<PubSubReceivedMessage[] | Error>, controller: AbortController) {
  const acked: string[] = [];
  const released: string[] = [];
  const client: GoogleChatPubSubClient = {
    async pull() {
      const next = batches.shift();
      if (next === undefined) {
        controller.abort();
        return [];
      }
      if (next instanceof Error) throw next;
      return next;
    },
    async acknowledge(ackIds) {
      acked.push(...ackIds);
    },
    async release(ackIds) {
      released.push(...ackIds);
    },
  };
  return { client, acked, released };
}

function admissionReturning(
  decide: (raw: unknown) => GoogleChatAdmissionResult | Error,
): GoogleChatWebhookAdmission & { received: unknown[] } {
  const received: unknown[] = [];
  return {
    received,
    async receive(raw) {
      received.push(raw);
      const result = decide(raw);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

async function run(
  batches: Array<PubSubReceivedMessage[] | Error>,
  admission: GoogleChatWebhookAdmission,
) {
  const controller = new AbortController();
  const fake = fakeClient(batches, controller);
  const statuses: Record<string, unknown>[] = [];
  await startGoogleChatPubSubSession({
    client: fake.client,
    admission,
    subscription: SUBSCRIPTION,
    abortSignal: controller.signal,
    setStatus: (patch) => statuses.push(patch),
    sleep: async () => undefined,
  });
  return { ...fake, statuses };
}

describe("startGoogleChatPubSubSession", () => {
  it("admits the decoded Chat event, then acks it", async () => {
    const event = { type: "MESSAGE", message: { name: "spaces/A/messages/1", text: "hi" } };
    const admission = admissionReturning(() => ({ kind: "durable" }));
    const result = await run([[{ ackId: "a1", data: encoded(event), messageId: "m1" }]], admission);
    expect(admission.received).toEqual([event]);
    expect(result.acked).toEqual(["a1"]);
    expect(result.released).toEqual([]);
  });

  it("releases a message whose admission threw so Pub/Sub redelivers it", async () => {
    const admission = admissionReturning((raw) =>
      (raw as { n: number }).n === 2 ? new Error("queue down") : { kind: "durable" },
    );
    const result = await run(
      [
        [
          { ackId: "a1", data: encoded({ n: 1 }), messageId: "m1" },
          { ackId: "a2", data: encoded({ n: 2 }), messageId: "m2" },
        ],
      ],
      admission,
    );
    expect(result.acked).toEqual(["a1"]);
    expect(result.released).toEqual(["a2"]);
  });

  it("acks what no retry can fix: undecodable data and refused envelopes", async () => {
    const admission = admissionReturning(() => ({ kind: "invalid", reason: "not chat" }));
    const result = await run(
      [
        [
          { ackId: "bad", data: "not-base64-json", messageId: "m1" },
          { ackId: "empty", data: undefined, messageId: "m2" },
          { ackId: "refused", data: encoded({ x: 1 }), messageId: "m3" },
        ],
      ],
      admission,
    );
    expect(admission.received).toEqual([{ x: 1 }]);
    expect(result.acked).toEqual(["bad", "empty", "refused"]);
  });

  it("reports a failed pull and recovers on the next one", async () => {
    const admission = admissionReturning(() => ({ kind: "durable" }));
    const result = await run(
      [new Error("PERMISSION_DENIED"), [{ ackId: "a1", data: encoded({}), messageId: "m1" }]],
      admission,
    );
    expect(result.acked).toEqual(["a1"]);
    expect(result.statuses).toContainEqual(
      expect.objectContaining({ mode: "pubsub", connected: false, lastError: "PERMISSION_DENIED" }),
    );
    expect(result.statuses.at(-1)).toEqual(
      expect.objectContaining({ connected: false, subscription: SUBSCRIPTION }),
    );
  });
});
