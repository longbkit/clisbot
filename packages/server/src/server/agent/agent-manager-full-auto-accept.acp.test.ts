import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { FULL_AUTO_ACCEPT_MODE_ID } from "./full-auto-accept.js";
import { GenericACPAgentClient } from "./providers/generic-acp-agent.js";

const logger = createTestLogger();
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/**
 * A real ACP agent process (JSON-RPC over stdio) behind the real ACP client and the
 * AgentManager, with no app connected. Turn one asks for a tool permission and asks a
 * single-choice question shaped as ACP options; turn two reports how each was answered.
 */
const FAKE_ACP_AGENT = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const answers = {};
let prompts = 0;
let pendingPrompt = null;
function write(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
}
function ask(sessionId, id, toolCallId, title, options) {
  const toolCall = { toolCallId, title, kind: "execute", status: "pending" };
  write({ method: "session/update", params: { sessionId, update: { sessionUpdate: "tool_call", ...toolCall } } });
  write({ id, method: "session/request_permission", params: { sessionId, toolCall, options } });
}
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === undefined && typeof message.id === "string") {
    answers[message.id] = message.result ?? { error: message.error };
    if (message.id === "perm-tool" && pendingPrompt !== null) {
      write({ id: pendingPrompt, result: { stopReason: "end_turn" } });
      pendingPrompt = null;
    }
    return;
  }
  if (message.method === "initialize") {
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
    return;
  }
  if (message.method === "session/new") {
    write({ id: message.id, result: {
      sessionId: "session-1",
      modes: { currentModeId: "ask", availableModes: [
        { id: "ask", name: "Ask" },
        { id: "yolo", name: "YOLO" },
      ] },
    } });
    return;
  }
  if (message.method === "session/prompt") {
    const sessionId = message.params.sessionId;
    prompts += 1;
    if (prompts === 1) {
      pendingPrompt = message.id;
      ask(sessionId, "perm-choice", "question-1", "Which path?", [
        { optionId: "narrow", name: "Narrow fix", kind: "allow_once" },
        { optionId: "wide", name: "Protocol fix", kind: "allow_once" },
        { optionId: "skip", name: "Skip", kind: "reject_once" },
      ]);
      ask(sessionId, "perm-tool", "tool-1", "rm -rf build", [
        { optionId: "allow", name: "Allow once", kind: "allow_once" },
        { optionId: "always", name: "Always allow", kind: "allow_always" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ]);
      return;
    }
    write({ method: "session/update", params: { sessionId, update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: JSON.stringify(answers) },
    } } });
    write({ id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  if (message.id !== undefined) write({ id: message.id, result: {} });
});
`;

async function startAcpAgent() {
  const dir = await mkdtemp(path.join(tmpdir(), "clisbot-full-auto-accept-acp-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const script = path.join(dir, "fake-acp-agent.cjs");
  await writeFile(script, FAKE_ACP_AGENT, "utf8");
  const client = new GenericACPAgentClient({ logger, command: [process.execPath, script] });
  const manager = new AgentManager({ clients: { acp: client }, logger });
  const agent = await manager.createAgent({ provider: "acp", cwd: dir }, undefined, {
    workspaceId: undefined,
  });
  cleanups.push(async () => {
    await manager.closeAgent(agent.id).catch(() => undefined);
  });
  return { manager, agentId: agent.id };
}

function pendingToolCallIds(manager: AgentManager, agentId: string): unknown[] {
  const pending = manager.getAgent(agentId)?.pendingPermissions.values() ?? [];
  return [...pending].map((request) => request.metadata?.toolCallId);
}

describe("Full auto-accept over a real ACP process", () => {
  test("approves the tool request with allow once and leaves the choice to a person", async () => {
    const { manager, agentId } = await startAcpAgent();
    await manager.setAgentMode(agentId, FULL_AUTO_ACCEPT_MODE_ID);
    expect(manager.getAgent(agentId)?.config.fullAutoAccept).toBe(true);
    // A generic ACP agent marks no mode as no-prompt, so it keeps its current one.
    expect(manager.getAgent(agentId)?.currentModeId).toBe("ask");

    await manager.runAgent(agentId, "do the work");
    expect(pendingToolCallIds(manager, agentId)).not.toContain("tool-1");

    const report = await manager.runAgent(agentId, "how were you answered?");
    const answers = JSON.parse(report.finalText) as Record<string, unknown>;
    expect(answers["perm-tool"]).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
    // The choice was never picked for the user; the turn's end cancelled it.
    expect(answers["perm-choice"]).not.toEqual(
      expect.objectContaining({ outcome: expect.objectContaining({ outcome: "selected" }) }),
    );
  }, 20_000);

  test("without Full auto-accept the same tool request waits", async () => {
    const { manager, agentId } = await startAcpAgent();
    const run = manager.runAgent(agentId, "do the work");
    await expect.poll(() => pendingToolCallIds(manager, agentId)).toEqual(["question-1", "tool-1"]);
    await manager.cancelAgentRun(agentId).catch(() => undefined);
    await run.catch(() => undefined);
  }, 20_000);
});
