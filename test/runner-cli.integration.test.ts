import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import { ensureDir } from "../src/shared/paths.ts";
import { TmuxClient } from "../src/runners/tmux/client.ts";
import type { StoredSessionEntry } from "../src/agents/session-store.ts";

const tempDirs: string[] = [];

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "clisbot-runner-cli-"));
  tempDirs.push(dir);
  return dir;
}

function createConfig(dir: string) {
  const stateDir = join(dir, "state");
  const configPath = join(dir, "clisbot.json");
  const sessionStorePath = join(stateDir, "sessions.json");
  const socketPath = join(stateDir, "clisbot.sock");
  mkdirSync(stateDir, { recursive: true });
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.app.session.storePath = sessionStorePath;
  config.agents.defaults.workspace = join(dir, "workspaces", "{agentId}");
  config.agents.defaults.runner.defaults.tmux.socketPath = socketPath;
  config.agents.defaults.runner.defaults.startupDelayMs = 1;
  config.agents.defaults.runner.defaults.promptSubmitDelayMs = 1;
  config.agents.defaults.runner.codex.sessionId!.capture = {
    mode: "off",
    statusCommand: "/status",
    pattern: "session:",
    timeoutMs: 1000,
    pollIntervalMs: 100,
  };
  config.agents.defaults.runner.defaults.stream.captureLines = 40;
  config.agents.defaults.runner.defaults.stream.updateIntervalMs = 200;
  config.agents.defaults.runner.defaults.stream.idleTimeoutMs = 2000;
  config.agents.defaults.runner.defaults.stream.noOutputTimeoutMs = 5000;
  config.agents.defaults.runner.defaults.stream.maxRuntimeMin = 30;
  config.agents.defaults.runner.defaults.stream.maxMessageChars = 4000;
  config.agents.list = [];
  config.app.control.configReload.watch = false;
  config.app.control.runtimeMonitor.restartBackoff.stages = [{ delayMinutes: 15, maxRestarts: 4 }];
  config.bots.slack.defaults.enabled = false;
  config.bots.telegram.defaults.enabled = false;

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return {
    configPath,
    sessionStorePath,
    socketPath,
    stateDir,
  };
}

async function writeSessionStore(path: string, entries: StoredSessionEntry[]) {
  await ensureDir(dirname(path));
  writeFileSync(
    path,
    `${JSON.stringify(
      Object.fromEntries(entries.map((entry) => [entry.sessionKey, entry])),
      null,
      2,
    )}\n`,
  );
}

async function createSessionWithOutput(tmux: TmuxClient, socketDir: string, sessionName: string, text: string) {
  await tmux.newSession({
    sessionName,
    cwd: socketDir,
    command: "env PS1= HISTFILE=/dev/null bash --noprofile --norc -i",
  });
  await Bun.sleep(150);
  await tmux.sendLiteral(sessionName, `printf '%s\\n' ${JSON.stringify(text)}`);
  await Bun.sleep(100);
  await tmux.sendKey(sessionName, "Enter");
  await Bun.sleep(400);
}

async function runRunnerCliCommand(configPath: string, args: string[]) {
  const subprocess = Bun.spawn(["bun", "run", "src/main.ts", "runner", ...args], {
    cwd: "/home/node/projects/clisbot",
    env: {
      ...process.env,
      CLISBOT_CONFIG_PATH: configPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
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

describe("runner cli integration", () => {
  test("list orders tmux sessions by latest admitted prompt when available", async () => {
    const dir = createTempDir();
    const { configPath, sessionStorePath, socketPath } = createConfig(dir);
    const tmux = new TmuxClient(socketPath);
    const now = Date.now();

    await createSessionWithOutput(tmux, dir, "alpha", "alpha output");
    await createSessionWithOutput(tmux, dir, "beta", "beta output");
    await createSessionWithOutput(tmux, dir, "gamma", "gamma output");
    await writeSessionStore(sessionStorePath, [
      {
        agentId: "default",
        sessionKey: "alpha",
        sessionId: "",
        workspacePath: join(dir, "workspaces", "default"),
        runnerCommand: "codex",
        lastAdmittedPromptAt: now - 10_000,
        runtime: {
          state: "idle",
        },
        updatedAt: now - 10_000,
      },
      {
        agentId: "default",
        sessionKey: "beta",
        sessionId: "session-beta",
        workspacePath: join(dir, "workspaces", "default"),
        runnerCommand: "codex",
        lastAdmittedPromptAt: now - 1_000,
        runtime: {
          state: "running",
        },
        updatedAt: now - 1_000,
      },
    ]);

    const result = await runRunnerCliCommand(configPath, ["list"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.indexOf("- sessionName: beta")).toBeLessThan(
      result.stdout.indexOf("- sessionName: alpha"),
    );
    expect(result.stdout.indexOf("- sessionName: alpha")).toBeLessThan(
      result.stdout.indexOf("- sessionName: gamma"),
    );
    expect(result.stdout).toContain("sessionId: session-beta");
    expect(result.stdout).toContain("sessionId: none");
    expect(result.stdout).toContain("state: running");
    expect(result.stdout).toContain("state: idle");
    expect(result.stdout).toContain("- sessionName: gamma\n  sessionId: none\n  state: unmanaged");
    expect(result.stdout).toContain("lastAdmittedPromptAt");
  }, 15000);

  test("inspect captures a named tmux runner snapshot", async () => {
    const dir = createTempDir();
    const { configPath, socketPath } = createConfig(dir);
    const tmux = new TmuxClient(socketPath);

    await createSessionWithOutput(tmux, dir, "inspect-me", "inspect output");

    const result = await runRunnerCliCommand(configPath, ["inspect", "inspect-me", "--lines", "20"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("inspect output");
  }, 15000);

  test("watch --latest follows the session with the newest admitted prompt", async () => {
    const dir = createTempDir();
    const { configPath, sessionStorePath, socketPath } = createConfig(dir);
    const tmux = new TmuxClient(socketPath);
    const now = Date.now();

    await createSessionWithOutput(tmux, dir, "alpha", "alpha latest output");
    await createSessionWithOutput(tmux, dir, "beta", "beta latest output");
    await writeSessionStore(sessionStorePath, [
      {
        agentId: "default",
        sessionKey: "alpha",
        workspacePath: join(dir, "workspaces", "default"),
        runnerCommand: "codex",
        lastAdmittedPromptAt: now - 10_000,
        updatedAt: now - 10_000,
      },
      {
        agentId: "default",
        sessionKey: "beta",
        workspacePath: join(dir, "workspaces", "default"),
        runnerCommand: "codex",
        lastAdmittedPromptAt: now - 1_000,
        updatedAt: now - 1_000,
      },
    ]);

    const result = await runRunnerCliCommand(configPath, [
      "watch",
      "--latest",
      "--lines",
      "20",
      "--interval",
      "200ms",
      "--timeout",
      "700ms",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("session: beta");
    expect(result.stdout).toContain("beta latest output");
  }, 20000);

  test("watch --next waits for the next admitted prompt and follows that session", async () => {
    const dir = createTempDir();
    const { configPath, sessionStorePath, socketPath } = createConfig(dir);
    const tmux = new TmuxClient(socketPath);

    const watchPromise = runRunnerCliCommand(configPath, [
      "watch",
      "--next",
      "--lines",
      "20",
      "--interval",
      "100ms",
      "--timeout",
      "1200ms",
    ]);

    await Bun.sleep(250);
    const admittedAt = Date.now();
    await createSessionWithOutput(tmux, dir, "gamma", "gamma next output");
    await writeSessionStore(sessionStorePath, [
      {
        agentId: "default",
        sessionKey: "gamma",
        workspacePath: join(dir, "workspaces", "default"),
        runnerCommand: "codex",
        lastAdmittedPromptAt: admittedAt,
        updatedAt: admittedAt,
      },
    ]);

    const result = await watchPromise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("session: gamma");
    expect(result.stdout).toContain("gamma next output");
  }, 20000);
});
