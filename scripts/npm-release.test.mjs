import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { releasePackages } from "./npm-release.mjs";

test("the CLI release includes every runtime dependency and publishes clisbot last", () => {
  const packages = releasePackages();
  const names = packages.map((pkg) => pkg.name);
  assert.equal(names.at(-1), "clisbot");
  assert.equal(packages.length, 21);
  assert.ok(names.includes("@clisbot/hub"));
  assert.ok(names.includes("@clisbot/channels-whatsapp"));
  assert.ok(!names.includes("@clisbot/expo-two-way-audio"));
  for (const pkg of packages) {
    for (const name of Object.keys(pkg.dependencies ?? {}).filter((dependency) =>
      dependency.startsWith("@clisbot/"),
    )) {
      assert.ok(names.indexOf(name) < names.indexOf(pkg.name), `${name} must precede ${pkg.name}`);
    }
  }
});

test("unpublished internal dependencies fail before publication", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "clisbot-release-graph-"));
  try {
    mkdirSync(path.join(directory, "entry"));
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ version: "2.0.0", workspaces: ["entry"] }),
    );
    writeFileSync(
      path.join(directory, "entry/package.json"),
      JSON.stringify({
        name: "clisbot",
        version: "2.0.0",
        dependencies: { "@clisbot/missing": "2.0.0" },
      }),
    );
    assert.throws(() => releasePackages(directory), /Unpublished dependency/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the public entry keeps both legacy command names", () => {
  const pkg = JSON.parse(readFileSync(new URL("../packages/npm/package.json", import.meta.url)));
  assert.deepEqual(pkg.bin, { clisbot: "bin/clisbot", clis: "bin/clisbot" });
});
