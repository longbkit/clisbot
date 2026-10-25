import { createMemoryHistory } from "expo-router/build/fork/createMemoryHistory";
import { expect, test, vi } from "vitest";

test("a second navigation pop after browser Back cannot leave the first app entry", async () => {
  const originalUrl = location.href;
  const originalState = history.state;
  const memory = createMemoryHistory();
  const state = {
    stale: false as const,
    type: "stack",
    key: "history-boundary",
    index: 0,
    routeNames: ["reader"],
    routes: [{ key: "reader", name: "reader" }],
  };
  let go: ReturnType<typeof vi.spyOn> | undefined;
  try {
    memory.replace({ path: "/__history-reader", state });
    memory.push({ path: "/__history-settings", state });
    const returned = new Promise<void>((resolve) =>
      addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await returned;
    expect(memory.index).toBe(0);
    expect(location.pathname).toBe("/__history-reader");
    // Capture the invalid second pop without letting the old dependency leave the test page.
    go = vi.spyOn(history, "go").mockImplementation(() => {});
    await memory.go(-1);
    expect(go).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/__history-reader");
  } finally {
    go?.mockRestore();
    history.replaceState(originalState, "", originalUrl);
  }
});

test("keeps valid programmatic Back and Forward after an external browser Back", async () => {
  const originalUrl = location.href;
  const originalState = history.state;
  const memory = createMemoryHistory();
  const state = {
    stale: false as const,
    type: "stack",
    key: "history-interior",
    index: 0,
    routeNames: ["reader"],
    routes: [{ key: "reader", name: "reader" }],
  };
  try {
    memory.replace({ path: "/__history-reader", state });
    memory.push({ path: "/__history-settings", state });
    await memory.go(-1);
    expect(location.pathname).toBe("/__history-reader");
    await memory.go(1);
    expect(location.pathname).toBe("/__history-settings");
    const returned = new Promise<void>((resolve) =>
      addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await returned;
    await memory.go(1);
    expect(memory.index).toBe(1);
    expect(location.pathname).toBe("/__history-settings");
  } finally {
    history.replaceState(originalState, "", originalUrl);
  }
});
