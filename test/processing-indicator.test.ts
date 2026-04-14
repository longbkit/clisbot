import { describe, expect, test } from "bun:test";
import type { AgentSessionTarget } from "../src/agents/agent-service.ts";
import type { RunObserver } from "../src/agents/run-observation.ts";
import {
  ConversationProcessingIndicatorCoordinator,
  waitForProcessingIndicatorLifecycle,
} from "../src/channels/processing-indicator.ts";

function createTarget(): AgentSessionTarget {
  return {
    agentId: "default",
    sessionKey: "slack:channel:C123:thread:1",
  };
}

function createUpdate(status: "running" | "completed" | "detached") {
  return {
    status,
    agentId: "default",
    sessionKey: createTarget().sessionKey,
    sessionName: "agent-default",
    workspacePath: "/tmp/workspace",
    snapshot: status,
    fullSnapshot: status,
    initialSnapshot: "",
  } as const;
}

describe("waitForProcessingIndicatorLifecycle", () => {
  test("does nothing for handler-scoped lifecycle", async () => {
    let observeCalls = 0;

    await waitForProcessingIndicatorLifecycle({
      agentService: {
        observeRun: async () => {
          observeCalls += 1;
          return {
            active: false,
            update: createUpdate("completed"),
          };
        },
        detachRunObserver: async () => ({ detached: false }),
      } as any,
      sessionTarget: createTarget(),
      observerId: "obs-1",
      lifecycle: "handler",
    });

    expect(observeCalls).toBe(0);
  });

  test("waits until the active run completes before resolving", async () => {
    let observer: Omit<RunObserver, "lastSentAt"> | undefined;
    const detachedIds: string[] = [];
    let settled = false;

    const task = waitForProcessingIndicatorLifecycle({
      agentService: {
        hasActiveRun: () => true,
        observeRun: async (_target: AgentSessionTarget, nextObserver: Omit<RunObserver, "lastSentAt">) => {
          observer = nextObserver;
          return {
            active: true,
            update: createUpdate("running"),
          };
        },
        detachRunObserver: async (_target: AgentSessionTarget, observerId: string) => {
          detachedIds.push(observerId);
          return { detached: true };
        },
      } as any,
      sessionTarget: createTarget(),
      observerId: "obs-2",
      lifecycle: "active-run",
    }).then(() => {
      settled = true;
    });

    await Bun.sleep(0);
    expect(settled).toBe(false);

    await observer?.onUpdate(createUpdate("running"));
    await Bun.sleep(0);
    expect(settled).toBe(false);

    await observer?.onUpdate(createUpdate("completed"));
    await task;

    expect(settled).toBe(true);
    expect(detachedIds).toEqual(["obs-2"]);
  });

  test("stops waiting when the active run detaches", async () => {
    let observer: Omit<RunObserver, "lastSentAt"> | undefined;
    let settled = false;

    const task = waitForProcessingIndicatorLifecycle({
      agentService: {
        hasActiveRun: () => true,
        observeRun: async (_target: AgentSessionTarget, nextObserver: Omit<RunObserver, "lastSentAt">) => {
          observer = nextObserver;
          return {
            active: true,
            update: createUpdate("running"),
          };
        },
        detachRunObserver: async () => ({ detached: true }),
      } as any,
      sessionTarget: createTarget(),
      observerId: "obs-3",
      lifecycle: "active-run",
    }).then(() => {
      settled = true;
    });

    await Bun.sleep(0);
    expect(settled).toBe(false);

    await observer?.onUpdate(createUpdate("detached"));
    await task;

    expect(settled).toBe(true);
  });
});

describe("ConversationProcessingIndicatorCoordinator", () => {
  test("keeps one shared indicator active across overlapping handler leases", async () => {
    const events: string[] = [];
    const coordinator = new ConversationProcessingIndicatorCoordinator();

    const leaseA = await coordinator.acquire({
      key: "slack:C123:1",
      activate: async () => {
        events.push("activate");
        return async () => {
          events.push("deactivate");
        };
      },
    });
    const leaseB = await coordinator.acquire({
      key: "slack:C123:1",
      activate: async () => {
        events.push("activate-again");
      },
    });

    expect(events).toEqual(["activate"]);

    await leaseA.release();
    expect(events).toEqual(["activate"]);

    await leaseB.release();
    expect(events).toEqual(["activate", "deactivate"]);
  });

  test("keeps the indicator alive after handler release while the active run is still alive", async () => {
    let observer: Omit<RunObserver, "lastSentAt"> | undefined;
    const events: string[] = [];
    const coordinator = new ConversationProcessingIndicatorCoordinator();
    const lease = await coordinator.acquire({
      key: "telegram:-1000:topic:3",
      activate: async () => {
        events.push("activate");
        return async () => {
          events.push("deactivate");
        };
      },
    });

    await lease.setLifecycle({
      agentService: {
        hasActiveRun: () => true,
        observeRun: async (_target: AgentSessionTarget, nextObserver: Omit<RunObserver, "lastSentAt">) => {
          observer = nextObserver;
          return {
            active: true,
            update: createUpdate("running"),
          };
        },
        detachRunObserver: async () => ({ detached: true }),
      } as any,
      sessionTarget: createTarget(),
      observerId: "processing:telegram:-1000:3",
      lifecycle: "active-run",
    });

    await lease.release();
    expect(events).toEqual(["activate"]);

    await observer?.onUpdate(createUpdate("completed"));
    await Bun.sleep(0);

    expect(events).toEqual(["activate", "deactivate"]);
  });

  test("does not let a handler-only lease clear an existing active-run hold", async () => {
    let observer: Omit<RunObserver, "lastSentAt"> | undefined;
    const events: string[] = [];
    const coordinator = new ConversationProcessingIndicatorCoordinator();
    const agentService = {
      hasActiveRun: () => true,
      observeRun: async (_target: AgentSessionTarget, nextObserver: Omit<RunObserver, "lastSentAt">) => {
        observer = nextObserver;
        return {
          active: true,
          update: createUpdate("running"),
        };
      },
      detachRunObserver: async () => ({ detached: true }),
    } as any;

    const activeRunLease = await coordinator.acquire({
      key: "slack:C123:1",
      activate: async () => {
        events.push("activate");
        return async () => {
          events.push("deactivate");
        };
      },
    });
    await activeRunLease.setLifecycle({
      agentService,
      sessionTarget: createTarget(),
      observerId: "processing:slack:C123:1",
      lifecycle: "active-run",
    });
    await activeRunLease.release();

    const handlerOnlyLease = await coordinator.acquire({
      key: "slack:C123:1",
      activate: async () => {
        events.push("activate-again");
      },
    });
    await handlerOnlyLease.release();

    expect(events).toEqual(["activate"]);

    await observer?.onUpdate(createUpdate("completed"));
    await Bun.sleep(0);

    expect(events).toEqual(["activate", "deactivate"]);
  });
});
