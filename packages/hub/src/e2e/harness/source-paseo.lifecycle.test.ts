import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "vitest";
import { stopProcess } from "./source-paseo.js";

describe("source Paseo process ownership", () => {
  it("terminates a detached agent CLI child tree", async () => {
    const parent = spawn(
      process.execPath,
      [
        "-e",
        [
          'const { spawn } = require("node:child_process");',
          'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 10000)"], { detached: true, stdio: "ignore" });',
          "process.stdout.write(String(child.pid));",
          "setInterval(() => {}, 10000);",
        ].join("\n"),
      ],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    const childPid = await childPidFrom(parent);

    try {
      await stopProcess(parent, true);

      assert.equal(parent.exitCode !== null || parent.signalCode !== null, true);
      assert.equal(isProcessAlive(childPid), false);
    } finally {
      if (isProcessAlive(childPid)) process.kill(childPid, "SIGKILL");
      if (parent.exitCode === null && parent.signalCode === null && parent.pid !== undefined) {
        try {
          process.kill(-parent.pid, "SIGKILL");
        } catch {
          // The process exited between the assertion and fallback cleanup.
        }
      }
    }
  });
});

async function childPidFrom(parent: ReturnType<typeof spawn>): Promise<number> {
  const output = await new Promise<string>((resolve, reject) => {
    parent.stdout?.once("data", (chunk: Buffer) => resolve(chunk.toString()));
    parent.once("error", reject);
  });
  const pid = Number(output);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid child pid: ${output}`);
  return pid;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
