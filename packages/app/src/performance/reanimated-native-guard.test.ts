import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const source =
  "node_modules/react-native-reanimated/android/src/main/java/com/swmansion/reanimated/NativeProxy.kt";
const patch = join(root, "patches/react-native-reanimated+4.5.1.patch");
const fixture = join(root, "packages/app/scripts/reanimated-native-guard-fixture.py");
const studio = "/Applications/Android Studio.app/Contents";
const kotlin = process.env.KOTLINC ?? join(studio, "plugins/Kotlin/kotlinc.ide/bin/kotlinc");
const javaHome = process.env.JAVA_HOME ?? join(studio, "jbr/Contents/Home");
const available =
  existsSync(kotlin) && existsSync(join(javaHome, "bin/java")) && existsSync(join(root, source));

// This is a JVM fixture of the actual library method, not an Android/UI performance test.
it.skipIf(!available)(
  "ignores unmounted tags without losing preallocation or live errors",
  () => {
    const temp = mkdtempSync(join(tmpdir(), "reanimated-guard-"));
    try {
      const copied = join(temp, source);
      mkdirSync(dirname(copied), { recursive: true });
      copyFileSync(join(root, source), copied);
      const apply = (...args: string[]) =>
        spawnSync("git", ["apply", ...args, patch], { cwd: temp });
      // A normal npm install can already have applied this patch. Reconstruct the original first.
      if (apply("--reverse", "--check").status === 0) {
        expect(apply("--reverse").status).toBe(0);
      }
      const run = () =>
        spawnSync("python3", [fixture, copied, kotlin, javaHome], { encoding: "utf8" });
      const before = run();
      expect(before.status).not.toBe(0);
      expect(before.stderr).toContain("expected live and preallocated tags sent to update");
      expect(apply("--check").status).toBe(0);
      expect(apply().status).toBe(0);
      const after = run();
      expect(after.status, after.stderr).toBe(0);
      expect(after.stdout).toContain("PASS: live and preallocated updates");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
  60_000,
);
