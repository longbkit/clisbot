import { expect, test, vi } from "vitest";
import type { ToolHosts } from "../../host-operations/index.js";
import type { AgentManager } from "../../agent-manager.js";
import type { AgentStorage } from "../../agent-storage.js";
import type { AgentMessageDelivery } from "../../agent-messages/index.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { createFinishObservation } from "./observation.js";

const remote = {
  id: "watch",
  callerAgentId: "parent",
  childAgentId: "child",
  serverId: "destination",
};
function scenario() {
  let requiresTickets = false;
  let mode: "external" | "off" = "external";
  const listeners = new Set<() => void>();
  const release = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const directory = vi.fn().mockResolvedValue({
    self: { serverId: "origin", label: "Origin" },
    hosts: [{ serverId: "destination", status: "connected" }],
  });
  const use = vi.fn(async (_id: string, action: (client: never) => Promise<unknown>) =>
    action({
      fetchAgent: async () => ({
        agent: { id: "child", status: "running", pendingPermissions: [] },
      }),
      observeTimeline: () => ({ ready: Promise.resolve(), subscribe: () => () => {}, release }),
      waitForFinish: () => new Promise(() => {}),
      close,
    } as never),
  );
  const observation = createFinishObservation({
    serverId: "origin",
    logger: createTestLogger(),
    agentManager: {
      getAgent: () => undefined,
      getLastAssistantMessage: async () => null,
      subscribe: () => () => {},
    } as unknown as AgentManager,
    agentStorage: { get: async () => null } as unknown as AgentStorage,
    messages: () => ({ waitForDispatch: async () => {} }) as unknown as AgentMessageDelivery,
    hosts: () => ({ directory, use }) as unknown as ToolHosts,
    canUseRemoteHosts: () => !(mode === "external" && requiresTickets),
    onRemoteAuthorityChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  return {
    observation,
    directory,
    use,
    release,
    close,
    listeners,
    enrollment(value: boolean) {
      requiresTickets = value;
      for (const listener of listeners) listener();
    },
    mode(value: "external" | "off") {
      mode = value;
      for (const listener of listeners) listener();
    },
  };
}

test("effective managed authority rejects persisted remote watches before saved-host discovery and preserves local observation", async () => {
  const fixture = scenario();
  fixture.enrollment(true);
  expect(() => fixture.observation.assertAuthority!(remote)).toThrow(
    "durable subscription is retained",
  );
  await expect(
    fixture.observation.open(remote, new AbortController().signal),
  ).rejects.toMatchObject({ code: "permission_denied" });
  expect(fixture.directory).not.toHaveBeenCalled();
  expect(fixture.use).not.toHaveBeenCalled();
  const local = await fixture.observation.open(
    { ...remote, serverId: "origin" },
    new AbortController().signal,
  );
  expect(await local.next()).toMatchObject({ final: null, status: "idle" });
  await local.close();
});

test("personal external default permits a watch; enrollment revokes its route and cannot emit a later result", async () => {
  const fixture = scenario();
  const watch = await fixture.observation.open(remote, new AbortController().signal);
  expect(fixture.use).toHaveBeenCalledOnce();
  const next = watch.next();
  const denied = expect(next).rejects.toMatchObject({ code: "permission_denied" });
  fixture.enrollment(true);
  await denied;
  await watch.close();
  expect(fixture.release).toHaveBeenCalledOnce();
  expect(fixture.close).toHaveBeenCalledOnce();
  expect(fixture.directory).not.toHaveBeenCalled();
  expect(fixture.listeners.size).toBe(0);
  // A mode or enrollment change is checked again on retry, rather than a stored allow bit.
  fixture.mode("off");
  const restored = await fixture.observation.open(remote, new AbortController().signal);
  await restored.close();
  expect(fixture.use).toHaveBeenCalledTimes(2);
});
