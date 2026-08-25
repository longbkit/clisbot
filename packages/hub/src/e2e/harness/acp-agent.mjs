#!/usr/bin/env node
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";

const sdk = await import(pathToFileURL(requiredEnvironment("HUB_E2E_ACP_SDK")).href);

class PhaseFiveAgent {
  constructor(connection) {
    this.connection = connection;
  }

  async initialize() {
    return { protocolVersion: sdk.PROTOCOL_VERSION, agentCapabilities: { loadSession: false } };
  }

  async newSession(params) {
    this.cwd = params.cwd;
    this.hubMcp = params.mcpServers?.find((server) => server.name === "hub");
    return {
      sessionId: crypto.randomUUID(),
      modes: {
        currentModeId: "default",
        availableModes: [{ id: "default", name: "Default" }],
      },
    };
  }

  async authenticate() {
    return {};
  }

  async setSessionMode() {
    return {};
  }

  async cancel() {}

  async prompt(params) {
    const prompt = params.prompt
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const service = /Deploy ([^ ]+) for/u.exec(prompt)?.[1] ?? "unknown";
    const output = `phase-five:${service}`;
    const executionId = this.hubMcp ? executionIdFromMcp(this.hubMcp) : null;
    let replySucceeded = null;
    let duplicateRejected = null;
    if (service === "mcp-capability" && this.hubMcp) {
      await initializeMcp(this.hubMcp);
      const reply = await callMcp(this.hubMcp, 2, "tools/call", {
        name: "reply",
        arguments: { content: output },
      });
      const duplicate = await callMcp(this.hubMcp, 3, "tools/call", {
        name: "reply",
        arguments: { content: `${output}:duplicate` },
      });
      replySucceeded = reply.result?.isError !== true;
      duplicateRejected = duplicate.result?.isError === true;
    }
    await appendFile(
      requiredEnvironment("HUB_E2E_ACP_RECORD_FILE"),
      `${JSON.stringify({
        prompt,
        cwd: this.cwd,
        output,
        executionId,
        completionUrl: this.hubMcp?.url ?? null,
        replySucceeded,
        duplicateRejected,
        secretCompletionEnvPresent: [
          "PASEO_HUB_EXECUTION_ID",
          "PASEO_HUB_EXECUTION_DONE_URL",
          "PASEO_HUB_EXECUTION_DONE_TOKEN",
          "PASEO_HUB_EXECUTION_ID",
        ].some((name) => process.env[name] !== undefined),
      })}\n`,
    );
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: output,
        },
      },
    });
    if (service === "daemon-restart" || prompt.includes("daemon-restart"))
      await runUntilInterrupted();
    if (this.hubMcp) await scheduleHubCompletion(this.hubMcp);
    return { stopReason: "end_turn" };
  }
}

async function scheduleHubCompletion(server) {
  const executionId = executionIdFromMcp(server);
  const jobs = requiredEnvironment("HUB_E2E_COMPLETION_JOBS");
  await mkdir(jobs, { recursive: true });
  const jobPath = join(jobs, `${executionId}.json`);
  const temporaryPath = `${jobPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(server), { mode: 0o600 });
  await rename(temporaryPath, jobPath);
}

async function initializeMcp(server) {
  await callMcp(server, 1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "hub-e2e", version: "1" },
  });
}

async function callMcp(server, id, method, params) {
  if (!server || server.type !== "http") throw new Error("Hub MCP server was not materialized");
  const response = await fetch(server.url, {
    method: "POST",
    headers: mcpHeaders(server),
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!response.ok) throw new Error(`MCP ${method} failed: ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`MCP ${method} protocol error: ${JSON.stringify(body.error)}`);
  return body;
}

function mcpHeaders(server) {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...Object.fromEntries((server?.headers ?? []).map((header) => [header.name, header.value])),
  };
}

function executionIdFromMcp(server) {
  if (!server) throw new Error("Hub MCP server was not materialized");
  const match = /\/agent-executions\/([^/]+)\/mcp$/u.exec(new URL(server.url).pathname);
  if (!match?.[1]) throw new Error("Hub MCP URL has no execution ID");
  return decodeURIComponent(match[1]);
}

async function runUntilInterrupted() {
  await new Promise(() => undefined);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const output = Writable.toWeb(process.stdout);
const input = Readable.toWeb(process.stdin);
new sdk.AgentSideConnection(
  (connection) => new PhaseFiveAgent(connection),
  sdk.ndJsonStream(output, input),
);
