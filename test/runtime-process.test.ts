import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readRuntimeLog } from "../src/control/runtime-process.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "muxbot-runtime-process-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("readRuntimeLog", () => {
  test("limits output to text written after the provided start offset", async () => {
    const dir = createTempDir();
    const logPath = join(dir, "muxbot.log");
    writeFileSync(logPath, "old stack line\nold stack line 2\n");
    const startOffset = Bun.file(logPath).size;
    writeFileSync(logPath, "fresh line 1\nfresh line 2\n", { flag: "a" });

    const result = await readRuntimeLog({
      logPath,
      startOffset,
      lines: 40,
    });

    expect(result.text).toBe("fresh line 1\nfresh line 2");
  });
});
