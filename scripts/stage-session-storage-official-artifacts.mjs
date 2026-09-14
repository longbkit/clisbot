#!/usr/bin/env node
/** Stage immutable official Paseo artifacts without changing this checkout or installing dependencies. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = process.argv[2] && resolve(process.argv[2]);
const version = process.argv[3] ?? "0.8.0";
if (!directory || directory === checkout || directory.startsWith(`${checkout}/`))
  throw new Error(
    "Usage: node scripts/stage-session-storage-official-artifacts.mjs /tmp/isolated-directory [exact-version]",
  );
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
  throw new Error("An exact version is required");
await mkdir(directory); // Never modify or replace an existing staging directory.
const nodeModules = join(directory, "node_modules");
const artifacts = join(directory, "artifacts");
await mkdir(join(nodeModules, "@getpaseo"), { recursive: true });
await mkdir(artifacts);
const queue = ["@getpaseo/server", "@getpaseo/client", "@getpaseo/cli"];
const manifest = {
  version,
  sourceReference: "fa93c4290eaa87ae58452ab6e2012f85ae6e0c6b",
  note: "Published official Paseo tarballs; unchanged third-party dependencies shared with the Fusion checkout. Diagnostic, not a clean npm-install proof. gitHead is recorded separately from the source reference.",
  packages: [],
  sharedDependencies: [],
};
const staged = new Set();
for (let index = 0; index < queue.length; index++) {
  const name = queue[index];
  if (staged.has(name)) continue;
  staged.add(name);
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`);
  if (!response.ok) throw new Error(`Registry ${name}@${version}: ${response.status}`);
  const metadata = await response.json();
  if (metadata.name !== name || metadata.version !== version)
    throw new Error("Registry identity mismatch");
  const tarballResponse = await fetch(metadata.dist.tarball);
  if (!tarballResponse.ok) throw new Error(`Tarball ${name}: ${tarballResponse.status}`);
  const chunks = [];
  let total = 0;
  for await (const chunk of tarballResponse.body) {
    total += chunk.byteLength;
    if (total > 128 * 1024 * 1024) throw new Error(`Tarball exceeds staging byte limit: ${name}`);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (integrity !== metadata.dist.integrity) throw new Error(`Tarball integrity mismatch: ${name}`);
  const file = join(artifacts, `${name.split("/")[1]}-${version}.tgz`);
  await writeFile(file, bytes, { flag: "wx" });
  const target = join(nodeModules, name);
  await mkdir(target);
  await execute("tar", ["-xzf", file, "--strip-components=1", "-C", target]);
  const installed = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
  if (installed.name !== name || installed.version !== version)
    throw new Error("Extracted identity mismatch");
  manifest.packages.push({
    name,
    version,
    integrity,
    gitHead: metadata.gitHead ?? null,
    tarball: metadata.dist.tarball,
    bytes: total,
  });
  for (const [dependency, expectedVersion] of Object.entries(installed.dependencies ?? {})) {
    if (!dependency.startsWith("@getpaseo/")) continue;
    if (expectedVersion !== version)
      throw new Error(`Unexpected internal version ${dependency}: ${expectedVersion}`);
    queue.push(dependency);
  }
}
async function shareDependencies(sourceDirectory, targetDirectory, scope) {
  const entries = await readdir(sourceDirectory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  await mkdir(targetDirectory, { recursive: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "@getpaseo") continue;
    const source = await realpath(join(sourceDirectory, entry.name));
    await symlink(source, join(targetDirectory, entry.name), "dir");
    if (!entry.name.startsWith("@")) {
      const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
      manifest.sharedDependencies.push({ name: pkg.name, version: pkg.version, scope });
    } else {
      for (const child of await readdir(source)) {
        const pkg = JSON.parse(await readFile(join(source, child, "package.json"), "utf8"));
        manifest.sharedDependencies.push({ name: pkg.name, version: pkg.version, scope });
      }
    }
  }
}
await shareDependencies(join(checkout, "node_modules"), nodeModules, "root");
for (const { name } of manifest.packages) {
  const shortName = name.split("/")[1];
  await shareDependencies(
    join(checkout, "packages", shortName, "node_modules"),
    join(nodeModules, name, "node_modules"),
    name,
  );
}
await writeFile(
  join(directory, "package.json"),
  JSON.stringify({ private: true, type: "module" }) + "\n",
  { flag: "wx" },
);
await writeFile(
  join(directory, "artifact-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    directory,
    packages: manifest.packages.length,
    manifest: join(directory, "artifact-manifest.json"),
  }),
);
