import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAgentTarget } from "../src/agents/routing/resolved-target.ts";
import { loadConfig } from "../src/config/core/load-config.ts";
import { clisbotConfigSchema } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";
import { listRunnerSessions } from "../src/control/runner/runner-debug-state.ts";
import { TmuxClient } from "../src/runners/tmux/client.ts";

describe("listRunnerSessions", () => {
  afterEach(() => {
    mock.restore();
  });

  test("does not capture live panes just to infer runner session ids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clisbot-runner-debug-state-"));
    try {
      const stateDir = join(dir, "state");
      const configPath = join(dir, "clisbot.json");
      const sessionStorePath = join(stateDir, "sessions.json");
      mkdirSync(stateDir, { recursive: true });
      const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
      config.app.session.storePath = sessionStorePath;
      config.agents.defaults.workspace = join(dir, "workspaces", "{agentId}");
      config.agents.defaults.runner.defaults.tmux.socketPath = join(stateDir, "clisbot.sock");
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

      const loaded = await loadConfig(configPath);
      const resolved = resolveAgentTarget(loaded, {
        agentId: "default",
        sessionKey: "session-1",
      });
      writeFileSync(
        sessionStorePath,
        `${JSON.stringify({
          "session-1": {
            agentId: "default",
            sessionKey: "session-1",
            sessionId: "stored-session-id",
            workspacePath: join(dir, "workspaces", "default"),
            runnerCommand: "codex",
            updatedAt: Date.now(),
            runtime: {
              state: "running",
            },
          },
        }, null, 2)}\n`,
      );

      const originalListSessions = TmuxClient.prototype.listSessions;
      const originalCapturePane = TmuxClient.prototype.capturePane;
      TmuxClient.prototype.listSessions = mock(async () => [resolved.sessionName]);
      const capturePane = mock(async () => {
        throw new Error("capturePane should not be called by runner list");
      });
      TmuxClient.prototype.capturePane = capturePane;

      try {
        const sessions = await listRunnerSessions(loaded);

        expect(sessions).toHaveLength(1);
        expect(sessions[0]?.identity?.sessionId).toBe("stored-session-id");
        expect(capturePane.mock.calls).toHaveLength(0);
      } finally {
        TmuxClient.prototype.listSessions = originalListSessions;
        TmuxClient.prototype.capturePane = originalCapturePane;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
