import type { AgentService, AgentSessionTarget } from "../agents/agent-service.ts";
import { isTerminalRunStatus, type RunUpdate } from "../agents/run-observation.ts";
import { sleep } from "../shared/process.ts";

export type ProcessingIndicatorLifecycle = "handler" | "active-run";
type IndicatorCleanup = (() => Promise<void> | void) | void;
const ACTIVE_RUN_WAIT_POLL_INTERVAL_MS = 250;

type ProcessingIndicatorEntry = {
  activeRunHold: boolean;
  activeRunWait?: Promise<void>;
  cleanup?: () => Promise<void> | void;
  indicatorActive: boolean;
  key: string;
  operationChain: Promise<void>;
  refCount: number;
};

export type ProcessingIndicatorLease = {
  setLifecycle: (params: {
    agentService: Pick<AgentService, "observeRun" | "detachRunObserver" | "hasActiveRun">;
    sessionTarget: AgentSessionTarget;
    observerId: string;
    lifecycle: ProcessingIndicatorLifecycle;
  }) => Promise<void>;
  release: () => Promise<void>;
};

function shouldResolveIndicatorWait(update: RunUpdate) {
  return isTerminalRunStatus(update.status);
}

export async function waitForProcessingIndicatorLifecycle(params: {
  agentService: Pick<AgentService, "observeRun" | "detachRunObserver" | "hasActiveRun">;
  sessionTarget: AgentSessionTarget;
  observerId: string;
  lifecycle: ProcessingIndicatorLifecycle;
}) {
  if (params.lifecycle !== "active-run") {
    return;
  }

  if (!params.agentService.hasActiveRun(params.sessionTarget)) {
    return;
  }

  let settled = false;
  const settle = () => {
    if (settled) {
      return;
    }
    settled = true;
  };

  try {
    await new Promise<void>(async (resolve, reject) => {
      const resolveOnce = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      void (async () => {
        while (!settled) {
          await sleep(ACTIVE_RUN_WAIT_POLL_INTERVAL_MS);
          if (settled) {
            return;
          }
          if (!params.agentService.hasActiveRun(params.sessionTarget)) {
            resolveOnce();
            return;
          }
        }
      })();

      try {
        const observation = await params.agentService.observeRun(
          params.sessionTarget,
          {
            id: params.observerId,
            mode: "live",
            onUpdate: async (update) => {
              if (shouldResolveIndicatorWait(update)) {
                resolveOnce();
              }
            },
          },
        );

        if (!observation.active || shouldResolveIndicatorWait(observation.update)) {
          resolveOnce();
        }
      } catch (error) {
        reject(error);
      }
    });
  } finally {
    settle();
    await params.agentService.detachRunObserver(
      params.sessionTarget,
      params.observerId,
    ).catch(() => undefined);
  }
}

export class ConversationProcessingIndicatorCoordinator {
  private readonly entries = new Map<string, ProcessingIndicatorEntry>();

  async acquire(params: {
    key: string;
    activate: () => Promise<IndicatorCleanup> | IndicatorCleanup;
    onError?: (phase: "activate" | "deactivate" | "active-run", error: unknown) => void;
  }): Promise<ProcessingIndicatorLease> {
    let entry = this.entries.get(params.key);
    if (!entry) {
      entry = {
        activeRunHold: false,
        indicatorActive: false,
        key: params.key,
        operationChain: Promise.resolve(),
        refCount: 0,
      };
      this.entries.set(params.key, entry);
    }

    entry.refCount += 1;
    await this.ensureIndicatorActive(entry, params.activate, params.onError);

    let released = false;
    return {
      setLifecycle: async (lifecycleParams) => {
        if (released || lifecycleParams.lifecycle !== "active-run" || entry.activeRunHold) {
          return;
        }

        entry.activeRunHold = true;
        entry.activeRunWait = waitForProcessingIndicatorLifecycle(lifecycleParams)
          .catch((error) => {
            params.onError?.("active-run", error);
          })
          .finally(() => {
            entry.activeRunHold = false;
            entry.activeRunWait = undefined;
            void this.maybeDeactivate(entry, params.onError);
          });
      },
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        entry.refCount = Math.max(0, entry.refCount - 1);
        await this.maybeDeactivate(entry, params.onError);
      },
    };
  }

  private async ensureIndicatorActive(
    entry: ProcessingIndicatorEntry,
    activate: () => Promise<IndicatorCleanup> | IndicatorCleanup,
    onError?: (phase: "activate" | "deactivate" | "active-run", error: unknown) => void,
  ) {
    entry.operationChain = entry.operationChain.then(async () => {
      if (entry.indicatorActive) {
        return;
      }

      try {
        const cleanup = await activate();
        entry.cleanup = typeof cleanup === "function" ? cleanup : undefined;
        entry.indicatorActive = true;
      } catch (error) {
        onError?.("activate", error);
      }
    });

    await entry.operationChain;
  }

  private async maybeDeactivate(
    entry: ProcessingIndicatorEntry,
    onError?: (phase: "activate" | "deactivate" | "active-run", error: unknown) => void,
  ) {
    if (entry.refCount > 0 || entry.activeRunHold) {
      return;
    }

    entry.operationChain = entry.operationChain.then(async () => {
      if (entry.refCount > 0 || entry.activeRunHold || !entry.indicatorActive) {
        return;
      }

      try {
        await entry.cleanup?.();
      } catch (error) {
        onError?.("deactivate", error);
      } finally {
        entry.cleanup = undefined;
        entry.indicatorActive = false;
        if (entry.refCount === 0 && !entry.activeRunHold) {
          this.entries.delete(entry.key);
        }
      }
    });

    await entry.operationChain;
  }
}
