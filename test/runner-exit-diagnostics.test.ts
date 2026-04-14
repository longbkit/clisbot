import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRunnerLaunchCommand,
  getRunnerExitRecordPath,
  readRunnerExitRecord,
} from "../src/control/runner-exit-diagnostics.ts";

describe("runner exit diagnostics", () => {
  test("writes an exit record when the runner command exits", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-runner-exit-"));

    try {
      const launchCommand = buildRunnerLaunchCommand({
        command: "bash",
        args: ["-lc", "exit 7"],
        wrapperDir: "/tmp",
        wrapperPath: "/tmp/clisbot",
        sessionName: "agent-default-topic-1230",
        stateDir: tempDir,
      });

      const result = spawnSync("bash", ["-lc", launchCommand], {
        encoding: "utf8",
      });

      expect(result.status).toBe(7);
      const exitRecord = await readRunnerExitRecord(tempDir, "agent-default-topic-1230");
      expect(exitRecord).not.toBeNull();
      expect(exitRecord?.sessionName).toBe("agent-default-topic-1230");
      expect(exitRecord?.exitCode).toBe(7);
      expect(exitRecord?.command).toContain("bash -lc 'exit 7'");
      expect(exitRecord?.exitedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("returns null for malformed exit records", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-runner-exit-"));

    try {
      const exitRecordPath = getRunnerExitRecordPath(tempDir, "agent-default-topic-1230");
      mkdirSync(join(tempDir, "runner-exits"), { recursive: true });
      writeFileSync(exitRecordPath, "{bad json", "utf8");
      expect(await readRunnerExitRecord(tempDir, "agent-default-topic-1230")).toBeNull();
      expect(readFileSync(exitRecordPath, "utf8")).toBe("{bad json");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
