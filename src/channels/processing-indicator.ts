import type { AgentService, AgentSessionTarget } from "../agents/agent-service.ts";
import { isTerminalRunStatus, type RunUpdate } from "../agents/run-observation.ts";

export type ProcessingIndicatorLifecycle = "handler" | "active-run";

function shouldResolveIndicatorWait(update: RunUpdate) {
  return isTerminalRunStatus(update.status) || update.status === "detached";
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
