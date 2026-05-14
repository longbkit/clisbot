import { AgentJobQueue, ClearedQueuedTaskError, type PendingQueueItem } from "./job-queue.ts";
import type { QueuedPromptStatus, StoredQueueItem } from "./queue-state.ts";
import type { RunUpdate } from "../session/run-observation.ts";
import type { AgentSessionTarget, ResolvedAgentTarget } from "../routing/resolved-target.ts";
import { AgentSessionState } from "../session/session-state.ts";
import { SessionService } from "../session/session-service.ts";
import { SurfaceRuntime } from "../runtime/surface-runtime.ts";
import type { LatencyDebugContext } from "../../control/runtime/latency-debug.ts";
import { sleep } from "../../infra/process.ts";

const QUEUE_MESSAGE_TOOL_FINAL_POLL_MS = 250;

type QueueConfig = {
  maxPendingItemsPerSession: number;
};

type ManagedQueueItem = {
  target: AgentSessionTarget;
  item: StoredQueueItem;
  persisting?: boolean;
};

type ManagedQueueRunUpdate = RunUpdate & {
  messageToolFinalAlreadySent?: boolean;
};

type QueueControllerDeps = {
  queue: AgentJobQueue;
  sessionState: AgentSessionState;
  activeRuns: SessionService;
  surfaceRuntime: SurfaceRuntime;
  getQueueConfig: () => QueueConfig;
  resolveTarget: (target: AgentSessionTarget) => ResolvedAgentTarget;
  hasBlockingActiveRun: (target: AgentSessionTarget) => Promise<boolean>;
  shouldSuppressShutdownError: (error: unknown) => boolean;
};

export type QueuePromptCallbacks = {
  onUpdate: (update: RunUpdate) => Promise<void> | void;
  observerId?: string;
  timingContext?: LatencyDebugContext;
  queueText?: string;
  queueItem?: StoredQueueItem;
};

export type PromptQueueResult = {
  positionAhead: number;
  result: Promise<RunUpdate>;
  persisted?: Promise<void>;
};

export class ManagedQueueController {
  private queuedItems = new Map<string, ManagedQueueItem>();

  constructor(private readonly deps: QueueControllerDeps) {}

  clear() {
    this.queuedItems.clear();
  }

  async listQueuedPrompts(target: AgentSessionTarget): Promise<PendingQueueItem[]> {
    const persisted = await this.deps.sessionState.listQueuedItems({
      sessionKey: target.sessionKey,
      statuses: ["pending"],
    });
    return persisted.map((item) => ({
      id: item.id,
      text: item.promptSummary,
      createdAt: item.createdAt,
    }));
  }

  async clearQueuedPrompts(target: AgentSessionTarget) {
    const clearedStored =
      await this.deps.sessionState.clearPendingQueuedItemsForSessionKey(target.sessionKey);
    this.deps.queue.clearPendingByIdsForKey(target.sessionKey, clearedStored.map((item) => item.id));
    return clearedStored.length;
  }

  enqueuePrompt(
    target: AgentSessionTarget,
    prompt: string | (() => string),
    callbacks: QueuePromptCallbacks,
  ): PromptQueueResult {
    const queueItem = callbacks.queueItem;
    const persisted = this.preparePersistedQueueItem(target, queueItem);
    const reconciledBeforeStart = this.reconcilePersistedQueueItems().catch((error) => {
      console.error("queue reconcile before prompt start failed", error);
    });
    const queued = this.deps.queue.enqueue<RunUpdate>(
      target.sessionKey,
      async () => {
        await persisted;
        await this.markQueueItemRunning(target, queueItem);
        const promptText = typeof prompt === "function" ? prompt() : prompt;
        return this.deps.activeRuns.executePrompt(target, promptText, {
          id: callbacks.observerId ?? `prompt:${target.sessionKey}`,
          mode: "live",
          timingContext: callbacks.timingContext,
          onUpdate: callbacks.onUpdate,
        });
      },
      {
        id: queueItem?.id,
        createdAt: queueItem?.createdAt,
        text: callbacks.queueText ?? (typeof prompt === "string" ? prompt : undefined),
        canStart: async () => {
          return this.canStartQueuedPrompt(target, reconciledBeforeStart);
        },
        onComplete: () => this.removeManagedQueueItem(target, queueItem),
        onFailure: () => this.removeManagedQueueItem(target, queueItem),
        onClear: () => this.removeManagedQueueItem(target, queueItem),
      },
    ) as PromptQueueResult;
    queued.persisted = persisted;
    return queued;
  }

  private preparePersistedQueueItem(target: AgentSessionTarget, item?: StoredQueueItem) {
    if (!item) {
      return undefined;
    }
    this.setManagedQueueItem(target, item, true);
    return this.persistQueueItem(this.deps.resolveTarget(target), item)
      .then(() => this.markPersisted(target, item))
      .catch((error) => {
        this.clearPendingById(target, item);
        throw error;
      });
  }

  private async canStartQueuedPrompt(
    target: AgentSessionTarget,
    reconciledBeforeStart: Promise<void>,
  ) {
    if (await this.deps.hasBlockingActiveRun(target)) {
      return false;
    }
    await reconciledBeforeStart;
    return !(await this.deps.hasBlockingActiveRun(target));
  }

  private async canStartPersistedQueueItem(
    target: AgentSessionTarget,
    item: StoredQueueItem,
  ) {
    if (await this.deps.hasBlockingActiveRun(target)) {
      return false;
    }
    if (!(await this.deps.sessionState.hasQueuedItem(target.sessionKey, item.id))) {
      this.clearPendingById(target, item);
      return false;
    }
    return true;
  }

  async reconcilePersistedQueueItems() {
    const persistedItems = await this.deps.sessionState.listQueuedItems({
      statuses: ["pending", "running"],
    });
    const persistedKeys = new Set(
      persistedItems.map((item) => this.buildManagedQueueKey(item.sessionKey, item.id)),
    );
    const removedManagedItems = [...this.queuedItems.entries()]
      .filter(([key, managed]) => !managed.persisting && !persistedKeys.has(key));
    if (removedManagedItems.length > 0) {
      const removedBySession = new Map<string, string[]>();
      for (const [key, managed] of removedManagedItems) {
        const ids = removedBySession.get(managed.target.sessionKey) ?? [];
        ids.push(managed.item.id);
        removedBySession.set(managed.target.sessionKey, ids);
        this.queuedItems.delete(key);
      }
      for (const [sessionKey, itemIds] of removedBySession.entries()) {
        this.deps.queue.clearPendingByIdsForKey(sessionKey, itemIds);
      }
    }

    for (const persisted of persistedItems) {
      if (persisted.status === "running") {
        await this.clearStaleRunningQueueItem(persisted);
        continue;
      }
      if (this.queuedItems.has(this.buildManagedQueueKey(persisted.sessionKey, persisted.id))) {
        continue;
      }
      this.enqueuePersistedQueueItem(persisted);
    }
  }

  private async clearStaleRunningQueueItem(item: QueuedPromptStatus) {
    if (this.queuedItems.has(this.buildManagedQueueKey(item.sessionKey, item.id))) {
      return;
    }
    const target = {
      agentId: item.agentId,
      sessionKey: item.sessionKey,
    };
    if (await this.deps.hasBlockingActiveRun(target)) {
      return;
    }
    await this.removeManagedQueueItem(target, item);
  }

  persistQueueItem(resolved: ResolvedAgentTarget, item: StoredQueueItem) {
    return this.deps.sessionState
      .countPendingQueuedItemsForSessionKey(resolved.sessionKey, {
        excludeId: item.id,
      })
      .then(async (pendingCount) => {
        const maxPending = this.deps.getQueueConfig().maxPendingItemsPerSession;
        if (pendingCount >= maxPending) {
          throw new Error(
            `Session queue pending item count exceeds the configured max of \`${maxPending}\`. Clear pending queue items first.`,
          );
        }
        await this.deps.sessionState.setQueuedItem(resolved, item);
      });
  }

  setManagedQueueItem(target: AgentSessionTarget, item: StoredQueueItem, persisting?: boolean) {
    this.queuedItems.set(this.buildManagedQueueKey(target.sessionKey, item.id), {
      target,
      item,
      persisting,
    });
  }

  markPersisted(target: AgentSessionTarget, item: StoredQueueItem) {
    const key = this.buildManagedQueueKey(target.sessionKey, item.id);
    const managed = this.queuedItems.get(key);
    if (managed) {
      this.queuedItems.set(key, { ...managed, persisting: false });
    }
  }

  clearPendingById(target: AgentSessionTarget, item: StoredQueueItem) {
    this.deps.queue.clearPendingByIdsForKey(target.sessionKey, [item.id]);
    this.queuedItems.delete(this.buildManagedQueueKey(target.sessionKey, item.id));
  }

  async markQueueItemRunning(target: AgentSessionTarget, item?: StoredQueueItem) {
    if (!item) {
      return undefined;
    }
    const now = Date.now();
    const next = {
      ...item,
      status: "running" as const,
      startedAt: now,
      updatedAt: now,
    };
    this.queuedItems.set(this.buildManagedQueueKey(target.sessionKey, item.id), {
      target,
      item: next,
    });
    await this.deps.sessionState.replaceQueuedItemIfPresent(
      this.deps.resolveTarget(target),
      next,
    );
    return next;
  }

  async removeManagedQueueItem(target: AgentSessionTarget, item?: StoredQueueItem) {
    if (!item) {
      return;
    }
    this.queuedItems.delete(this.buildManagedQueueKey(target.sessionKey, item.id));
    await this.deps.sessionState.removeQueuedItem(this.deps.resolveTarget(target), item.id);
  }

  private enqueuePersistedQueueItem(item: QueuedPromptStatus) {
    const target = {
      agentId: item.agentId,
      sessionKey: item.sessionKey,
    };
    this.queuedItems.set(this.buildManagedQueueKey(target.sessionKey, item.id), {
      target,
      item,
    });
    const queued = this.deps.queue.enqueue<ManagedQueueRunUpdate>(
      item.sessionKey,
      async () => {
        const runningItem = await this.markQueueItemRunning(target, item);
        await this.deps.surfaceRuntime.notifyManagedQueueStart(target, item);
        const promptText = await this.deps.surfaceRuntime.buildManagedQueuePrompt(
          item.agentId,
          item,
        );
        const result = this.deps.activeRuns.executePrompt(target, promptText, {
          id: `queue:${item.id}`,
          mode: "live",
          onUpdate: async () => undefined,
        });
        let stopWaitingForToolFinal = false;
        try {
          const outcome = await Promise.race([
            result.then((update) => ({ kind: "result" as const, update })),
            this.waitForMessageToolFinal(target, runningItem ?? item, () => stopWaitingForToolFinal)
              .then((seen) => ({ kind: seen ? "message-tool-final" as const : "result" as const })),
          ]);
          if (outcome.kind === "message-tool-final") {
            return this.createMessageToolFinalQueueUpdate(target, item);
          }
          return await result;
        } finally {
          stopWaitingForToolFinal = true;
        }
      },
      {
        id: item.id,
        createdAt: item.createdAt,
        text: item.promptSummary,
        canStart: async () => this.canStartPersistedQueueItem(target, item),
        onComplete: async (value) => {
          if (
            !value.messageToolFinalAlreadySent &&
            !(await this.hasMessageToolFinalForQueueItem(target, item))
          ) {
            await this.deps.surfaceRuntime.notifyManagedQueueSettlement(target, item, value);
          }
          await this.removeManagedQueueItem(target, item);
        },
        onFailure: async (error: unknown) => {
          await this.deps.surfaceRuntime.notifyManagedQueueFailure(target, item, error);
          await this.removeManagedQueueItem(target, item);
        },
        onClear: () => this.removeManagedQueueItem(target, item),
      },
    );
    void queued.result.catch((error) => {
      if (error instanceof ClearedQueuedTaskError) {
        return;
      }
      if (this.deps.shouldSuppressShutdownError(error)) {
        return;
      }
      console.error("queued prompt execution failed", error);
    });
  }

  private async waitForMessageToolFinal(
    target: AgentSessionTarget,
    item: StoredQueueItem,
    shouldStop: () => boolean,
  ) {
    while (!shouldStop()) {
      if (await this.hasMessageToolFinalForQueueItem(target, item)) {
        return true;
      }
      await sleep(QUEUE_MESSAGE_TOOL_FINAL_POLL_MS);
    }
    return false;
  }

  private async hasMessageToolFinalForQueueItem(
    target: AgentSessionTarget,
    item: StoredQueueItem,
  ) {
    const startedAt =
      this.queuedItems.get(this.buildManagedQueueKey(target.sessionKey, item.id))?.item.startedAt ??
      item.startedAt;
    if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) {
      return false;
    }
    const runtime = await this.deps.sessionState.getSessionRuntime(target);
    return (
      typeof runtime.messageToolFinalReplyAt === "number" &&
      Number.isFinite(runtime.messageToolFinalReplyAt) &&
      runtime.messageToolFinalReplyAt >= startedAt
    );
  }

  private createMessageToolFinalQueueUpdate(
    target: AgentSessionTarget,
    item: StoredQueueItem,
  ): ManagedQueueRunUpdate {
    const resolved = this.deps.resolveTarget(target);
    return {
      status: "completed",
      agentId: target.agentId,
      sessionKey: target.sessionKey,
      sessionName: resolved.sessionName,
      workspacePath: resolved.workspacePath,
      snapshot: "",
      fullSnapshot: "",
      initialSnapshot: "",
      messageToolFinalAlreadySent: true,
    };
  }

  private buildManagedQueueKey(sessionKey: string, itemId: string) {
    return `${sessionKey}::${itemId}`;
  }
}
