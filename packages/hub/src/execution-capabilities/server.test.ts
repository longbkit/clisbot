import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { Ajv } from "ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { describe, it, vi } from "vitest";
import { z } from "zod";
import { hashAgentExecutionCompletionToken } from "../agent-executions/completion-token.js";
import type { JsonValue } from "../config/compiler.js";
import { createMemoryDatabase } from "../db/memory.js";
import type { LaunchMachineIntent } from "../dispatcher/launch-machine-intent.js";
import { createFetchServer } from "../http/node-server.js";
import { registerResponseLifecycle, takeResponseLifecycle } from "../http/response-lifecycle.js";
import { OutputExecutorRegistry, replyOutputTool, type OutputCapability } from "./outputs.js";
import { createExecutionCapabilityServer } from "./server.js";

const RpcResponseSchema = z
  .object({
    result: z.unknown().optional(),
    error: z.object({ code: z.number() }).passthrough().optional(),
  })
  .passthrough();
const ToolResultSchema = z.object({ isError: z.boolean().optional() }).passthrough();
const ToolsListSchema = z
  .object({
    tools: z.array(z.object({ name: z.string(), inputSchema: z.unknown() }).passthrough()),
  })
  .passthrough();

describe("execution capability MCP boundary", () => {
  it.each([
    {
      name: "missing bearer",
      request: () => mcpRequest("tools/list"),
      token: undefined,
      expectedStatus: 401,
      expectedCode: undefined,
    },
    {
      name: "wrong bearer",
      request: () => mcpRequest("tools/list"),
      token: "wrong",
      expectedStatus: 401,
      expectedCode: undefined,
    },
    {
      name: "terminal execution",
      request: () => mcpRequest("tools/list"),
      token: "token",
      terminal: true,
      expectedStatus: 409,
      expectedCode: undefined,
    },
    {
      name: "malformed JSON",
      request: () => "{",
      token: "token",
      expectedStatus: 400,
      expectedCode: -32700,
    },
    {
      name: "invalid request",
      request: () => JSON.stringify({ jsonrpc: "1.0", id: 1, method: "ping" }),
      token: "token",
      expectedStatus: 400,
      expectedCode: -32700,
    },
    {
      name: "unsupported method",
      request: () => mcpRequest("resources/list"),
      token: "token",
      expectedStatus: 200,
      expectedCode: -32601,
    },
    {
      name: "unknown tool",
      request: () => mcpRequest("tools/call", { name: "missing", arguments: {} }),
      token: "token",
      expectedStatus: 200,
      expectedCode: undefined,
      expectedToolError: true,
    },
    {
      name: "finish arguments",
      request: () =>
        mcpRequest("tools/call", {
          name: "finish_execution",
          arguments: { summary: "not accepted" },
        }),
      token: "token",
      expectedStatus: 200,
      expectedCode: undefined,
      expectedToolError: true,
    },
    {
      name: "reply arguments",
      request: () =>
        mcpRequest("tools/call", {
          name: "reply",
          arguments: { content: "hello", channelId: "attacker-selected" },
        }),
      token: "token",
      expectedStatus: 200,
      expectedCode: undefined,
      expectedToolError: true,
    },
  ])("handles $name", async (testCase) => {
    const fixture = await capabilityFixture();
    if (testCase.terminal === true) {
      await fixture.database.transitionAgentExecution(fixture.executionId, "failed");
    }
    const response = await fixture.server.handle(
      new Request(`https://hub.test/agent-executions/${fixture.executionId}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(testCase.token === undefined ? {} : { authorization: `Bearer ${testCase.token}` }),
        },
        body: testCase.request(),
      }),
      fixture.executionId,
    );

    assert.equal(response.status, testCase.expectedStatus);
    if (testCase.expectedCode !== undefined || testCase.expectedToolError === true) {
      const body = RpcResponseSchema.parse(await response.json());
      if (testCase.expectedCode !== undefined)
        assert.equal(body.error?.code, testCase.expectedCode);
      if (testCase.expectedToolError === true) {
        assert.equal(ToolResultSchema.parse(body.result).isError, true);
      }
    }
  });

  it("interoperates with the official MCP client for discovery and completion", async () => {
    const fixture = await capabilityFixture();
    const endpoint = await serveFixture(fixture);
    const client = new Client({ name: "paseo-hub-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { authorization: "Bearer token" } },
    });
    try {
      // The SDK's getter is typed `string | undefined` while its Transport interface uses an
      // exact-optional `sessionId?: string`; the runtime class is the SDK's official transport.
      // @ts-expect-error upstream SDK exactOptionalPropertyTypes mismatch
      await client.connect(transport);
      assert.deepEqual(
        (await client.listTools()).tools.map((tool) => tool.name),
        ["finish_execution", "reply"],
      );
      const result = await client.callTool({
        name: "finish_execution",
        arguments: {},
      });
      assert.equal(result.isError, undefined);
      assert.deepEqual(fixture.completions, [{ executionId: fixture.executionId, token: "token" }]);
    } finally {
      await client.close();
      await closeServer(endpoint.server);
    }
  });

  it("renders the structured execution MCP contract exposed by the server", async () => {
    const fixture = await capabilityFixture(undefined, "succeeded", 1, {
      type: "object",
      additionalProperties: false,
      required: ["repo"],
      properties: { repo: { type: "string", enum: ["paseo", "hub"] } },
    });
    const endpoint = await serveFixture(fixture);
    const client = new Client({ name: "paseo-hub-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { authorization: "Bearer token" } },
    });
    try {
      // @ts-expect-error upstream SDK exactOptionalPropertyTypes mismatch
      await client.connect(transport);
      const exposedTools = await client.listTools();
      assert.deepEqual(
        exposedTools.tools.map(({ name, description }) => ({ name, description })),
        [
          {
            name: "finish_execution",
            description: "Completes this execution and records the configured structured output.",
          },
          {
            name: "reply",
            description:
              "Sends a reply to the conversation that triggered this execution. (up to 1 times).",
          },
        ],
      );
      assert.equal(
        exposedTools.tools.find((tool) => tool.name === "finish_execution")?.description,
        "Completes this execution and records the configured structured output.",
      );
      assert.deepEqual(
        exposedTools.tools.find((tool) => tool.name === "finish_execution")?.inputSchema,
        {
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
        },
      );
    } finally {
      await client.close();
      await closeServer(endpoint.server);
    }
  });

  it("flushes a successful MCP response without reconciling the pending archive", async () => {
    let responseFinished = false;
    const fixture = await capabilityFixture(undefined, "succeeded", 1, undefined, true);
    const endpoint = await serveFixture(fixture);
    const observeFinish = (_request: IncomingMessage, response: ServerResponse) => {
      response.once("finish", () => {
        responseFinished = true;
      });
    };
    endpoint.server.on("request", observeFinish);
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: mcpRequest("tools/call", {
          name: "finish_execution",
          arguments: {},
        }),
      });
      assert.equal(response.status, 200);
      await response.text();
      assert.equal(responseFinished, true);
      assert.equal(
        (await fixture.database.findAgentExecutionById(fixture.executionId))?.status,
        "succeeded",
      );
      const execution = await fixture.database.findAgentExecutionById(fixture.executionId);
      assert.equal(execution?.hubAction, "archive");
      assert.equal(execution?.hubActionReadyAt, null);
      assert.equal(execution?.hubActionCompletedAt, null);
    } finally {
      await closeServer(endpoint.server);
    }
  });

  it("closes MCP transport on response abort while leaving the archive pending", async () => {
    const fixture = await capabilityFixture(undefined, "succeeded", 1, undefined, true);
    let releaseBody!: () => void;
    const bodyRelease = new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    let closeObserved!: () => void;
    const transportClosed = new Promise<void>((resolve) => {
      closeObserved = resolve;
    });
    const closeTransport = WebStandardStreamableHTTPServerTransport.prototype["close"];
    const closeSpy = vi
      .spyOn(WebStandardStreamableHTTPServerTransport.prototype, "close")
      .mockImplementation(async function (this: WebStandardStreamableHTTPServerTransport) {
        closeObserved();
        await closeTransport.call(this);
      });
    const server = createFetchServer(async (request) => {
      const response = await fixture.server.handle(request, fixture.executionId);
      const lifecycle = takeResponseLifecycle(response);
      if (lifecycle === undefined || response.body === null) return response;
      const reader = response.body.getReader();
      const delayedBody = new ReadableStream<Uint8Array>({
        async start(controller) {
          const first = await reader.read();
          if (!first.done) controller.enqueue(first.value);
          await bodyRelease;
          for (;;) {
            const next = await reader.read();
            if (next.done) {
              controller.close();
              return;
            }
            controller.enqueue(next.value);
          }
        },
        cancel(reason) {
          void reader.cancel(reason);
        },
      });
      return registerResponseLifecycle(
        new Response(delayedBody, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
        lifecycle,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    try {
      await abortHttpRequestAfterFirstResponseData({
        port: address.port,
        path: `/agent-executions/${fixture.executionId}/mcp`,
        body: mcpRequest("tools/call", { name: "finish_execution", arguments: {} }),
        onFirstData: releaseBody,
      });
      await transportClosed;
      const execution = await fixture.database.findAgentExecutionById(fixture.executionId);
      assert.equal(execution?.status, "succeeded");
      assert.equal(execution?.hubAction, "archive");
      assert.equal(execution?.hubActionReadyAt, null);
      assert.equal(execution?.hubActionCompletedAt, null);
      assert.ok(closeSpy.mock.calls.length >= 1);
    } finally {
      releaseBody();
      closeSpy.mockRestore();
      await closeServer(server);
    }
  });

  it("advertises and enforces the exact configured structured output schema", async () => {
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      $defs: {
        repo: { type: "string", minLength: 3, pattern: "^(paseo|hub)$" },
        count: { type: "integer", minimum: 1, maximum: 3 },
      },
      type: "object",
      additionalProperties: false,
      required: ["repo", "attempts", "tags", "metadata"],
      properties: {
        repo: { $ref: "#/$defs/repo" },
        attempts: {
          oneOf: [{ $ref: "#/$defs/count" }, { const: 99 }],
        },
        tags: {
          type: "array",
          minItems: 1,
          maxItems: 2,
          items: { type: "string", minLength: 2 },
        },
        metadata: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["source"],
              properties: { source: { type: "string" } },
            },
          ],
        },
      },
    };
    const fixture = await capabilityFixture(() => Promise.resolve(), "succeeded", 1, schema);
    const tools = await fixture.call("tools/list");
    const tool = ToolsListSchema.parse(tools.result).tools.find(
      (candidate) => candidate.name === "finish_execution",
    );
    assert.ok(tool);
    assert.ok(isRecord(tool.inputSchema));
    const independentValidator = new Ajv({
      allErrors: true,
      strict: true,
    }).compile(tool.inputSchema);
    assert.equal(
      independentValidator({
        output: {
          repo: "hub",
          attempts: 2,
          tags: ["ok"],
          metadata: { source: "agent" },
        },
      }),
      true,
    );
    assert.equal(
      independentValidator({
        output: { repo: "hub", attempts: 4, tags: ["ok"], metadata: null },
      }),
      false,
    );
    assert.deepEqual(tool?.inputSchema, {
      type: "object",
      additionalProperties: false,
      required: ["output"],
      properties: {
        output: {
          $id: "urn:paseo:hub:finish-execution-output",
          $schema: "http://json-schema.org/draft-07/schema#",
          $defs: {
            repo: { type: "string", minLength: 3, pattern: "^(paseo|hub)$" },
            count: { type: "integer", minimum: 1, maximum: 3 },
          },
          type: "object",
          additionalProperties: false,
          required: ["repo", "attempts", "tags", "metadata"],
          properties: {
            repo: { $ref: "#/$defs/repo" },
            attempts: {
              oneOf: [{ $ref: "#/$defs/count" }, { const: 99 }],
            },
            tags: {
              type: "array",
              minItems: 1,
              maxItems: 2,
              items: { type: "string", minLength: 2 },
            },
            metadata: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["source"],
                  properties: { source: { type: "string" } },
                },
              ],
            },
          },
        },
      },
    });

    const invalid = await fixture.call("tools/call", {
      name: "finish_execution",
      arguments: {
        output: { repo: "hub", attempts: 4, tags: ["ok"], metadata: null },
      },
    });
    assert.equal(ToolResultSchema.parse(invalid.result).isError, true);
    assert.deepEqual(fixture.completions, []);
    assert.equal(
      (await fixture.database.findAgentExecutionById(fixture.executionId))?.status,
      "spawning",
    );

    const valid = await fixture.call("tools/call", {
      name: "finish_execution",
      arguments: {
        output: {
          repo: "hub",
          attempts: 2,
          tags: ["ok"],
          metadata: { source: "agent" },
        },
      },
    });
    assert.equal(ToolResultSchema.parse(valid.result).isError, undefined);
    assert.deepEqual(fixture.completions, [
      {
        executionId: fixture.executionId,
        token: "token",
        output: {
          repo: "hub",
          attempts: 2,
          tags: ["ok"],
          metadata: { source: "agent" },
        },
      },
    ]);
  });

  it("reports a failed durable completion as a tool error", async () => {
    const fixture = await capabilityFixture(undefined, "failed");

    const response = await fixture.call("tools/call", {
      name: "finish_execution",
      arguments: {},
    });

    assert.equal(ToolResultSchema.parse(response.result).isError, true);
    assert.deepEqual(fixture.completions, [{ executionId: fixture.executionId, token: "token" }]);
  });

  it("keeps finish recoverable until a required output is emitted", async () => {
    const fixture = await capabilityFixture(
      undefined,
      "succeeded",
      1,
      undefined,
      false,
      ["slack.reply"],
      { ...replyOutputTool, name: "post_to_slack" },
    );

    const missing = await fixture.call("tools/call", {
      name: "finish_execution",
      arguments: {},
    });
    assert.equal(ToolResultSchema.parse(missing.result).isError, true);
    const missingText = z
      .object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) })
      .parse(missing.result).content[0]?.text;
    assert.match(missingText ?? "", /slack\.reply/iu);
    assert.match(missingText ?? "", /`post_to_slack`/u);
    assert.match(missingText ?? "", /retry `finish_execution`/u);
    assert.deepEqual(fixture.completions, []);
    assert.equal(
      (await fixture.database.findAgentExecutionById(fixture.executionId))?.status,
      "spawning",
    );

    const reply = await fixture.call("tools/call", {
      name: "post_to_slack",
      arguments: { content: "hello" },
    });
    assert.equal(ToolResultSchema.parse(reply.result).isError, undefined);
    assert.deepEqual(
      (await fixture.database.findAgentExecutionById(fixture.executionId))?.outputEmissions,
      { "slack.reply": 1 },
    );

    const completed = await fixture.call("tools/call", {
      name: "finish_execution",
      arguments: {},
    });
    assert.equal(ToolResultSchema.parse(completed.result).isError, undefined);
    assert.deepEqual(fixture.completions, [{ executionId: fixture.executionId, token: "token" }]);
  });

  it("rejects a required output that has no materialized Hub capability", async () => {
    const fixture = await capabilityFixture(undefined, "succeeded", 1, undefined, false, [
      "manual.reply",
    ]);
    const response = await fixture.server.handle(
      new Request(`https://hub.test/agent-executions/${fixture.executionId}/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: mcpRequest("tools/list"),
      }),
      fixture.executionId,
    );
    assert.equal(response.status, 409);
    const body = JSON.stringify(await response.json());
    assert.match(body, /manual\.reply/iu);
    assert.match(body, /register a Hub output tool/iu);
  });

  it("guides and materializes multiple required output capabilities", async () => {
    const fixture = await capabilityFixture(
      undefined,
      "succeeded",
      1,
      undefined,
      false,
      ["slack.reply", "manual.reply"],
      { ...replyOutputTool, name: "post_to_slack" },
      [
        {
          type: "manual.reply",
          tool: { ...replyOutputTool, name: "send_manual_reply" },
          execute: async () => undefined,
        },
      ],
    );
    const missing = await fixture.call("tools/call", {
      name: "finish_execution",
      arguments: {},
    });
    const missingText = z
      .object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) })
      .parse(missing.result).content[0]?.text;
    assert.match(missingText ?? "", /`post_to_slack`/u);
    assert.match(missingText ?? "", /`send_manual_reply`/u);

    for (const name of ["post_to_slack", "send_manual_reply"]) {
      const output = await fixture.call("tools/call", {
        name,
        arguments: { content: name },
      });
      assert.equal(ToolResultSchema.parse(output.result).isError, undefined);
    }
    const completed = await fixture.call("tools/call", {
      name: "finish_execution",
      arguments: {},
    });
    assert.equal(ToolResultSchema.parse(completed.result).isError, undefined);
    assert.deepEqual(
      (await fixture.database.findAgentExecutionById(fixture.executionId))?.outputEmissions,
      { "slack.reply": 1, "manual.reply": 1 },
    );
  });

  it("claims before one reply and rejects a concurrent duplicate with one outbound call", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await capabilityFixture(async () => gate);
    const first = fixture.call("tools/call", {
      name: "reply",
      arguments: { content: "first" },
    });
    await waitFor(() => fixture.outbound.length === 1);
    const duplicate = await fixture.call("tools/call", {
      name: "reply",
      arguments: { content: "second" },
    });
    release();
    const successful = await first;

    assert.equal(successful.error, undefined);
    assert.equal(ToolResultSchema.parse(duplicate.result).isError, true);
    assert.equal(fixture.outbound.length, 1);
    assert.deepEqual(
      fixture.outbound[0] && {
        agentExecutionId: fixture.outbound[0].agentExecutionId,
        toolType: fixture.outbound[0].toolType,
        args: fixture.outbound[0].args,
        outputContext: fixture.outbound[0].outputContext,
      },
      {
        agentExecutionId: fixture.executionId,
        toolType: "slack.reply",
        args: { content: "first" },
        outputContext: slackOutputContext,
      },
    );
    assert.equal(typeof fixture.outbound[0]?.attemptId, "string");
  });

  it("allows replies up to the configured maximum", async () => {
    const fixture = await capabilityFixture(() => Promise.resolve(), "succeeded", 3);

    for (const content of ["first", "second", "third"]) {
      const response = await fixture.call("tools/call", {
        name: "reply",
        arguments: { content },
      });
      assert.equal(ToolResultSchema.parse(response.result).isError, undefined);
    }
    const exhausted = await fixture.call("tools/call", {
      name: "reply",
      arguments: { content: "fourth" },
    });

    assert.equal(ToolResultSchema.parse(exhausted.result).isError, true);
    assert.equal(fixture.outbound.length, 3);
  });

  it("allows a failed required reply delivery to be retried before finish", async () => {
    let attempts = 0;
    const fixture = await capabilityFixture(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("delivery timeout");
      },
      "succeeded",
      1,
      undefined,
      false,
      ["slack.reply"],
    );
    const failed = await fixture.call("tools/call", {
      name: "reply",
      arguments: { content: "first" },
    });
    const retry = await fixture.call("tools/call", {
      name: "reply",
      arguments: { content: "second" },
    });

    assert.equal(ToolResultSchema.parse(failed.result).isError, true);
    assert.equal(ToolResultSchema.parse(retry.result).isError, undefined);
    assert.equal(
      (await fixture.database.findAgentExecutionById(fixture.executionId))?.outputEmissions[
        "slack.reply"
      ],
      1,
    );
    const completed = await fixture.call("tools/call", {
      name: "finish_execution",
      arguments: {},
    });
    assert.equal(ToolResultSchema.parse(completed.result).isError, undefined);
    assert.equal(fixture.outbound.length, 2);
  });
});

const slackOutputContext = {
  provider: "slack",
  teamId: "T1",
  channelId: "C1",
  threadTs: "100.1",
  messageTs: "100.2",
};

async function capabilityFixture(
  execute: (() => Promise<void>) | undefined = () => Promise.resolve(),
  completionStatus: "succeeded" | "failed" = "succeeded",
  maxReplies = 1,
  outputSchema?: JsonValue,
  autoArchive = false,
  requiredOutputTypes: readonly string[] = [],
  outputTool = replyOutputTool,
  additionalCapabilities: readonly OutputCapability[] = [],
) {
  const database = createMemoryDatabase();
  const executionId = randomUUID();
  const token = "token";
  const intent = launchIntent(maxReplies, outputSchema, autoArchive, requiredOutputTypes);
  await database.insertAgentExecution({
    id: executionId,
    organizationId: "org-1",
    projectId: "project-1",
    machineId: null,
    triggerContext: { provider: "slack" },
    outputContext: slackOutputContext,
    configurationRevisionId: randomUUID(),
    completionTokenHash: hashAgentExecutionCompletionToken(token),
    launchIntent: intent,
  });
  const outbound: Array<import("./outputs.js").OutputExecutionInput> = [];
  const outputs = new OutputExecutorRegistry();
  outputs.register({
    type: "slack.reply",
    tool: outputTool,
    execute: async (input) => {
      outbound.push(input);
      await execute();
    },
  });
  for (const capability of additionalCapabilities) outputs.register(capability);
  const completions: Array<{
    executionId: string;
    token: string;
    output?: unknown;
  }> = [];
  const server = createExecutionCapabilityServer({
    database,
    outputs,
    async completeExecution(input) {
      completions.push(input);
      return (
        await database.transitionAgentExecution(
          input.executionId,
          completionStatus,
          autoArchive ? { hubAction: "archive" } : undefined,
        )
      ).execution;
    },
  });
  let id = 0;
  return {
    database,
    executionId,
    intent,
    server,
    outputs,
    outbound,
    completions,
    async call(method: string, params?: unknown) {
      id += 1;
      const response = await server.handle(
        new Request(`https://hub.test/agent-executions/${executionId}/mcp`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: mcpRequest(method, params, id),
        }),
        executionId,
      );
      return RpcResponseSchema.parse(await response.json());
    },
  };
}

async function serveFixture(fixture: Awaited<ReturnType<typeof capabilityFixture>>) {
  const server = createFetchServer((request) =>
    fixture.server.handle(request, fixture.executionId),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("MCP fixture did not bind a TCP port");
  }
  return { server, url: `http://127.0.0.1:${address.port}/mcp` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function abortHttpRequestAfterFirstResponseData(options: {
  port: number;
  path: string;
  body: string;
  onFirstData: () => void;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let clientAborted = false;
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: options.port,
        path: options.path,
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
      },
      (response) => {
        response.once("data", () => {
          clientAborted = true;
          request.destroy();
          options.onFirstData();
        });
        response.once("close", resolve);
        response.once("error", (error) => {
          if (!clientAborted) reject(error);
        });
        response.resume();
      },
    );
    request.once("error", (error) => {
      if (!clientAborted) reject(error);
    });
    request.end(options.body);
  });
}

function launchIntent(
  maxReplies = 1,
  outputSchema?: JsonValue,
  autoArchive = false,
  requiredOutputTypes: readonly string[] = [],
): LaunchMachineIntent {
  return {
    kind: "launch_machine",
    organizationId: "org-1",
    projectId: "project-1",
    triggerRunId: randomUUID(),
    triggerName: "slack-mention",
    environmentName: "daemon",
    environment: {
      kind: "daemon",
      daemonId: "daemon-1",
      authoredSlug: "daemon",
      cwd: "/workspace",
    },
    prompt: "reply",
    agent: { provider: "codex", mode: "full-access" },
    allowOutputs: [
      {
        type: "slack.reply",
        max: maxReplies,
        ...(requiredOutputTypes.includes("slack.reply") ? { required: true } : {}),
      },
      ...requiredOutputTypes
        .filter((type) => type !== "slack.reply")
        .map((type) => ({ type, max: 1, required: true as const })),
    ],
    autoArchive,
    triggerContext: { provider: "slack" },
    outputContext: slackOutputContext,
    ...(outputSchema === undefined ? {} : { outputSchema }),
    configurationRevisionId: randomUUID(),
    hubConfig: {},
  };
}

function mcpRequest(method: string, params?: unknown, id = 1): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params === undefined ? {} : { params }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition not met");
}
