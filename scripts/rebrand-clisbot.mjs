#!/usr/bin/env node

// Rebrand a Git checkout without depending on scripts inside that checkout.
// This file lives on the Fusion branch and is also invoked against raw upstream worktrees.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

const options = parseArgs(process.argv.slice(2));
const root = resolve(options.root);
const siteHost = options.siteHost;
const appHost = options.keepUpstreamEndpoints ? null : (options.appHost ?? `app.${siteHost}`);
const relayHost = options.keepUpstreamEndpoints ? null : (options.relayHost ?? `relay.${siteHost}`);
const repoSlug = options.repoSlug;
const decoder = new TextDecoder("utf-8", { fatal: true });

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const planned = [];
const destinationOwners = new Map();
const changedByTopLevel = new Map();
const skippedBinary = [];
const missing = [];

for (const path of tracked) {
  const source = join(root, path);
  if (!existsSync(source)) {
    missing.push(path);
    continue;
  }
  const protectedPath = isProtectedPath(path);
  const target = protectedPath ? path : renameProductText(path);
  const prior = destinationOwners.get(target);
  if (prior && prior !== path) {
    throw new Error(`Path collision: ${prior} and ${path} both map to ${target}`);
  }
  destinationOwners.set(target, path);

  const stat = lstatSync(source);
  let before = null;
  let after = null;
  let occurrences = 0;
  if (!protectedPath && stat.isFile()) {
    const bytes = readFileSync(source);
    if (bytes.includes(0)) {
      skippedBinary.push(path);
    } else {
      before = decodeText(bytes, path);
      if (before !== null) {
        after = removeCollapsedAliases(path, renameProductText(before));
        occurrences = countBrandTokens(before);
      }
    }
  }

  if (target !== path || (after !== null && after !== before)) {
    planned.push({ path, target, after, occurrences });
    const top = path.split("/")[0];
    changedByTopLevel.set(top, (changedByTopLevel.get(top) ?? 0) + 1);
  }
}

if (missing.length) {
  throw new Error(
    `${missing.length} tracked paths are missing. Stage an earlier rename with git add -A before running the check again. First: ${missing[0]}`,
  );
}

for (const item of planned) {
  const target = join(root, item.target);
  if (item.target !== item.path && existsSync(target) && !tracked.includes(item.target)) {
    throw new Error(`Destination already exists outside the Git index: ${item.target}`);
  }
}

if (options.mode === "apply") {
  for (const item of planned) {
    const source = join(root, item.path);
    if (item.after !== null) writeFileSync(source, item.after);
    if (item.target !== item.path) {
      const target = join(root, item.target);
      mkdirSync(dirname(target), { recursive: true });
      renameSync(source, target);
      removeEmptyParents(dirname(source));
    }
  }
}

const report = {
  mode: options.mode,
  root,
  changedFiles: planned.length,
  renamedPaths: planned.filter((item) => item.path !== item.target).length,
  oldBrandOccurrencesInChangedFiles: planned.reduce((sum, item) => sum + item.occurrences, 0),
  changedFilesByTopLevel: Object.fromEntries([...changedByTopLevel].sort()),
  skippedBinaryFiles: skippedBinary.length,
  replacements: {
    siteHost,
    appHost,
    relayHost,
    repoSlug,
    expoOwner: options.expoOwner ?? "CLISBOT_EXPO_OWNER env required for EAS",
    expoProjectId: options.expoProjectId ?? "CLISBOT_EXPO_PROJECT_ID env required for EAS",
  },
};
console.log(JSON.stringify(report, null, 2));
if (options.mode === "check" && planned.length) process.exitCode = 1;

function isProtectedPath(path) {
  return (
    path === "scripts/rebrand-clisbot.mjs" ||
    path === "scripts/rebrand-clisbot.test.mjs" ||
    path === "LICENSE" ||
    path.startsWith("docs/audits/") ||
    path.startsWith("docs/lessons/") ||
    path === "docs/overview/product-vision.md" ||
    path === "docs/guides/developer-guide/upstream-sync-and-contribution.md"
  );
}

function renameProductText(input) {
  const retainedHosts = [];
  const retainedRepos = [];
  const withExternalRepos = input.replace(/getpaseo\/paseo-relay\b/g, (repo) => {
    const index = retainedRepos.push(repo) - 1;
    return `__CLISBOT_UPSTREAM_REPO_${index}__`;
  });
  const prepared = options.keepUpstreamEndpoints
    ? withExternalRepos.replace(/(?:relay|app|hub)\.paseo\.sh/g, (host) => {
        const index = retainedHosts.push(host) - 1;
        return `__CLISBOT_UPSTREAM_HOST_${index}__`;
      })
    : withExternalRepos;
  const renamed = prepared
    .replaceAll("@getpaseo", "@clisbot")
    .replace(/getpaseo\/paseo(?![\w-])/g, repoSlug)
    .replaceAll("relay.paseo.sh", relayHost ?? "relay.paseo.sh")
    .replaceAll("app.paseo.sh", appHost ?? "app.paseo.sh")
    .replaceAll("paseo.sh", siteHost ?? "paseo.sh")
    .replaceAll("PASEO", "CLISBOT")
    .replaceAll("Paseo", "Clisbot")
    .replace(/(?<!get)paseo/g, "clisbot");
  // Regex literals escape the dots in hosts; ordinary URL replacement cannot see them.
  const escapedSite = siteHost.replaceAll(".", "\\.");
  let fixedEscapedHosts = renamed.replaceAll("clisbot\\.sh", escapedSite);
  if (options.keepUpstreamEndpoints) {
    for (const service of ["app", "relay", "hub"]) {
      fixedEscapedHosts = fixedEscapedHosts.replaceAll(
        `${service}\\.${escapedSite}`,
        `${service}\\.paseo\\.sh`,
      );
    }
  }
  return fixedEscapedHosts
    .replace(/__CLISBOT_UPSTREAM_HOST_(\d+)__/g, (_, index) => retainedHosts[Number(index)])
    .replace(/__CLISBOT_UPSTREAM_REPO_(\d+)__/g, (_, index) => retainedRepos[Number(index)]);
}

// The current Fusion tree deliberately supports both the upstream and Clisbot
// environment names. A full rename maps those two names to the same key. Remove
// the resulting duplicate code; raw upstream snapshots simply lack these seams.
function removeCollapsedAliases(path, input) {
  if (path === "packages/desktop/electron-builder.yml") {
    return input.replace(
      "  owner: getpaseo\n  repo: clisbot",
      "  owner: longbkit\n  repo: clisbot",
    );
  }
  if (path === "packages/app/app.config.js") {
    const owner = options.expoOwner
      ? JSON.stringify(options.expoOwner)
      : "process.env.CLISBOT_EXPO_OWNER";
    const projectId = options.expoProjectId
      ? JSON.stringify(options.expoProjectId)
      : "process.env.CLISBOT_EXPO_PROJECT_ID";
    return input
      .replace('slug: "voice-mobile"', 'slug: "clisbot"')
      .replace('packageId: "sh.clisbot"', 'packageId: "com.clisbot.app"')
      .replace('packageId: "sh.clisbot.debug"', 'packageId: "com.clisbot.app.dev"')
      .replace(
        /projectId: (?:"[0-9a-f-]{36}"|process\.env\.CLISBOT_EXPO_PROJECT_ID)/,
        `projectId: ${projectId}`,
      )
      .replace(/owner: (?:"getpaseo"|process\.env\.CLISBOT_EXPO_OWNER)/, `owner: ${owner}`);
  }
  if (path === "packages/server/CLAUDE.md") {
    return input.replace(
      /(\$CLISBOT_HOME\/agents\/\{cwd-with-dashes\}\/\{agent-id\}\.json`)  \n/,
      "$1\n",
    );
  }
  if (path === "packages/cli/src/commands/bot/owner-bootstrap.ts") {
    return input.replace(
      /    CLISBOT_BOOTSTRAP_ORGANIZATION: options\.organizationName \?\? "Clisbot",\n    CLISBOT_BOOTSTRAP_OWNER_EMAIL: options\.ownerEmail,\n    CLISBOT_BOOTSTRAP_OWNER_PASSWORD: password,\n(?=    CLISBOT_BOOTSTRAP_ORGANIZATION:)/,
      "",
    );
  }
  if (path === "packages/cli/src/commands/hub/local-hub.ts") {
    return input
      .replace(
        "    env.CLISBOT_HOME?.trim() ||\n    env.CLISBOT_HOME?.trim() ||\n",
        "    env.CLISBOT_HOME?.trim() ||\n",
      )
      .replace("    CLISBOT_HOME: home,\n  };", "  };");
  }
  if (path === "packages/cli/src/commands/hub/local-hub.test.ts") {
    return input
      .replace(
        "flag beats CLISBOT_HOME, CLISBOT_HOME, and default",
        "flag beats CLISBOT_HOME and default",
      )
      .replace(
        'const env = { CLISBOT_HOME: "/a", CLISBOT_HOME: "/b" }',
        'const env = { CLISBOT_HOME: "/a" }',
      )
      .replace(
        '    expect(resolveLocalHubHome({}, { CLISBOT_HOME: "/b" } as NodeJS.ProcessEnv)).toBe("/b");\n',
        "",
      );
  }
  if (path === "packages/hub/src/env-alias.ts") {
    return input.replace(/^  \["(CLISBOT_[A-Z_]+)", "\1"\],\n/gm, "");
  }
  if (path === "packages/hub/src/env-alias.test.ts") {
    return input
      .replace(
        /  it\("lets an explicit CLISBOT value win over the CLISBOT alias", \(\) => \{[\s\S]*?\n  \}\);\n\n/,
        "",
      )
      .replace(
        "copies a set CLISBOT var into its internal target when unset",
        "preserves an explicit Clisbot home",
      )
      .replace(
        "aliases the channel kill switch and bind vars",
        "preserves the channel kill switch and bind vars",
      );
  }
  if (path === "packages/hub/src/channels/loader/channel-gate.test.ts") {
    return input.replace(
      /  it\("reads the internal \(non-alias\) env name", \(\) => \{[\s\S]*?\n  \}\);\n/,
      "",
    );
  }
  return input;
}

function countBrandTokens(input) {
  return (input.match(/PASEO|Paseo|paseo/g) ?? []).length;
}

function decodeText(bytes, path) {
  try {
    return decoder.decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    skippedBinary.push(path);
    return null;
  }
}

function removeEmptyParents(start) {
  let current = start;
  while (current !== root && current.startsWith(`${root}${sep}`)) {
    try {
      rmdirSync(current);
    } catch {
      break;
    }
    current = dirname(current);
  }
}

function parseArgs(args) {
  const result = {
    mode: "report",
    root: process.cwd(),
    repoSlug: "longbkit/clisbot",
    siteHost: "clisbot.com",
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply" || arg === "--check") result.mode = arg.slice(2);
    else if (arg === "--root") result.root = args[++i];
    else if (arg === "--site-host") result.siteHost = args[++i];
    else if (arg === "--app-host") result.appHost = args[++i];
    else if (arg === "--relay-host") result.relayHost = args[++i];
    else if (arg === "--repo-slug") result.repoSlug = args[++i];
    else if (arg === "--expo-owner") result.expoOwner = args[++i];
    else if (arg === "--expo-project-id") result.expoProjectId = args[++i];
    else if (arg === "--keep-upstream-endpoints") result.keepUpstreamEndpoints = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!result.siteHost || result.siteHost.includes("/")) {
    throw new Error("--site-host must be a hostname");
  }
  if (result.keepUpstreamEndpoints && (result.appHost || result.relayHost)) {
    throw new Error("--keep-upstream-endpoints cannot be combined with service hosts");
  }
  if (Boolean(result.expoOwner) !== Boolean(result.expoProjectId)) {
    throw new Error(
      "Pass both --expo-owner and --expo-project-id, or neither for local-only testing",
    );
  }
  if (
    result.expoProjectId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.expoProjectId)
  ) {
    throw new Error("--expo-project-id must be a UUID");
  }
  return result;
}
