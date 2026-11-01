import { execFileSync } from "node:child_process";
import fs, { readFileSync } from "node:fs";
import os from "node:os";
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

/**
 * The release token, from the environment or the checkout's .env, so a stale login in
 * ~/.npmrc never decides whether a release can publish. Never printed.
 */
export function readReleaseToken(env = process.env, envFile = path.join(root, ".env")) {
  if (env.NPM_RELEASE_TOKEN) return env.NPM_RELEASE_TOKEN;
  if (!fs.existsSync(envFile)) return undefined;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?NPM_RELEASE_TOKEN\s*=\s*["']?([^"'\s#]+)/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

let releaseUserConfig;
/** A private npmrc holding only the release token, written once per run and removed on exit. */
function releaseNpmEnv() {
  const token = readReleaseToken();
  if (!token) return process.env;
  if (!releaseUserConfig) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clisbot-npm-release-"));
    releaseUserConfig = path.join(dir, ".npmrc");
    fs.writeFileSync(
      releaseUserConfig,
      `//registry.npmjs.org/:_authToken=${token}\nregistry=https://registry.npmjs.org/\n`,
      { mode: 0o600 },
    );
    process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  }
  return { ...process.env, NPM_CONFIG_USERCONFIG: releaseUserConfig };
}

function npm(args, options = {}) {
  return execFileSync("npm", args, {
    cwd: root,
    shell: process.platform === "win32",
    env: releaseNpmEnv(),
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
  if (dryRun) return;
  // Every registry write asks for 2FA, so only write the tags that are not already set.
  const current = distTags(pkg);
  for (const wanted of tag === "latest" ? ["latest", "beta"] : [tag]) {
    if (current[wanted] !== pkg.version)
      npm(["dist-tag", "add", `${pkg.name}@${pkg.version}`, wanted], { stdio: "inherit" });
  }
}

function distTags(pkg) {
  const value = npm(["view", pkg.name, "dist-tags", "--json", "--prefer-online"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(value);
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
