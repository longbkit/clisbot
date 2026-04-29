import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCanonicalTelegramBotTokenPath } from "../src/config/channel-credentials.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

describe("fast start e2e", () => {
  let tempDir = "";
  const bunExecutable = Bun.which("bun") ?? process.execPath;
  let previousCliName: string | undefined;

  beforeEach(() => {
    previousCliName = process.env.CLISBOT_CLI_NAME;
    delete process.env.CLISBOT_CLI_NAME;
  });

  afterEach(() => {
    process.env.CLISBOT_CLI_NAME = previousCliName;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("init persists a literal telegram token into the canonical credential file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-fast-start-e2e-"));
    const configPath = join(tempDir, "clisbot.json");

    const subprocess = Bun.spawn([
      bunExecutable,
      "src/main.ts",
      "init",
      "--cli",
      "codex",
      "--bot-type",
      "personal",
      "--telegram-bot-token",
      "123456:telegram-dev-token",
      "--persist",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLISBOT_HOME: tempDir,
        CLISBOT_CONFIG_PATH: configPath,
        CLISBOT_CLI_NAME: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await subprocess.exited;
    const stderr = await new Response(subprocess.stderr).text();
    const stdout = await new Response(subprocess.stdout).text();

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.bots.telegram.defaults.enabled).toBe(true);
    expect(config.bots.telegram.default.enabled).toBe(true);
    expect(config.bots.telegram.default.credentialType).toBe("tokenFile");
    expect(config.bots.telegram.default.botToken ?? "").toBe("");
    expect(readFileSync(getCanonicalTelegramBotTokenPath("default", {
      ...process.env,
      CLISBOT_HOME: tempDir,
    }), "utf8").trim()).toBe("123456:telegram-dev-token");
    expect(stdout).toContain("Persisted telegram/default");
  }, 15000);

  test("init rejects literal telegram tokens unless --persist is passed", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-fast-start-e2e-"));
    const configPath = join(tempDir, "clisbot.json");

    const subprocess = Bun.spawn([
      bunExecutable,
      "src/main.ts",
      "init",
      "--cli",
      "codex",
      "--bot-type",
      "personal",
      "--telegram-bot-token",
      "123456:telegram-dev-token",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLISBOT_HOME: tempDir,
        CLISBOT_CONFIG_PATH: configPath,
        CLISBOT_CLI_NAME: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await subprocess.exited;
    const stderr = await new Response(subprocess.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("`clisbot init` with literal channel tokens requires --persist.");
  }, 15000);

  test("start repeats FAILED at the end when long first-run guidance is rendered", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-fast-start-e2e-"));
    const configPath = join(tempDir, "clisbot.json");

    const subprocess = Bun.spawn([
      bunExecutable,
      "src/main.ts",
      "start",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLISBOT_HOME: tempDir,
        CLISBOT_CONFIG_PATH: configPath,
        CLISBOT_CLI_NAME: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await subprocess.exited;
    const stderr = await new Response(subprocess.stderr).text();
    const stdout = await new Response(subprocess.stdout).text();
    const trimmed = stdout.trimEnd();

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(trimmed.endsWith("+---------+\n| FAILED  |\n+---------+")).toBe(true);
  });

  test("stop disables stale mem-backed accounts in config", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-fast-start-e2e-"));
    const configPath = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.agents.list = [];
    config.app.control.configReload.watch = false;
    config.bots.slack.defaults.enabled = false;
    config.bots.telegram.defaults.enabled = true;
    config.bots.telegram.default.enabled = true;
    config.bots.telegram.default.credentialType = "mem";
    config.bots.telegram.default.botToken = "";
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const subprocess = Bun.spawn([
      bunExecutable,
      "src/main.ts",
      "stop",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLISBOT_HOME: tempDir,
        CLISBOT_CONFIG_PATH: configPath,
        CLISBOT_PID_PATH: join(tempDir, "state", "clisbot.pid"),
        CLISBOT_CLI_NAME: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await subprocess.exited;
    const stderr = await new Response(subprocess.stderr).text();
    const stdout = await new Response(subprocess.stdout).text();

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toMatch(/clisbot (stopped|is not running)/);

    const persistedConfig = JSON.parse(readFileSync(configPath, "utf8"));
    expect(persistedConfig.bots.telegram.defaults.enabled).toBe(false);
    expect(persistedConfig.bots.telegram.default.enabled).toBe(false);
  }, 15000);

  test("uses CLISBOT_CLI_NAME for direct repo-local command rendering", async () => {
    const subprocess = Bun.spawn([
      bunExecutable,
      "src/main.ts",
      "--help",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLISBOT_CLI_NAME: "clisbot-dev",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await subprocess.exited;
    const stderr = await new Response(subprocess.stderr).text();
    const stdout = await new Response(subprocess.stdout).text();

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("clisbot-dev start");
    expect(stdout).toContain("Use `clisbot-dev status`");
  }, 15000);
});
