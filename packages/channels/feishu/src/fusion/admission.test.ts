import * as Lark from "@larksuiteoapi/node-sdk";
import { describe, expect, it, vi } from "vitest";
import { createFeishuAdmission } from "./admission.js";
import type { ChannelInboundEvent } from "@getpaseo/channels-shared";

const ENCRYPT_KEY = "test-encrypt-key";

function webhookEnvelope(text: string, messageId = "om_1") {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_1",
      event_type: "im.message.receive_v1",
      token: "verify-token",
      create_time: "1757000000000",
      tenant_key: "tk",
      app_id: "cli_test_app",
    },
    event: {
      sender: { sender_id: { open_id: "ou_sender" }, sender_type: "user" },
      message: {
        message_id: messageId,
        chat_id: "oc_1",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text }),
        create_time: "1757000000000",
      },
    },
  };
}

function newDispatcher() {
  return new Lark.EventDispatcher({ encryptKey: ENCRYPT_KEY, verificationToken: "verify-token" });
}

describe("createFeishuAdmission", () => {
  it("reports durable only after the processor accepted the event", async () => {
    const seen: ChannelInboundEvent[] = [];
    const admission = createFeishuAdmission(newDispatcher(), {
      accountId: "default",
      botOpenId: "ou_bot",
      handleInbound: async (event) => {
        seen.push(event);
        return { dispatched: true };
      },
    });
    const result = await admission.invokeWebhookEvent(webhookEnvelope("hello"), {
      needCheck: false,
    });
    expect(result.kind).toBe("durable");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.body).toBe("hello");
  });

  it("reports non-durable when the processor dropped the event", async () => {
    const admission = createFeishuAdmission(newDispatcher(), {
      accountId: "default",
      botOpenId: "ou_bot",
      handleInbound: async () => ({ dispatched: false, reason: "duplicate" }),
    });
    const result = await admission.invokeWebhookEvent(webhookEnvelope("hello"), {
      needCheck: false,
    });
    expect(result.kind).toBe("non-durable");
  });

  it("reports non-durable for an event that is not a turn", async () => {
    const handleInbound = vi.fn();
    const admission = createFeishuAdmission(newDispatcher(), {
      accountId: "default",
      botOpenId: "ou_bot",
      handleInbound,
    });
    const envelope = webhookEnvelope("hello");
    envelope.event.sender.sender_id.open_id = "ou_bot";
    const result = await admission.invokeWebhookEvent(envelope, { needCheck: false });
    expect(result.kind).toBe("non-durable");
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it("answers a poison payload as non-durable instead of throwing (no redelivery loop)", async () => {
    const handleInbound = vi.fn();
    const admission = createFeishuAdmission(newDispatcher(), {
      accountId: "default",
      botOpenId: "ou_bot",
      handleInbound,
    });
    const envelope = webhookEnvelope("hello");
    // A body that decodes but carries no sender: 5xx here would make Lark
    // redeliver it forever.
    (envelope.event as { sender?: unknown }).sender = undefined;

    const result = await admission.invokeWebhookEvent(envelope, { needCheck: false });

    expect(result.kind).toBe("non-durable");
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it("propagates a queue-write failure so the caller can answer 5xx", async () => {
    const admission = createFeishuAdmission(newDispatcher(), {
      accountId: "default",
      botOpenId: "ou_bot",
      handleInbound: async () => {
        throw new Error("queue write failed");
      },
    });
    await expect(
      admission.invokeWebhookEvent(webhookEnvelope("hello"), { needCheck: false }),
    ).rejects.toThrow(/queue write failed/);
  });

  it("keeps concurrent invocations from sharing one durable flag", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admission = createFeishuAdmission(newDispatcher(), {
      accountId: "default",
      botOpenId: "ou_bot",
      handleInbound: async (event) => {
        if (event.externalMessageId === "om_slow") {
          await gate;
          return { dispatched: false, reason: "duplicate" };
        }
        return { dispatched: true };
      },
    });
    const slow = admission.invokeWebhookEvent(webhookEnvelope("slow", "om_slow"), {
      needCheck: false,
    });
    const fast = await admission.invokeWebhookEvent(webhookEnvelope("fast", "om_fast"), {
      needCheck: false,
    });
    release?.();
    expect(fast.kind).toBe("durable");
    // The slow request dropped its event; the fast request's durable admission
    // must not have marked it.
    expect((await slow).kind).toBe("non-durable");
  });
});
