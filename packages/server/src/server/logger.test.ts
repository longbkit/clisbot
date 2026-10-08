import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDaemonVersion } from "./daemon-version.js";
import { resolveLogConfig } from "./logger.js";
import { loadConfig } from "./config.js";
import type { PersistedConfig } from "./persisted-config.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const loggerModuleUrl = new URL("./logger.ts", import.meta.url).href;

async function runLoggerFixture(source: string): Promise<{ stdout: string; stderr: string }> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "clisbot-logger-fixture-"));
  const runnerPath = path.join(tempDir, "runner.mjs");
  await writeFile(
    runnerPath,
    `
      import { createRootLogger } from ${JSON.stringify(loggerModuleUrl)};

      ${source}
    `,
  );

  const child = spawn(process.execPath, ["--import", "tsx", runnerPath], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  expect(code, stderr).toBe(0);
  return { stdout, stderr };
}

describe("resolveLogConfig", () => {
  const clisbotHome = "/tmp/clisbot-logger-tests";

  it("defaults to stdout JSON without file logging", () => {
    const result = resolveLogConfig(undefined, { clisbotHome });

    expect(result).toEqual({
      level: "info",
      console: {
        level: "info",
        format: "json",
      },
    });
  });

  it("keeps legacy level and format as stdout configuration", () => {
    const result = resolveLogConfig({ level: "warn", format: "pretty" }, { clisbotHome });

    expect(result).toEqual({
      level: "warn",
      console: {
        level: "warn",
        format: "pretty",
      },
    });
  });

  it("enables file output only when log.file is present", () => {
    const config: PersistedConfig = {
      log: {
        console: {
          level: "warn",
          format: "json",
        },
        file: {
          level: "debug",
          path: "logs/programmatic.log",
          rotate: {
            maxSize: "25m",
            maxFiles: 5,
          },
        },
      },
    };

    expect(resolveLogConfig(config, { clisbotHome })).toEqual({
      level: "debug",
      console: {
        level: "warn",
        format: "json",
      },
      file: {
        level: "debug",
        path: path.resolve(clisbotHome, "logs", "programmatic.log"),
      },
    });
  });

  it("defaults file output to info when log.file is present without a level", () => {
    const config: PersistedConfig = {
      log: {
        console: {
          level: "warn",
        },
        file: {
          path: "daemon.log",
        },
      },
    };

    expect(resolveLogConfig(config, { clisbotHome })).toEqual({
      level: "info",
      console: {
        level: "warn",
        format: "json",
      },
      file: {
        level: "info",
        path: path.resolve(clisbotHome, "daemon.log"),
      },
    });
  });
});

describe("loadConfig logger config", () => {
  it("applies log format env at the config boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clisbot-logger-config-"));
    const clisbotHome = path.join(root, ".clisbot");
    await mkdir(clisbotHome, { recursive: true });
    await writeFile(
      path.join(clisbotHome, "config.json"),
      JSON.stringify({ version: 1, log: { format: "json" } }),
    );

    const config = loadConfig(clisbotHome, {
      env: { CLISBOT_LOG_FORMAT: "pretty" },
    });

    expect(config.log?.format).toBe("pretty");
    expect(resolveLogConfig(config, { clisbotHome }).console.format).toBe("pretty");
  });
});

describe("createRootLogger", () => {
  it("includes the daemon version in child logger entries", async () => {
    const clisbotHome = await mkdtemp(path.join(tmpdir(), "clisbot-logger-version-"));

    const { stdout } = await runLoggerFixture(`
      const logger = createRootLogger(undefined, { clisbotHome: ${JSON.stringify(clisbotHome)} });
      logger.child({ name: "fixture" }).info("versioned child logger");
      logger.flush();
    `);

    expect(JSON.parse(stdout)).toMatchObject({
      pid: expect.any(Number),
      hostname: expect.any(String),
      daemonVersion: resolveDaemonVersion(),
      name: "fixture",
      msg: "versioned child logger",
    });
  });

  it("writes JSON to stdout by default and does not initialize file logging", async () => {
    const clisbotHome = await mkdtemp(path.join(tmpdir(), "clisbot-logger-default-"));
    const missingLogDir = path.join(clisbotHome, "logs");

    const { stdout } = await runLoggerFixture(`
      const logger = createRootLogger(undefined, { clisbotHome: ${JSON.stringify(clisbotHome)} });
      logger.info({ proof: "stdout-default" }, "default logger");
      logger.flush();
    `);

    expect(stdout).toContain('"proof":"stdout-default"');
    expect(stdout).toContain('"msg":"default logger"');
    expect(existsSync(path.join(clisbotHome, "daemon.log"))).toBe(false);
    expect(existsSync(missingLogDir)).toBe(false);
  });

  it("writes to an explicit file target without creating rotation files", async () => {
    const clisbotHome = await mkdtemp(path.join(tmpdir(), "clisbot-logger-file-"));
    const logPath = path.join(clisbotHome, "logs", "programmatic.log");

    await runLoggerFixture(`
      const logger = createRootLogger(
        { log: { file: { path: ${JSON.stringify(logPath)} } } },
        { clisbotHome: ${JSON.stringify(clisbotHome)} },
      );
      logger.info({ proof: "file-explicit" }, "explicit file logger");
      logger.flush();
    `);

    const logText = await readFile(logPath, "utf8");
    const files = await readdir(path.dirname(logPath));

    expect(logText).toContain('"proof":"file-explicit"');
    expect(logText).toContain('"msg":"explicit file logger"');
    expect(files).toEqual(["programmatic.log"]);
  });

  it("can disable file output for supervised workers", async () => {
    const clisbotHome = await mkdtemp(path.join(tmpdir(), "clisbot-logger-no-worker-file-"));
    const logPath = path.join(clisbotHome, "daemon.log");

    const { stdout } = await runLoggerFixture(`
      const logger = createRootLogger(
        { log: { file: { path: ${JSON.stringify(logPath)} } } },
        { clisbotHome: ${JSON.stringify(clisbotHome)}, file: false },
      );
      logger.info({ proof: "stdout-only" }, "worker logger");
      logger.flush();
    `);

    expect(stdout).toContain('"proof":"stdout-only"');
    expect(stdout).toContain('"msg":"worker logger"');
    expect(existsSync(logPath)).toBe(false);
  });

  it("keeps pretty output available as a format choice", async () => {
    const clisbotHome = await mkdtemp(path.join(tmpdir(), "clisbot-logger-pretty-"));

    const { stdout } = await runLoggerFixture(`
      const logger = createRootLogger({ level: "info", format: "pretty" }, {
        clisbotHome: ${JSON.stringify(clisbotHome)},
      });
      logger.info("pretty logger");
      logger.flush();
    `);

    expect(stdout).toContain("pretty logger");
  });
});
