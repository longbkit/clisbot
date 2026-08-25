import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ExternalTrigger, TriggerProvider } from "./index.js";
import {
  notifyAgentExecutionCompleted,
  notifyAgentExecutionFailed,
  notifyAgentExecutionStarted,
  notifyMachineTerminated,
} from "./lifecycle.js";

describe("trigger provider lifecycle hooks", () => {
  it("fires completed, failed, and machine terminated hooks with the correct contexts", async () => {
    const calls: unknown[] = [];
    const provider = createStubProvider(calls);
    const triggerContext = { channel: "internal", messageId: "message-1" };
    const outputContext = { channel: "internal", threadId: "thread-1" };

    await notifyAgentExecutionStarted({
      provider,
      triggerContext,
      outputContext,
    });
    await notifyAgentExecutionCompleted({
      provider,
      triggerContext,
      outputContext,
      result: { status: "succeeded", summary: "done" },
    });
    await notifyAgentExecutionFailed({
      provider,
      triggerContext,
      outputContext,
      reason: "agent_failed",
    });
    await notifyMachineTerminated({
      provider,
      triggerContext,
      reason: "daemon_disconnected_mid_execution",
    });

    assert.deepEqual(calls, [
      ["started", triggerContext, outputContext],
      ["completed", triggerContext, outputContext, { status: "succeeded", summary: "done" }],
      ["failed", triggerContext, outputContext, "agent_failed"],
      ["terminated", triggerContext, "daemon_disconnected_mid_execution"],
    ]);
  });

  it("fires only onMachineTerminated when launch fails before any execution starts", async () => {
    const calls: unknown[] = [];
    const provider = createStubProvider(calls);
    const triggerContext = { channel: "internal", messageId: "message-1" };

    await notifyMachineTerminated({
      provider,
      triggerContext,
      reason: "launch_failed",
    });

    assert.deepEqual(calls, [["terminated", triggerContext, "launch_failed"]]);
  });
});

function createStubProvider(calls: unknown[]): TriggerProvider {
  return {
    name: "stub",
    eventNames: ["stub.event"],
    async match(_trigger: ExternalTrigger) {
      return [];
    },
    async onAgentExecutionStarted(triggerContext, outputContext) {
      calls.push(["started", triggerContext, outputContext]);
    },
    async onAgentExecutionCompleted(triggerContext, outputContext, result) {
      calls.push(["completed", triggerContext, outputContext, result]);
    },
    async onAgentExecutionFailed(triggerContext, outputContext, reason) {
      calls.push(["failed", triggerContext, outputContext, reason]);
    },
    async onMachineTerminated(triggerContext, reason) {
      calls.push(["terminated", triggerContext, reason]);
    },
  };
}
