#!/usr/bin/env node
/** Prepare an unmodified official app source tree matching the published artifact gitHead. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const execute = promisify(execFile);
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = process.argv[2] && resolve(process.argv[2]);
if (!stage || stage === checkout || stage.startsWith(`${checkout}/`))
  throw new Error("Pass the isolated official artifact directory");
const manifest = JSON.parse(await readFile(join(stage, "artifact-manifest.json"), "utf8"));
const heads = [...new Set(manifest.packages.map((pkg) => pkg.gitHead))];
if (heads.length !== 1 || !/^[a-f0-9]{40}$/.test(heads[0]))
  throw new Error("Artifacts lack one exact published gitHead");
const source = join(stage, "official-app-source");
await mkdir(source);
const archive = join(stage, "official-app-source.tar");
await execute(
  "git",
  [
    "archive",
    "--format=tar",
    `--output=${archive}`,
    heads[0],
    "package.json",
    "packages/app",
    "packages/expo-two-way-audio",
  ],
  { cwd: checkout },
);
await execute("tar", ["-xf", archive, "-C", source]);
const app = join(source, "packages/app");
const appPackage = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
if (appPackage.version !== manifest.version)
  throw new Error("Official app source version differs from published artifacts");
await symlink(join(stage, "node_modules"), join(source, "node_modules"), "dir");
for (const name of ["app", "expo-two-way-audio"]) {
  const localModules = join(source, "packages", name, "node_modules");
  await mkdir(localModules);
  for (const entry of await readdir(join(checkout, "packages", name, "node_modules"), {
    withFileTypes: true,
  })) {
    if (entry.name.startsWith(".") || entry.name === "@getpaseo") continue;
    await symlink(
      await realpath(join(checkout, "packages", name, "node_modules", entry.name)),
      join(localModules, entry.name),
      "dir",
    );
  }
}
// This private workspace has no published artifact. Compile its exact pinned source separately;
// never point this import to a working Fusion source/build directory.
const audio = join(source, "packages/expo-two-way-audio");
const appScope = join(app, "node_modules/@getpaseo");
await mkdir(appScope);
await symlink(audio, join(appScope, "expo-two-way-audio"), "dir");
for (const name of ["client", "highlight", "plugin", "protocol", "relay"])
  await symlink(join(stage, "node_modules/@getpaseo", name), join(appScope, name), "dir");
const sourceManifest = {
  gitHead: heads[0],
  version: manifest.version,
  archiveSha256: createHash("sha256")
    .update(await readFile(archive))
    .digest("hex"),
  appDirectory: app,
  privateAudioSourceDirectory: audio,
  privateAudioBuildRequired: true,
  publishedPackageDirectory: join(stage, "node_modules/@getpaseo"),
  note: "Unmodified tracked official app and private audio source; published official client/protocol/relay; shared installed third-party dependencies. Build and browser assertions remain separate.",
};
await writeFile(
  join(stage, "official-app-source.json"),
  JSON.stringify(sourceManifest, null, 2) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(sourceManifest));
