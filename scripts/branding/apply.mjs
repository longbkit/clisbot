#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { kitRoot } from "./artwork.mjs";
import { sourcePatches } from "./source-patches.mjs";

const { values } = parseArgs({
  options: {
    root: { type: "string", default: "." },
    apply: { type: "boolean" },
    check: { type: "boolean" },
  },
});
if (values.apply && values.check) throw new Error("Use either --apply or --check.");
const root = resolve(values.root);
if (!existsSync(join(root, "package.json")))
  throw new Error("Target must be a rebranded repository checkout.");
if (existsSync(join(root, "packages/app/src/components/icons/paseo-logo.tsx")))
  throw new Error("Run the text/path rebrand before applying visual branding.");
const manifest = JSON.parse(readFileSync(join(kitRoot, "manifest.json"), "utf8"));
const hashes = new Map(manifest.artifacts.map((a) => [a.file, a.sha256]));
const planned = [];
const skippedPackages = new Set();

function plan(target, bytes) {
  const absolute = join(root, target);
  if (
    !existsSync(absolute) ||
    lstatSync(absolute).isSymbolicLink() ||
    !readFileSync(absolute).equals(bytes)
  )
    planned.push({ target, bytes });
}

for (const entry of manifest.installs) {
  const packageRoot = entry.target.startsWith("packages/")
    ? entry.target.split("/").slice(0, 2).join("/")
    : "fastlane";
  if (!existsSync(join(root, packageRoot))) {
    skippedPackages.add(packageRoot);
    continue;
  }
  const bytes = readFileSync(join(kitRoot, "exports", entry.artifact));
  if (createHash("sha256").update(bytes).digest("hex") !== hashes.get(entry.artifact))
    throw new Error(`Artifact changed after export: ${entry.artifact}; regenerate the kit.`);
  plan(entry.target, bytes);
}

// Plan every source edit before writing anything. Unknown upstream logo shapes stop the batch.
for (const [file, patch] of sourcePatches) {
  if (!existsSync(join(root, file))) {
    if (file.startsWith("packages/hub/") && !existsSync(join(root, "packages/hub"))) continue;
    throw new Error(`Branding consumer missing: ${file}; review upstream changes.`);
  }
  const before = readFileSync(join(root, file), "utf8");
  plan(file, Buffer.from(patch(before)));
}

if (values.apply) {
  for (const { target, bytes } of planned) {
    mkdirSync(dirname(join(root, target)), { recursive: true });
    // Replace the entry, not a symlink target (Fastlane links to website screenshots upstream).
    const temporary = `${join(root, target)}.branding-${process.pid}`;
    writeFileSync(temporary, bytes, { flag: "wx" });
    renameSync(temporary, join(root, target));
  }
}
const byFolder = {};
for (const { target } of planned) byFolder[dirname(target)] = (byFolder[dirname(target)] ?? 0) + 1;
let mode = "dry-run";
if (values.apply) mode = "apply";
if (values.check) mode = "check";
console.log(
  JSON.stringify(
    {
      mode,
      root,
      changedFiles: planned.length,
      byFolder,
      skippedPackages: [...skippedPackages],
      files: planned.map((p) => p.target),
    },
    null,
    2,
  ),
);
if (values.check && planned.length) process.exitCode = 1;
