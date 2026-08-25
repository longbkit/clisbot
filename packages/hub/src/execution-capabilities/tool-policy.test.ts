import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { OutputExecutorRegistry, replyOutputTool } from "./outputs.js";
import { executionToolPolicy } from "./tool-policy.js";

describe("execution tool policy", () => {
  it("preapproves finish plus exactly the materialized execution capabilities", () => {
    const capabilities = new OutputExecutorRegistry();
    capabilities.register({
      type: "discord.reply",
      tool: replyOutputTool,
      available: (context) =>
        typeof context === "object" && context !== null && Reflect.get(context, "reply") === true,
      execute: async () => undefined,
    });
    capabilities.register({
      type: "future.publish",
      tool: {
        name: "publish",
        description: "Publishes the materialized output.",
        inputSchema: { type: "object" },
      },
      execute: async () => undefined,
    });

    const materialized = executionToolPolicy({
      allowOutputs: [
        { type: "discord.reply", max: 1 },
        { type: "future.publish", max: 1 },
      ],
      outputContext: { reply: true },
      capabilities,
    });
    const unavailable = executionToolPolicy({
      allowOutputs: [{ type: "discord.reply", max: 1 }],
      outputContext: { reply: false },
      capabilities,
    });

    assert.deepEqual(materialized, {
      preapproved: [
        { kind: "mcp", server: "hub", tool: "finish_execution" },
        { kind: "mcp", server: "hub", tool: "reply" },
        { kind: "mcp", server: "hub", tool: "publish" },
      ],
    });
    assert.deepEqual(unavailable, {
      preapproved: [{ kind: "mcp", server: "hub", tool: "finish_execution" }],
    });
  });
});
