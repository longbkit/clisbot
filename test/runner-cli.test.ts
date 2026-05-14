import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runRunnerCli } from "../src/control/runner/runner-cli.ts";
import { CliCommandError } from "../src/control/commands/runtime-cli-support.ts";
import { setRenderedCliName } from "../src/control/commands/cli-name.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const BUN_COMMAND = Bun.which("bun") ?? process.execPath;

describe("runner cli", () => {
  const originalLog = console.log;
  let previousCliName: string | undefined;

  beforeEach(() => {
    previousCliName = process.env.CLISBOT_CLI_NAME;
    delete process.env.CLISBOT_CLI_NAME;
    setRenderedCliName();
  });

  afterEach(() => {
    console.log = originalLog;
    process.env.CLISBOT_CLI_NAME = previousCliName;
    setRenderedCliName(previousCliName);
    process.exitCode = undefined;
  });

  test("renders help with no subcommand", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runRunnerCli([]);

    const output = logs.join("\n");
    expect(output).toContain("clisbot runner");
    expect(output).toContain("clisbot runner smoke --backend <codex|claude|gemini> --scenario <name>");
    expect(output).toContain("launch-trio");
  });

  test("subcommand help renders before selector validation", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runRunnerCli(["inspect", "--help"]);

    const output = logs.join("\n");
    expect(output).toContain("clisbot runner");
    expect(output).toContain("runner inspect <session-name>|--latest|--index <n>");
  });

  test("smoke --json returns a machine-readable not-implemented result and exit code 3", async () => {
    const subprocess = Bun.spawn(
      [
        BUN_COMMAND,
        "run",
        "src/main.ts",
        "runner",
        "smoke",
        "--backend",
        "codex",
        "--scenario",
        "startup_ready",
        "--json",
      ],
      {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const [stdout, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      subprocess.exited,
    ]);

    expect(exitCode).toBe(3);
    expect(stdout).toContain("\"kind\": \"runner-smoke-framework-error\"");
    expect(stdout).toContain("\"backendId\": \"codex\"");
    expect(stdout).toContain("\"scenario\": \"startup_ready\"");
    expect(stdout).toContain("\"code\": \"NOT_IMPLEMENTED\"");
  });

  test("smoke rejects invalid backend and scenario combinations with exit code 2 semantics", async () => {
    await expect(
      runRunnerCli([
        "smoke",
        "--backend",
        "all",
        "--scenario",
        "startup_ready",
      ]),
    ).rejects.toMatchObject({
      message: "--backend all is only valid with --suite",
      exitCode: 2,
    } satisfies Partial<CliCommandError>);
  });
});
