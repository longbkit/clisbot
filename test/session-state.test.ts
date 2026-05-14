import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionState } from "../src/agents/session/session-state.ts";
import { SessionStore } from "../src/agents/session/session-store.ts";
import { createStoredQueueItem } from "../src/agents/queue/queue-state.ts";
import type { ResolvedAgentTarget } from "../src/agents/routing/resolved-target.ts";

function createResolvedTarget(tempDir: string): ResolvedAgentTarget {
  return {
    agentId: "default",
    sessionKey: "agent:default:main",
    mainSessionKey: "agent:default:main",
    sessionName: "agent-default-main",
    workspacePath: join(tempDir, "workspace"),
    runner: {
      command: "codex",
    } as any,
    stream: {} as any,
    session: {} as any,
  };
}

describe("session state runtime reply markers", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("preserves message-tool final markers even after the runtime has gone idle", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-session-state-"));
    const store = new SessionStore(join(tempDir, "sessions.json"));
    const state = new AgentSessionState(store);
    const resolved = createResolvedTarget(tempDir);

    await state.setSessionRuntime(resolved, {
      state: "idle",
      startedAt: Date.now() - 1000,
    });
    await state.recordConversationReply(resolved, "final", "message-tool");

    const runtime = await state.getSessionRuntime({
      sessionKey: resolved.sessionKey,
      agentId: resolved.agentId,
    });

    expect(runtime.state).toBe("idle");
    expect(typeof runtime.finalReplyAt).toBe("number");
    expect(typeof runtime.lastMessageToolReplyAt).toBe("number");
    expect(typeof runtime.messageToolFinalReplyAt).toBe("number");
  });

  test("persists recent conversation replay state per session", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-session-state-"));
    const store = new SessionStore(join(tempDir, "sessions.json"));
    const state = new AgentSessionState(store);
    const resolved = createResolvedTarget(tempDir);

    await state.appendRecentConversationMessage(resolved, {
      marker: "m1",
      text: "first",
    });
    await state.appendRecentConversationMessage(resolved, {
      marker: "m2",
      text: "",
    });
    await state.appendRecentConversationMessage(resolved, {
      marker: "m3",
      text: "third",
    });
    await state.markRecentConversationProcessed(resolved, "m2");

    const replay = await state.getRecentConversationReplayMessages(
      {
        sessionKey: resolved.sessionKey,
      },
      {
        excludeMarker: "m3",
      },
    );

    expect(replay).toEqual([]);

    const entry = await state.getEntry(resolved.sessionKey);
    expect(entry?.recentConversation).toEqual({
      lastProcessedMarker: "m2",
      messages: [
        {
          marker: "m1",
          text: "first",
        },
        {
          marker: "m2",
        },
        {
          marker: "m3",
          text: "third",
        },
      ],
    });
  });

  test("persists and clears pending queue items without removing running items", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-session-state-"));
    const store = new SessionStore(join(tempDir, "sessions.json"));
    const state = new AgentSessionState(store);
    const resolved = createResolvedTarget(tempDir);
    const pending = createStoredQueueItem({
      promptText: "check CI",
      promptSummary: "check CI",
    });
    const running = {
      ...createStoredQueueItem({
        promptText: "deploy",
        promptSummary: "deploy",
      }),
      status: "running" as const,
      startedAt: Date.now(),
    };

    await state.setQueuedItem(resolved, pending);
    await state.setQueuedItem(resolved, running);

    expect((await state.listQueuedItems({ statuses: ["pending"] })).map((item) => item.id))
      .toEqual([pending.id]);

    const cleared = await state.clearPendingQueuedItemsForSessionKey(resolved.sessionKey);
    expect(cleared.map((item) => item.id)).toEqual([pending.id]);
    expect((await state.listQueuedItems()).map((item) => item.id)).toEqual([running.id]);
  });
});
