import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import type { BotManifest } from "./manifest.js";
import { type BotStopDeps, runBotStop } from "./stop.js";

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

describe("runBotStop", () => {
  function fakeDeps(manifests: BotManifest[]): BotStopDeps & { stopCalls(): number } {
    let calls = 0;
    return {
      stopCalls: () => calls,
      readManifests: async () => manifests,
      stopHub: async (home) => {
        calls += 1;
        return {
          action: "stopped",
          pid: 1234,
          home,
          forced: false,
          reason: "owner_pid_signal",
          message: "stopped",
        };
      },
    };
  }

  it("stops the Hub without deleting durable encrypted connection credentials", async () => {
    const deps = fakeDeps([
      manifest("telegram-bot", { "telegram:work": { persisted: true } }),
      manifest("slack-bot", { "slack:ops": { persisted: true } }),
    ]);

    const report = await runBotStop(
      { home: "/home/op/.clisbot", env: {} },
      { force: false, timeoutMs: 0, killTimeoutMs: 0 },
      deps,
    );

    assert.equal(deps.stopCalls(), 1);
    assert.equal(report.hub, "stopped");
    assert.equal(report.pid, "1234");
    assert.deepEqual(report.preserved, ["telegram/work", "slack/ops"]);
  });

  it("reports not_running when the Hub was already down", async () => {
    const deps: BotStopDeps = {
      readManifests: async () => [],
      stopHub: async (home) => ({
        action: "not_running",
        pid: null,
        home,
        forced: false,
        reason: "not_running",
        message: "not running",
      }),
    };
    const report = await runBotStop(
      { home: "/home/op/.clisbot", env: {} },
      { force: false, timeoutMs: 0, killTimeoutMs: 0 },
      deps,
    );
    assert.equal(report.hub, "not_running");
    assert.equal(report.pid, "-");
  });
});
