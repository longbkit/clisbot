import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { stageBundleDependencies } from "./npm-bundle-dependencies.mjs";
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

test("a packed workspace carries hoisted bundled dependencies, nested versions and licenses", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "clisbot-bundle-"));
  const workspace = path.join(directory, "packages/hub");
  const lockedPackages = {};
  const put = (location, manifest, source = "module.exports = true") => {
    mkdirSync(location, { recursive: true });
    writeFileSync(path.join(location, "package.json"), JSON.stringify(manifest));
    writeFileSync(path.join(location, "index.js"), source);
    writeFileSync(path.join(location, "LICENSE"), "fixture license");
    lockedPackages[path.relative(directory, location).split(path.sep).join("/")] = manifest;
  };
  try {
    put(workspace, {
      name: "bundle-fixture",
      version: "1.0.0",
      dependencies: { auth: "1.0.0" },
      bundleDependencies: ["auth"],
    });
    put(
      path.join(directory, "node_modules/auth"),
      {
        name: "auth",
        version: "1.0.0",
        dependencies: { shared: "1.0.0", helper: "1.0.0" },
        optionalDependencies: { absent: "1.0.0" },
      },
      "module.exports = [require('shared'), require('helper')]",
    );
    put(
      path.join(directory, "node_modules/auth/node_modules/shared"),
      { name: "shared", version: "1.0.0" },
      "module.exports = 'nested'",
    );
    put(
      path.join(directory, "node_modules/helper"),
      { name: "helper", version: "1.0.0", dependencies: { shared: "2.0.0" } },
      "module.exports = require('shared')",
    );
    put(
      path.join(directory, "node_modules/shared"),
      { name: "shared", version: "2.0.0" },
      "module.exports = 'hoisted'",
    );
    writeFileSync(
      path.join(directory, "package-lock.json"),
      JSON.stringify({ packages: lockedPackages }),
    );
    await stageBundleDependencies(workspace, directory);
    const [pack] = JSON.parse(
      execFileSync("npm", ["pack", "--json", "--pack-destination", directory], {
        cwd: workspace,
        encoding: "utf8",
        shell: process.platform === "win32",
      }),
    );
    assert(pack.bundled.includes("auth"));
    assert(pack.files.some((file) => file.path === "node_modules/auth/LICENSE"));
    const unpacked = path.join(directory, "installed");
    mkdirSync(unpacked);
    execFileSync("tar", ["-xf", path.join(directory, pack.filename), "-C", unpacked]);
    const require = createRequire(path.join(unpacked, "package/package.json"));
    assert.deepEqual(require("auth"), ["nested", "hoisted"]);
    writeFileSync(
      path.join(directory, "node_modules/shared/index.js"),
      "module.exports = 'updated'",
    );
    await stageBundleDependencies(workspace, directory);
    assert.deepEqual(
      JSON.parse(
        execFileSync(process.execPath, ["-e", "console.log(JSON.stringify(require('auth')))"], {
          cwd: workspace,
          encoding: "utf8",
        }),
      ),
      ["nested", "updated"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a missing required bundle fails before packing instead of publishing an incomplete package", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "clisbot-bundle-missing-"));
  try {
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({
        name: "missing-fixture",
        version: "1.0.0",
        bundleDependencies: ["missing-auth-fixture"],
      }),
    );
    writeFileSync(path.join(directory, "package-lock.json"), JSON.stringify({ packages: {} }));
    await assert.rejects(
      stageBundleDependencies(directory, directory),
      /Missing bundled dependency missing-auth-fixture/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
