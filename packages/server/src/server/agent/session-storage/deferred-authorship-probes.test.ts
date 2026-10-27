import { describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { DeferredAuthorshipProbes } from "./deferred-authorship-probes.js";

const direct = (_agentId: string, probe: () => Promise<void>) => probe();

describe("DeferredAuthorshipProbes", () => {
  it("probes an agent once, whether hydrated on open or by the drain", async () => {
    const probe = vi.fn(async () => undefined);
    const probes = new DeferredAuthorshipProbes(["a", "b"], probe, createTestLogger());
    await probes.hydrate("a");
    await probes.hydrate("a");
    await probes.drain(direct);
    expect(probe.mock.calls.map(([agentId]) => agentId)).toEqual(["a", "b"]);
    expect(probes.size).toBe(0);
  });

  it("ignores an agent that was never deferred", async () => {
    const probe = vi.fn(async () => undefined);
    await new DeferredAuthorshipProbes([], probe, createTestLogger()).hydrate("warm");
    expect(probe).not.toHaveBeenCalled();
  });

  it("keeps draining after a failed probe and stops when asked", async () => {
    const seen: string[] = [];
    const probes = new DeferredAuthorshipProbes(
      ["a", "b", "c"],
      async (agentId) => {
        seen.push(agentId);
        if (agentId === "a") throw new Error("unreadable index");
        if (agentId === "b") probes.stop();
      },
      createTestLogger(),
    );
    await probes.drain(direct);
    expect(seen).toEqual(["a", "b"]);
    expect(probes.size).toBe(1);
  });
});
