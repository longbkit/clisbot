import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionState } from "../src/agents/session-state.ts";
import { SessionStore } from "../src/agents/session-store.ts";
import { RunnerService } from "../src/agents/runner-service.ts";
import { resolveAgentTarget } from "../src/agents/resolved-target.ts";
import { loadConfig, resolveSessionStorePath } from "../src/config/load-config.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import { TmuxClient } from "../src/runners/tmux/client.ts";

const tempDirs: string[] = [];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "clisbot-runner-service-"));
  tempDirs.push(dir);
  return dir;
}

function createConfig(dir: string) {
  const stateDir = join(dir, "state");
  const configPath = join(dir, "clisbot.json");
  const sessionStorePath = join(stateDir, "sessions.json");
  const socketPath = join(stateDir, "clisbot.sock");
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  mkdirSync(stateDir, { recursive: true });

  config.app.session.storePath = sessionStorePath;
  config.agents.defaults.workspace = join(dir, "workspaces", "{agentId}");
  config.agents.defaults.runner.defaults.tmux.socketPath = socketPath;
  config.agents.defaults.runner.defaults.trustWorkspace = false;
  config.agents.defaults.runner.defaults.startupDelayMs = 500;
  config.agents.defaults.runner.defaults.promptSubmitDelayMs = 1;
  config.agents.defaults.runner.defaults.stream.captureLines = 20;
  config.agents.defaults.runner.codex.command = "bash";
  config.agents.defaults.runner.codex.args = ["-lc", "printf 'ready\\n'; exec cat", "clisbot"];
  config.agents.defaults.runner.codex.startupReadyPattern = "ready";
  config.agents.defaults.runner.codex.sessionId = {
    create: {
      mode: "explicit",
      args: ["{sessionId}"],
    },
    capture: {
      mode: "off",
      statusCommand: "/status",
      pattern: "session id:",
      timeoutMs: 100,
      pollIntervalMs: 10,
    },
    resume: {
      mode: "off",
      args: [],
    },
  };
  config.bots.slack.defaults.enabled = false;
  config.bots.telegram.defaults.enabled = false;
  config.app.control.configReload.watch = false;

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return {
    configPath,
    sessionStorePath,
    socketPath,
  };
}

function readSessionEntry(storePath: string, sessionKey: string) {
  const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<
    string,
    { sessionId?: string }
  >;
  return store[sessionKey] ?? null;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    const socketPath = join(dir, "state", "clisbot.sock");
    await Bun.spawn(["tmux", "-S", socketPath, "kill-server"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("RunnerService integration", () => {
  test("creates a fresh runner for a prefix-colliding session key when the stored sessionId is missing", async () => {
    const dir = createTempDir();
    const { configPath, sessionStorePath, socketPath } = createConfig(dir);
    const loaded = await loadConfig(configPath);
    const tmux = new TmuxClient(socketPath);
    const missingSessionTarget = {
      agentId: "default",
      sessionKey: "agent:default:telegram:group:-1003455688247:topic:1",
    };
    const foreignSessionTarget = {
      agentId: "default",
      sessionKey: "agent:default:telegram:group:-1003455688247:topic:1207",
    };
    const missingResolved = resolveAgentTarget(loaded, missingSessionTarget);
    const foreignResolved = resolveAgentTarget(loaded, foreignSessionTarget);

    writeFileSync(
      sessionStorePath,
      `${JSON.stringify(
        {
          [missingSessionTarget.sessionKey]: {
            agentId: "default",
            sessionKey: missingSessionTarget.sessionKey,
            workspacePath: missingResolved.workspacePath,
            runnerCommand: "bash",
            runtime: { state: "idle" },
            updatedAt: Date.now(),
          },
        },
        null,
        2,
      )}\n`,
    );

    await tmux.newSession({
      sessionName: foreignResolved.sessionName,
      cwd: foreignResolved.workspacePath,
      command: "bash -lc 'printf ready\\\\n; exec cat' clisbot foreign",
    });

    const runner = new RunnerService(
      loaded,
      tmux,
      new AgentSessionState(new SessionStore(resolveSessionStorePath(loaded))),
      (target) => resolveAgentTarget(loaded, target),
    );

    const resolved = await runner.ensureSessionReady(missingSessionTarget);
    const storedEntry = readSessionEntry(sessionStorePath, missingSessionTarget.sessionKey);
    const liveSessions = await tmux.listSessions();

    expect(resolved.sessionName).toBe(missingResolved.sessionName);
    expect(liveSessions).toContain(missingResolved.sessionName);
    expect(liveSessions).toContain(foreignResolved.sessionName);
    expect(storedEntry?.sessionId).toMatch(UUID_PATTERN);
  }, 15000);

  test("creates distinct runners when two session keys normalize to the same tmux-safe base name", async () => {
    const dir = createTempDir();
    const { configPath, sessionStorePath, socketPath } = createConfig(dir);
    const loaded = await loadConfig(configPath);
    const tmux = new TmuxClient(socketPath);
    const firstTarget = {
      agentId: "default",
      sessionKey: "agent:default:telegram:group:qa/a",
    };
    const secondTarget = {
      agentId: "default",
      sessionKey: "agent:default:telegram:group:qa-a",
    };
    const firstResolved = resolveAgentTarget(loaded, firstTarget);
    const secondResolved = resolveAgentTarget(loaded, secondTarget);

    expect(firstResolved.sessionName).not.toBe(secondResolved.sessionName);

    await tmux.newSession({
      sessionName: secondResolved.sessionName,
      cwd: secondResolved.workspacePath,
      command: "bash -lc 'printf ready\\\\n; exec cat' clisbot foreign",
    });

    writeFileSync(
      sessionStorePath,
      `${JSON.stringify(
        {
          [firstTarget.sessionKey]: {
            agentId: "default",
            sessionKey: firstTarget.sessionKey,
            workspacePath: firstResolved.workspacePath,
            runnerCommand: "bash",
            runtime: { state: "idle" },
            updatedAt: Date.now(),
          },
        },
        null,
        2,
      )}\n`,
    );

    const runner = new RunnerService(
      loaded,
      tmux,
      new AgentSessionState(new SessionStore(resolveSessionStorePath(loaded))),
      (target) => resolveAgentTarget(loaded, target),
    );

    const resolved = await runner.ensureSessionReady(firstTarget);
    const liveSessions = await tmux.listSessions();
    const storedEntry = readSessionEntry(sessionStorePath, firstTarget.sessionKey);

    expect(resolved.sessionName).toBe(firstResolved.sessionName);
    expect(liveSessions).toContain(firstResolved.sessionName);
    expect(liveSessions).toContain(secondResolved.sessionName);
    expect(storedEntry?.sessionId).toMatch(UUID_PATTERN);
  }, 15000);
});
