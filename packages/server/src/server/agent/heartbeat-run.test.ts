import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { AgentManager } from "./agent-manager.js";
import type { AgentRunOptions, AgentStreamEvent } from "./agent-sdk-types.js";
import { PromptNotDeliveredError } from "./prompt-not-delivered-error.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const run: NonNullable<AgentRunOptions["heartbeatRun"]> = {
  message: "Heartbeat · CI · run 3",
  metadata: { scheduleId: "ci", name: "CI", run: 3, maxRuns: null },
};

async function fixture(rejectFirst = false) {
  const cwd = await mkdtemp(join(tmpdir(), "heartbeat-metadata-"));
  directories.push(cwd);
  const clients = createTestAgentClients();
  const provider = clients.claude!;
  const create = provider.createSession.bind(provider);
  const received: Array<{ prompt: unknown; options?: AgentRunOptions }> = [];
  provider.createSession = async (...args) => {
    const session = await create(...args);
    const start = session.startTurn.bind(session);
    session.startTurn = async (prompt, options) => {
      received.push({ prompt, options });
      if (rejectFirst && received.length === 1)
        throw new PromptNotDeliveredError("fixture rejected startup");
      return start(prompt, options);
    };
    return session;
  };
  const manager = new AgentManager({ logger: createTestLogger(), clients });
  const agent = await manager.createAgent(
    { provider: "claude", cwd, modeId: "bypassPermissions" },
    undefined,
    { workspaceId: undefined },
  );
  return { manager, agentId: agent.id, received };
}

test("heartbeat metadata is daemon-only and survives on the exact streamed/persisted turn", async () => {
  const { manager, agentId, received } = await fixture();
  const events: AgentStreamEvent[] = [];
  const unsubscribe = manager.subscribe(
    (event) => {
      if (event.type === "agent_stream") events.push(event.event);
    },
    { agentId, replayState: false },
  );
  for await (const _ of manager.streamAgent(agentId, "Unchanged prompt", {
    heartbeatRun: run,
    maxThinkingTokens: 128,
  })) {
    /* drain */
  }
  unsubscribe();
  expect(received).toEqual([{ prompt: "Unchanged prompt", options: { maxThinkingTokens: 128 } }]);
  const notice = events.find(
    (event) => event.type === "timeline" && event.item.type === "notification",
  );
  const reply = events.find(
    (event) => event.type === "timeline" && event.item.type === "assistant_message",
  );
  expect(notice).toMatchObject({ type: "timeline", item: { heartbeatRun: run.metadata } });
  expect(notice?.turnId).toBeTruthy();
  expect(reply?.turnId).toBe(notice?.turnId);
  const row = (await manager.getTimelineRows(agentId)).find(
    (entry) => entry.item.type === "notification",
  );
  expect(row?.turnId).toBe(notice?.turnId);
  expect(row?.item).toMatchObject({ heartbeatRun: run.metadata });
  if (process.env.CTO023_EVIDENCE)
    await writeFile(
      join(process.env.CTO023_EVIDENCE, "canonical-accepted-turn.json"),
      JSON.stringify(
        {
          agentId,
          providerReceived: received,
          stream: events,
          rows: await manager.getTimelineRows(agentId),
        },
        null,
        2,
      ),
    );
});

test("failed heartbeat startup leaves no notice for the next manual turn", async () => {
  const { manager, agentId } = await fixture(true);
  const drain = async () => {
    for await (const _ of manager.streamAgent(agentId, "Rejected fixture", { heartbeatRun: run })) {
      /* drain */
    }
  };
  await expect(drain()).rejects.toThrow("fixture rejected startup");
  for await (const _ of manager.streamAgent(agentId, "Manual next turn")) {
    /* drain */
  }
  expect(manager.getTimeline(agentId).some((item) => item.type === "notification")).toBe(false);
});
