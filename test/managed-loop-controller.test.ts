import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedLoopController } from "../src/agents/loops/managed-loop-controller.ts";
import { AgentSessionState } from "../src/agents/session/session-state.ts";
import { SessionStore } from "../src/agents/session/session-store.ts";
import type { ResolvedAgentTarget } from "../src/agents/routing/resolved-target.ts";
import { createStoredIntervalLoop } from "../src/agents/loops/loop-definition.ts";

function createResolvedTarget(
  tempDir: string,
  params: {
    chatId: string;
    topicId: string;
  },
): ResolvedAgentTarget {
  return {
    agentId: "default",
    sessionKey: `agent:default:telegram:group:${params.chatId}:topic:${params.topicId}`,
    mainSessionKey: "agent:default:main",
    sessionName: `agent-default-telegram-group-${params.chatId}-topic-${params.topicId}`,
    workspacePath: join(tempDir, `workspace-${params.chatId}-${params.topicId}`),
    runner: {
      command: "codex",
    } as any,
    stream: {} as any,
    session: {} as any,
  };
}

describe("managed loop controller", () => {
  test("keeps loops from different sessions isolated even when their ids match", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-managed-loop-"));
    try {
      const sessionState = new AgentSessionState(new SessionStore(join(tempDir, "sessions.json")));
      const first = createResolvedTarget(tempDir, { chatId: "123", topicId: "456" });
      const second = createResolvedTarget(tempDir, { chatId: "123", topicId: "789" });
      const sharedLoopId = "shared-loop";

      await sessionState.setIntervalLoop(first, {
        ...createStoredIntervalLoop({
          promptText: "first loop",
          promptSummary: "first loop",
          promptSource: "custom",
          intervalMs: 60_000,
          maxRuns: 3,
          force: false,
        }),
        id: sharedLoopId,
        nextRunAt: Date.now() + 60_000,
      });
      await sessionState.setIntervalLoop(second, {
        ...createStoredIntervalLoop({
          promptText: "second loop",
          promptSummary: "second loop",
          promptSource: "custom",
          intervalMs: 60_000,
          maxRuns: 3,
          force: false,
        }),
        id: sharedLoopId,
        nextRunAt: Date.now() + 60_000,
      });

      const controller = new ManagedLoopController({
        sessionState,
        surfaceRuntime: {
          notifyManagedLoopStart: async () => undefined,
          buildManagedLoopPrompt: async () => "",
        } as any,
        getLoopConfig: () => ({
          maxRunsPerLoop: 10,
          maxActiveLoops: 10,
        }),
        resolveTarget: (target) => target.sessionKey === first.sessionKey ? first : second,
        isSessionBusy: async () => false,
        enqueuePrompt: () => ({
          positionAhead: 0,
          result: Promise.resolve({
            status: "completed",
            agentId: "default",
            sessionKey: first.sessionKey,
            sessionName: "session",
            workspacePath: tempDir,
            snapshot: "done",
            fullSnapshot: "done",
            initialSnapshot: "",
          }),
        }),
        shouldSuppressShutdownError: () => false,
      });

      await controller.reconcilePersistedIntervalLoops();

      expect(controller.listIntervalLoops()).toHaveLength(2);
      expect(controller.listIntervalLoops({ sessionKey: first.sessionKey })).toHaveLength(1);
      expect(controller.listIntervalLoops({ sessionKey: second.sessionKey })).toHaveLength(1);
      expect(controller.getIntervalLoop(first.sessionKey, sharedLoopId)?.promptText).toBe("first loop");
      expect(controller.getIntervalLoop(second.sessionKey, sharedLoopId)?.promptText).toBe("second loop");

      expect(await controller.cancelIntervalLoop(first, sharedLoopId)).toBe(true);
      expect(controller.getIntervalLoop(first.sessionKey, sharedLoopId)).toBeNull();
      expect(controller.getIntervalLoop(second.sessionKey, sharedLoopId)?.promptText).toBe("second loop");
      expect(controller.listIntervalLoops()).toHaveLength(1);
      controller.clear();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
