import { describe, expect, it } from "vitest";
import { agentDirectoryReadyKey, parseAgentDirectoryReadyKey } from "./agent-directory-ready";

describe("agentDirectoryReadyKey", () => {
  it("names the Hosts whose agent directory has loaded, unaffected by other runtime fields", () => {
    const snapshots = new Map([
      ["a", { hasEverLoadedAgentDirectory: true, latencyMs: 400 }],
      ["b", { hasEverLoadedAgentDirectory: false, latencyMs: 400 }],
      ["c", { hasEverLoadedAgentDirectory: true, latencyMs: 400 }],
    ]);
    const key = agentDirectoryReadyKey(["a", "b", "c", "d"], (id) => snapshots.get(id) ?? null);

    snapshots.set("a", { hasEverLoadedAgentDirectory: true, latencyMs: 910 });
    expect(agentDirectoryReadyKey(["a", "b", "c", "d"], (id) => snapshots.get(id) ?? null)).toBe(
      key,
    );
    expect(parseAgentDirectoryReadyKey(key)).toEqual(new Set(["a", "c"]));
    expect(
      parseAgentDirectoryReadyKey(agentDirectoryReadyKey(["b"], (id) => snapshots.get(id) ?? null)),
    ).toEqual(new Set());
  });
});
