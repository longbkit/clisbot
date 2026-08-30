import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import type { BotStopDeps } from "./stop.js";
import { collectRuntimeOnlyCredentials, runBotStop } from "./stop.js";
import type { BotManifest } from "./manifest.js";

function manifest(name: string, credentials: BotManifest["credentials"]): BotManifest {
  return {
    version: 1,
    name,
    botType: "personal",
    provider: "codex",
    workspacePath: "/home/op/workspaces/default",
    workspaceId: "ws-1",
    agentId: "ag-1",
    agentTitle: name,
    channel: "telegram",
    account: "work",
    credentials,
    createdAt: "t0",
    updatedAt: "t0",
  };
}

describe("collectRuntimeOnlyCredentials", () => {
  it("collects only the persisted:false records, deduped", () => {
    const result = collectRuntimeOnlyCredentials([
      manifest("a", { "telegram:work": { persisted: false } }),
      manifest("b", { "slack:ops": { persisted: true } }),
      manifest("c", { "telegram:work": { persisted: false }, "slack:ops": { persisted: false } }),
    ]);
    assert.deepEqual(result, [
      { channel: "telegram", account: "work" },
      { channel: "slack", account: "ops" },
    ]);
  });

  it("returns nothing when every credential is persisted", () => {
    const result = collectRuntimeOnlyCredentials([
      manifest("a", { "telegram:work": { persisted: true } }),
    ]);
    assert.deepEqual(result, []);
  });

  it("ignores malformed credential keys without a colon", () => {
    const result = collectRuntimeOnlyCredentials([
      manifest("a", { "no-colon": { persisted: false } }),
    ]);
    assert.deepEqual(result, []);
  });
});

describe("runBotStop", () => {
  /**
   * The fake deps, plus a live `stopCalls()` counter: the closure variable is
   * the source of truth (a snapshot number on the returned object would stay
   * 0 no matter how often `stopHub` ran).
   */
  function fakeDeps(
    manifests: BotManifest[],
    overrides: Partial<BotStopDeps> = {},
  ): BotStopDeps & { removed: string[]; stopCalls(): number } {
    const removed: string[] = [];
    let calls = 0;
    return {
      removed,
      stopCalls: () => calls,
      readManifests: async () => manifests,
      hubDataDir: () => "/home/op/.clisbot",
      stopHub: async (home) => {
        calls += 1;
        return { action: "stopped", pid: 1234, home };
      },
      removeMirrorFile: async (filePath) => {
        removed.push(filePath);
      },
      ...overrides,
    };
  }

  it("stops the Hub first, then discards only the runtime-only mirror files", async () => {
    const manifests = [
      manifest("runtime-bot", { "telegram:work": { persisted: false } }),
      manifest("persisted-bot", {
        "slack:ops": { persisted: true, secretPath: "/s/slack-ops.json" },
      }),
    ];
    const deps = fakeDeps(manifests);
    const order: string[] = [];
    const instrumented: BotStopDeps = {
      ...deps,
      stopHub: async (home) => {
        order.push("stopHub");
        return deps.stopHub(home);
      },
      removeMirrorFile: async (filePath) => {
        order.push(`remove:${filePath}`);
        return deps.removeMirrorFile(filePath);
      },
    };

    const report = await runBotStop(
      { home: "/home/op/.clisbot", env: {} },
      { force: false, timeoutMs: 0, killTimeoutMs: 0 },
      instrumented,
    );

    assert.equal(deps.stopCalls(), 1);
    assert.equal(report.hub, "stopped");
    assert.equal(report.pid, "1234");
    assert.deepEqual(report.discarded, ["telegram/work"]);
    assert.deepEqual(report.preserved, ["slack/ops"]);
    assert.match(report.message, /discarded runtime-only credential: telegram\/work/);
    // The mirror file is removed and the persisted .json is never touched.
    assert.deepEqual(deps.removed, ["/home/op/.clisbot/secrets/telegram--work"]);
    assert.ok(order[0] === "stopHub");
  });

  it("reports no discarded credentials when nothing is runtime-only", async () => {
    const deps = fakeDeps([manifest("persisted-bot", { "slack:ops": { persisted: true } })]);
    const report = await runBotStop(
      { home: "/home/op/.clisbot", env: {} },
      { force: false, timeoutMs: 0, killTimeoutMs: 0 },
      deps,
    );
    assert.deepEqual(report.discarded, []);
    assert.deepEqual(deps.removed, []);
    assert.match(report.message, /no runtime-only credentials to discard/);
  });

  it("reports not_running when the Hub was already down", async () => {
    const deps = fakeDeps([], {
      stopHub: async (home) => ({ action: "not_running", pid: null, home }),
    });
    const report = await runBotStop(
      { home: "/home/op/.clisbot", env: {} },
      { force: false, timeoutMs: 0, killTimeoutMs: 0 },
      deps,
    );
    assert.equal(report.hub, "not_running");
    assert.equal(report.pid, "-");
  });
});
