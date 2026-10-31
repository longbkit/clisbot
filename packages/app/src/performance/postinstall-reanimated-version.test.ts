import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const script = join(root, "scripts/postinstall-patches.mjs");
const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

function setup(version: string, includePatch = true) {
  const directory = mkdtempSync(join(tmpdir(), "reanimated-postinstall-"));
  temporary.push(directory);
  const dependency = join(directory, "node_modules/react-native-reanimated");
  const bin = join(directory, "bin");
  mkdirSync(dependency, { recursive: true });
  mkdirSync(join(directory, "patches"));
  mkdirSync(bin);
  writeFileSync(join(dependency, "package.json"), JSON.stringify({ version }));
  if (includePatch)
    writeFileSync(join(directory, "patches/react-native-reanimated+4.5.1.patch"), "fixture");
  const fake = join(bin, "patch-package");
  writeFileSync(
    fake,
    "#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.PATCH_LOG, 'called')\n",
  );
  chmodSync(fake, 0o755);
  const log = join(directory, "called");
  const run = () =>
    spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, PATCH_LOG: log },
    });
  return { dependency, log, run };
}

it("fails clearly without invoking patch-package when the installed version differs", () => {
  const { dependency, log, run } = setup("4.5.2");
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("4.5.1");
  expect(result.stderr).toContain("4.5.2");
  expect(existsSync(log)).toBe(false);
  expect(existsSync(join(dependency, "package.json"))).toBe(true);
});

it("fails clearly when the required patch is missing", () => {
  const { dependency, log, run } = setup("4.5.1", false);
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("react-native-reanimated+4.5.1.patch");
  expect(existsSync(log)).toBe(false);
  expect(existsSync(join(dependency, "package.json"))).toBe(true);
});

it("applies the patch when its dependency version matches", () => {
  const { log, run } = setup("4.5.1");
  expect(run().status).toBe(0);
  expect(existsSync(log)).toBe(true);
});
