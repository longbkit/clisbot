import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentJobQueue } from "../src/agents/queue/job-queue.ts";
import { ManagedQueueController } from "../src/agents/queue/managed-queue-controller.ts";
import { createStoredQueueItem, type StoredQueueItem } from "../src/agents/queue/queue-state.ts";
import type { ResolvedAgentTarget } from "../src/agents/routing/resolved-target.ts";
import { AgentSessionState } from "../src/agents/session/session-state.ts";
import { SessionStore } from "../src/agents/session/session-store.ts";

function waitForCondition(condition: () => Promise<boolean>, timeoutMs = 2_000) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = async () => {
      if (await condition()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("timed out waiting for condition"));
        return;
      }
      setTimeout(() => void poll(), 25);
    };
    void poll();
  });
}

function createResolvedTarget(
  tempDir: string,
  params: {
    chatId?: string;
    topicId?: string;
  } = {},
): ResolvedAgentTarget {
  const chatId = params.chatId ?? "123";
  const topicId = params.topicId ?? "456";
  return {
    agentId: "default",
    sessionKey: `agent:default:telegram:group:${chatId}:topic:${topicId}`,
    mainSessionKey: "agent:default:main",
    sessionName: `agent-default-telegram-group-${chatId}-topic-${topicId}`,
    workspacePath: join(tempDir, `workspace-${chatId}-${topicId}`),
    runner: {
      command: "codex",
    } as any,
    stream: {} as any,
    session: {} as any,
  };
}

describe("managed durable queue", () => {
  test("settles a persisted running item when the queued run sends a message-tool final", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-managed-queue-"));
    try {
      const sessionState = new AgentSessionState(new SessionStore(join(tempDir, "sessions.json")));
      const resolved = createResolvedTarget(tempDir);
      const target = {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
      };
      const item = createStoredQueueItem({
        promptText: "queued prompt",
        promptSummary: "queued prompt",
        surfaceBinding: {
          platform: "telegram",
          accountId: "default",
          conversationKind: "group",
          chatId: "123",
          topicId: "456",
        },
      });
      await sessionState.setQueuedItem(resolved, item);

      let settlementNotifications = 0;
      let executeStarted = false;
      const controller = new ManagedQueueController({
        queue: new AgentJobQueue(),
        sessionState,
        activeRuns: {
          executePrompt: async () => {
            executeStarted = true;
            await sessionState.setSessionRuntime(resolved, {
              state: "running",
              startedAt: Date.now(),
            });
            setTimeout(() => {
              void sessionState.recordConversationReply(resolved, "final", "message-tool");
            }, 10);
            return await new Promise<never>(() => undefined);
          },
        } as any,
        surfaceRuntime: {
          notifyManagedQueueStart: async () => undefined,
          buildManagedQueuePrompt: async () => "queued prompt",
          notifyManagedQueueSettlement: async () => {
            settlementNotifications += 1;
          },
          notifyManagedQueueFailure: async () => undefined,
        } as any,
        getQueueConfig: () => ({ maxPendingItemsPerSession: 10 }),
        resolveTarget: () => resolved,
        hasBlockingActiveRun: async () => false,
        shouldSuppressShutdownError: () => false,
      });

      await controller.reconcilePersistedQueueItems();

      await waitForCondition(async () => executeStarted, 5_000);
      await waitForCondition(async () => (await sessionState.listQueuedItems()).length === 0, 5_000);
      expect(await sessionState.listQueuedItems()).toEqual([]);
      expect(settlementNotifications).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, { timeout: 15_000 });

  test("clears stale persisted running items after the session becomes idle", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-managed-queue-"));
    try {
      const sessionState = new AgentSessionState(new SessionStore(join(tempDir, "sessions.json")));
      const resolved = createResolvedTarget(tempDir);
      const target = {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
      };
      const running = {
        ...createStoredQueueItem({
          promptText: "old running prompt",
          promptSummary: "old running prompt",
        }),
        status: "running" as const,
        createdAt: Date.now() - 2_000,
        startedAt: Date.now() - 1_000,
      };
      const pending = {
        ...createStoredQueueItem({
          promptText: "next prompt",
          promptSummary: "next prompt",
          surfaceBinding: {
            platform: "telegram",
            accountId: "default",
            conversationKind: "group",
            chatId: "123",
            topicId: "456",
          },
        }),
        createdAt: Date.now() - 500,
      };
      await sessionState.setQueuedItem(resolved, running);
      await sessionState.setQueuedItem(resolved, pending);

      let hasBlockingRun = true;
      const executedPrompts: string[] = [];
      const controller = new ManagedQueueController({
        queue: new AgentJobQueue(),
        sessionState,
        activeRuns: {
          executePrompt: async (_target: unknown, prompt: string) => {
            executedPrompts.push(prompt);
            return {
              status: "completed",
              agentId: resolved.agentId,
              sessionKey: resolved.sessionKey,
              sessionName: resolved.sessionName,
              workspacePath: resolved.workspacePath,
              snapshot: "done",
              fullSnapshot: "done",
              initialSnapshot: "",
            };
          },
        } as any,
        surfaceRuntime: {
          notifyManagedQueueStart: async () => undefined,
          buildManagedQueuePrompt: async (_agentId: string, item: StoredQueueItem) =>
            item.promptText,
          notifyManagedQueueSettlement: async () => undefined,
          notifyManagedQueueFailure: async () => undefined,
        } as any,
        getQueueConfig: () => ({ maxPendingItemsPerSession: 10 }),
        resolveTarget: () => resolved,
        hasBlockingActiveRun: async () => hasBlockingRun,
        shouldSuppressShutdownError: () => false,
      });

      await controller.reconcilePersistedQueueItems();
      expect((await sessionState.listQueuedItems()).map((item) => item.id))
        .toEqual([running.id, pending.id]);

      hasBlockingRun = false;
      await controller.reconcilePersistedQueueItems();
      await waitForCondition(async () => executedPrompts.length === 1, 5_000);
      await waitForCondition(async () => (await sessionState.listQueuedItems()).length === 0, 5_000);

      expect(executedPrompts).toEqual(["next prompt"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, { timeout: 15_000 });

  test("keeps pending items from different sessions isolated even when their queue ids match", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-managed-queue-"));
    try {
      const sessionState = new AgentSessionState(new SessionStore(join(tempDir, "sessions.json")));
      const first = createResolvedTarget(tempDir, { chatId: "123", topicId: "456" });
      const second = createResolvedTarget(tempDir, { chatId: "123", topicId: "789" });
      const sharedId = "shared-id";

      await sessionState.setQueuedItem(first, {
        ...createStoredQueueItem({
          promptText: "first prompt",
          promptSummary: "first prompt",
        }),
        id: sharedId,
      });
      await sessionState.setQueuedItem(second, {
        ...createStoredQueueItem({
          promptText: "second prompt",
          promptSummary: "second prompt",
        }),
        id: sharedId,
      });

      const executed: string[] = [];
      const controller = new ManagedQueueController({
        queue: new AgentJobQueue(),
        sessionState,
        activeRuns: {
          executePrompt: async (target: { sessionKey: string }, prompt: string) => {
            executed.push(`${target.sessionKey}:${prompt}`);
            return {
              status: "completed",
              agentId: "default",
              sessionKey: target.sessionKey,
              sessionName: target.sessionKey,
              workspacePath: tempDir,
              snapshot: "done",
              fullSnapshot: "done",
              initialSnapshot: "",
            };
          },
        } as any,
        surfaceRuntime: {
          notifyManagedQueueStart: async () => undefined,
          buildManagedQueuePrompt: async (_agentId: string, item: StoredQueueItem) =>
            item.promptText,
          notifyManagedQueueSettlement: async () => undefined,
          notifyManagedQueueFailure: async () => undefined,
        } as any,
        getQueueConfig: () => ({ maxPendingItemsPerSession: 10 }),
        resolveTarget: (target: { sessionKey: string }) =>
          target.sessionKey === first.sessionKey ? first : second,
        hasBlockingActiveRun: async () => false,
        shouldSuppressShutdownError: () => false,
      });

      await controller.reconcilePersistedQueueItems();
      await waitForCondition(async () => executed.length === 2, 20_000);
      await waitForCondition(async () => (await sessionState.listQueuedItems()).length === 0, 20_000);

      expect(executed).toEqual([
        `${first.sessionKey}:first prompt`,
        `${second.sessionKey}:second prompt`,
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 25_000);

  test("reconcile removes a missing session item without clearing another session's matching queue id", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-managed-queue-"));
    try {
      const sessionState = new AgentSessionState(new SessionStore(join(tempDir, "sessions.json")));
      const first = createResolvedTarget(tempDir, { chatId: "123", topicId: "456" });
      const second = createResolvedTarget(tempDir, { chatId: "123", topicId: "789" });
      const sharedId = "shared-id";

      await sessionState.setQueuedItem(first, {
        ...createStoredQueueItem({
          promptText: "first prompt",
          promptSummary: "first prompt",
        }),
        id: sharedId,
      });
      await sessionState.setQueuedItem(second, {
        ...createStoredQueueItem({
          promptText: "second prompt",
          promptSummary: "second prompt",
        }),
        id: sharedId,
      });

      let hasBlockingRun = true;
      const executed: string[] = [];
      const controller = new ManagedQueueController({
        queue: new AgentJobQueue(),
        sessionState,
        activeRuns: {
          executePrompt: async (target: { sessionKey: string }, prompt: string) => {
            executed.push(`${target.sessionKey}:${prompt}`);
            return {
              status: "completed",
              agentId: "default",
              sessionKey: target.sessionKey,
              sessionName: target.sessionKey,
              workspacePath: tempDir,
              snapshot: "done",
              fullSnapshot: "done",
              initialSnapshot: "",
            };
          },
        } as any,
        surfaceRuntime: {
          notifyManagedQueueStart: async () => undefined,
          buildManagedQueuePrompt: async (_agentId: string, item: StoredQueueItem) =>
            item.promptText,
          notifyManagedQueueSettlement: async () => undefined,
          notifyManagedQueueFailure: async () => undefined,
        } as any,
        getQueueConfig: () => ({ maxPendingItemsPerSession: 10 }),
        resolveTarget: (target: { sessionKey: string }) =>
          target.sessionKey === first.sessionKey ? first : second,
        hasBlockingActiveRun: async () => hasBlockingRun,
        shouldSuppressShutdownError: () => false,
      });

      await controller.reconcilePersistedQueueItems();
      await sessionState.removeQueuedItem(first, sharedId);

      hasBlockingRun = false;
      await controller.reconcilePersistedQueueItems();
      await waitForCondition(async () => executed.length === 1);

      expect(executed).toEqual([`${second.sessionKey}:second prompt`]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, { timeout: 15_000 });
});
