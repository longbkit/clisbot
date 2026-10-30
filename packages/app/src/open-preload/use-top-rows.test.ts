// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AgentOpenTarget, OpenPreloads } from "./targets";
import { usePreloadTopAgents } from "./use-top-rows";

function createRecorder() {
  const calls: string[] = [];
  const name = (target: AgentOpenTarget) => `${target.serverId}/${target.agentId}`;
  const preloads: OpenPreloads = {
    preloadAgent: (target) => calls.push(`preload ${name(target)}`),
    cancelAgent: (target) => calls.push(`cancel ${name(target)}`),
    preloadChat: () => {},
    cancelQueued: () => {},
  };
  return { calls, preloads };
}

const a1 = { serverId: "h1", agentId: "a1" };
const a2 = { serverId: "h1", agentId: "a2" };
const a3 = { serverId: "h2", agentId: "a3" };

describe("usePreloadTopAgents", () => {
  it("preloads the rows at the top of the list", () => {
    const { calls, preloads } = createRecorder();
    renderHook(() => usePreloadTopAgents([a1, a2], preloads));
    expect(calls).toEqual(["preload h1/a1", "preload h1/a2"]);
  });

  it("cancels a row that leaves the top and preloads the one that arrives", () => {
    const { calls, preloads } = createRecorder();
    const hook = renderHook(({ targets }) => usePreloadTopAgents(targets, preloads), {
      initialProps: { targets: [a1, a2] },
    });
    calls.length = 0;
    hook.rerender({ targets: [a2, a3] });
    expect(calls).toEqual(["cancel h1/a1", "preload h2/a3"]);
  });

  it("does nothing when the same rows render again", () => {
    const { calls, preloads } = createRecorder();
    const hook = renderHook(({ targets }) => usePreloadTopAgents(targets, preloads), {
      initialProps: { targets: [a1, a2] },
    });
    calls.length = 0;
    hook.rerender({ targets: [{ ...a1 }, { ...a2 }] });
    expect(calls).toEqual([]);
  });

  it("cancels its waiting rows when the list goes away", () => {
    const { calls, preloads } = createRecorder();
    const hook = renderHook(() => usePreloadTopAgents([a1], preloads));
    calls.length = 0;
    hook.unmount();
    expect(calls).toEqual(["cancel h1/a1"]);
  });
});
