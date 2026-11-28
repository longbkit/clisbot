import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { inspect } from "node:util";
import { describe, it } from "vitest";
import { sourceEnvironment } from "./source-clisbot.js";
import { describeProcesses, runCommand } from "./command.js";

describe("E2E command diagnostics", () => {
  it("does not retain a failed command's enrollment token", async () => {
    const token = "exact-enrollment-token-must-not-survive";

    const diagnostic = await failedCommandDiagnostic(token);

    assert.equal(diagnostic.includes(token), false);
    assert.match(diagnostic, /--token <redacted>/u);
    assert.match(diagnostic, /raw diagnostics discarded/u);
  });
});

async function failedCommandDiagnostic(token: string): Promise<string> {
  try {
    await runCommand(
      process.execPath,
      ["-e", "process.exit(3)", "--", "--token", token],
      process.cwd(),
      {},
    );
  } catch (error) {
    return inspect(error, { depth: 10 });
  }
  throw new Error("Command unexpectedly succeeded");
}

describe("source fixture isolation", () => {
  it("reports a live executable without its command line", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
      "--",
      "synthetic-argument",
    ]);
    const closed = once(child, "close");
    try {
      await once(child, "spawn");
      const rows = await describeProcesses([child.pid!]);
      assert.equal(rows.length, 1);
      assert.match(rows[0]!, / node$/u);
      assert.ok(!rows[0]!.includes("synthetic-argument"));
    } finally {
      child.kill();
      await closed;
    }
  });
  it("runs child commands with only the disposable environment", async () => {
    const clisbotHome = "/fixture/clisbot";
    const env = sourceEnvironment({ clisbotHome, realAgent: false });
    assert.equal(env["HOME"], clisbotHome + "/test-user");
    const { stdout } = await runCommand(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env)))"],
      process.cwd(),
      env,
    );
    const expected = Object.entries(env)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    // CoreFoundation may add this platform-owned variable at process startup.
    const childKeys: string[] = JSON.parse(stdout);
    assert.deepEqual(
      childKeys.filter((key) => key !== "__CF_USER_TEXT_ENCODING").sort(),
      expected.sort(),
    );
  });
});
