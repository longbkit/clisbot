import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReleaseVersion } from "./release-version-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Runtime dependencies publish first; the public entry package moves last. */
export function releasePackages(directory = root) {
  const product = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  const packages = product.workspaces
    .map((workspace) => ({
      workspace,
      ...JSON.parse(readFileSync(path.join(directory, workspace, "package.json"), "utf8")),
    }))
    .filter((pkg) => pkg.private !== true);
  const owned = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(pkg) {
    if (visited.has(pkg.name)) return;
    if (visiting.has(pkg.name)) throw new Error(`Circular release dependency: ${pkg.name}`);
    if (pkg.version !== product.version) throw new Error(`Unsynced version: ${pkg.name}`);
    visiting.add(pkg.name);
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      if (!name.startsWith("@clisbot/")) continue;
      if (!owned.has(name)) throw new Error(`Unpublished dependency: ${pkg.name} -> ${name}`);
      if (version !== product.version)
        throw new Error(`Unpinned dependency: ${pkg.name} -> ${name}`);
      visit(owned.get(name));
    }
    visiting.delete(pkg.name);
    visited.add(pkg.name);
    ordered.push(pkg);
  }
  const entry = owned.get("clisbot");
  if (!entry) throw new Error("Missing public clisbot entry package");
  visit(entry);
  return ordered;
}

function npm(args, options = {}) {
  return execFileSync("npm", args, {
    cwd: root,
    shell: process.platform === "win32",
    ...options,
  });
}

function alreadyPublished(pkg) {
  try {
    const value = npm(["view", `${pkg.name}@${pkg.version}`, "version", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(value) === pkg.version;
  } catch (error) {
    if (String(error.stderr).includes("E404")) return false;
    throw error;
  }
}

function publish(pkg, tag, dryRun) {
  if (!dryRun && alreadyPublished(pkg)) {
    console.log(`Already published: ${pkg.name}@${pkg.version}`);
  } else {
    npm(
      [
        "publish",
        "--workspace",
        pkg.workspace,
        "--access",
        "public",
        "--tag",
        tag,
        ...(dryRun ? ["--dry-run"] : []),
      ],
      { stdio: "inherit" },
    );
  }
  if (!dryRun) {
    npm(["dist-tag", "add", `${pkg.name}@${pkg.version}`, tag], { stdio: "inherit" });
    if (tag === "latest")
      npm(["dist-tag", "add", `${pkg.name}@${pkg.version}`, "beta"], { stdio: "inherit" });
  }
}

export function runNpmRelease(argv) {
  const [mode, ...options] = argv;
  if (!["pack", "publish", "list"].includes(mode))
    throw new Error("Expected pack, publish, or list");
  const tagIndex = options.indexOf("--tag");
  const tag = tagIndex < 0 ? "latest" : options[tagIndex + 1];
  if (!["latest", "beta"].includes(tag)) throw new Error("Expected latest or beta tag");
  for (const pkg of releasePackages()) {
    if (mode === "list") console.log(`${pkg.name}@${pkg.version}`);
    else if (mode === "pack")
      npm(["pack", "--dry-run", "--workspace", pkg.workspace], { stdio: "inherit" });
    else {
      if (parseReleaseVersion(pkg.version).isPrerelease && tag !== "beta")
        throw new Error("Prereleases must use beta");
      publish(pkg, tag, options.includes("--dry-run"));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNpmRelease(process.argv.slice(2));
}
