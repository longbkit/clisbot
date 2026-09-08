#!/usr/bin/env node
// Machine-checked source manifest for the in-repo channel verticals.
//
// Each package under packages/channels/* owns an `upstream-sync.json` that says,
// per local production file, where it came from in the OpenClaw checkout at a
// pinned baseline commit and how far it drifted. This script is the consumer:
// `check` fails when the manifest and the tree disagree, `report` shows what
// moved upstream since the baseline, `apply` replays an upstream delta onto the
// ported files (channel-upstream-sync-apply.mjs), `sync-md` regenerates the
// SYNC.md view.
//
// The hand-written SYNC tables it replaces went stale silently — no baseline
// commit, no tooling, many-to-one rows that could not be diffed
// (docs/audits/2026-09-06-openclaw-channel-alignment.md §11).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANNELS_DIR = path.join(REPO_ROOT, "packages", "channels");
const MANIFEST_NAME = "upstream-sync.json";
const STATUSES = new Set(["verbatim", "adapted", "reimplemented", "fusion-owned"]);
const NEEDS_DEVIATION = new Set(["adapted", "reimplemented"]);
export const TEST_FILE_RE = /\.test\.ts$|\.test-[^/]*\.ts$/;
export const HEADER_RE = /^\/\/ upstream:[^\n]*\n/;
const SYNC_SECTION_HEADING = "## Source manifest";
const LEGACY_SECTION_RE = /^##\s*(Module\s*→|OUT OF SCOPE)/;

export function defaultUpstreamDir() {
  return process.env.OPENCLAW_UPSTREAM_DIR ?? path.join(homedir(), "projects", "openclaw-private");
}

// ---------------------------------------------------------------- git helpers

function git(repo, args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(" ")} failed in ${repo}: ${error.stderr ?? error.message}`, {
      cause: error,
    });
  }
}

export function gitHasPath(repo, commit, filePath) {
  return git(repo, ["cat-file", "-e", `${commit}:${filePath}`], { allowFail: true }) !== null;
}

export function gitShow(repo, commit, filePath) {
  return git(repo, ["show", `${commit}:${filePath}`], { allowFail: true });
}

export function gitListTree(repo, commit, prefix) {
  const out = git(repo, ["ls-tree", "-r", "--name-only", commit, "--", prefix], {
    allowFail: true,
  });
  return out ? out.split("\n").filter(Boolean) : [];
}

// ------------------------------------------------------------------ manifests

export function listManifestPackages(channelsDir = CHANNELS_DIR) {
  if (!existsSync(channelsDir)) return [];
  return readdirSync(channelsDir)
    .filter((name) => existsSync(path.join(channelsDir, name, MANIFEST_NAME)))
    .sort();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function loadManifest(manifestPath) {
  const manifest = readJson(manifestPath);
  return {
    manifestPath,
    pkgDir: path.dirname(manifestPath),
    pkgName: path.basename(path.dirname(manifestPath)),
    baselineCommit: manifest.baselineCommit,
    roots: manifest.roots ?? [],
    files: manifest.files ?? [],
    omitted: manifest.omitted ?? [],
    deviations: manifest.deviations ?? [],
    raw: manifest,
  };
}

function deviationIds(entry) {
  if (!entry.deviation) return [];
  return Array.isArray(entry.deviation) ? entry.deviation : [entry.deviation];
}

function walkTsFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "dist") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTsFiles(full, base));
    else if (name.endsWith(".ts")) out.push(path.relative(base, full));
  }
  return out;
}

function localProductionFiles(manifest) {
  const found = [];
  for (const root of manifest.roots) {
    const rootDir = path.join(manifest.pkgDir, root.local);
    for (const rel of walkTsFiles(rootDir)) {
      found.push({ local: path.posix.join(root.local, rel.split(path.sep).join("/")) });
    }
  }
  return found;
}

// ------------------------------------------------------- verbatim comparison
//
// Normalization applied to BOTH sides before a `verbatim` entry is compared.
// Anything outside this list is a real difference and fails the check:
//   1. a line-1 `// upstream: <path>@<sha>` provenance header (local side only);
//   2. module specifiers — every `from "x"`, `import "x"` and `import("x")`
//      collapses to a placeholder, so import-path rewrites are invisible;
//   3. trailing whitespace, and runs of blank lines collapsed to one.
// Comments and code are NOT normalized.

const SPECIFIER_RES = [
  /(\bfrom\s*)(["'])([^"'\n]*)\2/g,
  /(\bimport\s*\(\s*)(["'])([^"'\n]*)\2/g,
  /(\bimport\s+)(["'])([^"'\n]*)\2/g,
];

/** Rewrites every module specifier through `render(specifier, quote)`. */
export function replaceSpecifiers(text, render) {
  let out = text;
  for (const pattern of SPECIFIER_RES) {
    out = out.replace(pattern, (_match, lead, quote, spec) => `${lead}${render(spec, quote)}`);
  }
  return out;
}

/** Specifiers in the fixed scan order of `replaceSpecifiers`, so two files zip. */
export function listSpecifiers(text) {
  const found = [];
  replaceSpecifiers(text, (spec, quote) => {
    found.push(spec);
    return `${quote}${spec}${quote}`;
  });
  return found;
}

export function normalizeSource(text) {
  const withoutHeader = text.replace(HEADER_RE, "");
  const withoutSpecifiers = replaceSpecifiers(withoutHeader, () => '"<spec>"');
  const lines = withoutSpecifiers.split("\n").map((line) => line.replace(/\s+$/, ""));
  const collapsed = lines.filter((line, index) => line !== "" || lines[index - 1] !== "");
  while (collapsed.length && collapsed[0] === "") collapsed.shift();
  while (collapsed.length && collapsed.at(-1) === "") collapsed.pop();
  return collapsed;
}

export function compareVerbatim(localText, upstreamText) {
  const local = normalizeSource(localText);
  const upstream = normalizeSource(upstreamText);
  const limit = Math.max(local.length, upstream.length);
  for (let index = 0; index < limit; index += 1) {
    if (local[index] === upstream[index]) continue;
    return {
      equal: false,
      line: index + 1,
      localLine: (local[index] ?? "<eof>").slice(0, 100),
      upstreamLine: (upstream[index] ?? "<eof>").slice(0, 100),
    };
  }
  return { equal: true };
}

// ---------------------------------------------------------------------- check

function checkFileEntry(entry, context) {
  const { manifest, upstreamDir, fail } = context;
  const where = `${manifest.pkgName}: ${entry.local}`;
  if (!STATUSES.has(entry.status)) fail(`${where}: unknown status "${entry.status}"`);
  if (!existsSync(path.join(manifest.pkgDir, entry.local))) fail(`${where}: local file missing`);
  if (entry.status === "fusion-owned") {
    if (entry.upstream) fail(`${where}: fusion-owned entries must not carry an upstream path`);
    return;
  }
  if (!entry.upstream)
    return void fail(`${where}: status "${entry.status}" needs an upstream path`);
  if (!gitHasPath(upstreamDir, manifest.baselineCommit, entry.upstream)) {
    fail(`${where}: upstream ${entry.upstream} missing at ${manifest.baselineCommit}`);
  } else if (entry.status === "verbatim") {
    checkVerbatimEntry(entry, context, where);
  }
  if (NEEDS_DEVIATION.has(entry.status) && deviationIds(entry).length === 0) {
    fail(`${where}: status "${entry.status}" needs a deviation id`);
  }
}

function checkVerbatimEntry(entry, { manifest, upstreamDir, fail }, where) {
  const localText = readFileSync(path.join(manifest.pkgDir, entry.local), "utf8");
  const upstreamText = gitShow(upstreamDir, manifest.baselineCommit, entry.upstream) ?? "";
  const diff = compareVerbatim(localText, upstreamText);
  if (diff.equal) return;
  fail(
    `${where}: marked verbatim but differs from upstream at normalized line ${diff.line}\n` +
      `      local:    ${diff.localLine}\n      upstream: ${diff.upstreamLine}`,
  );
}

function checkDeviations(manifest, { fail, referenced }) {
  const seen = new Set();
  for (const deviation of manifest.deviations) {
    const where = `${manifest.pkgName}: deviation ${deviation.id}`;
    if (seen.has(deviation.id)) fail(`${where}: duplicate id`);
    seen.add(deviation.id);
    if (!deviation.reason) fail(`${where}: missing reason`);
    if (!referenced.has(deviation.id)) fail(`${where}: not referenced by any file entry`);
    if (deviation.file && !existsSync(path.join(manifest.pkgDir, deviation.file))) {
      fail(`${where}: file ${deviation.file} does not exist`);
    }
    for (const test of deviation.tests ?? []) {
      if (!existsSync(path.join(manifest.pkgDir, test)))
        fail(`${where}: test ${test} does not exist`);
    }
  }
  for (const id of referenced) {
    if (!seen.has(id)) fail(`${manifest.pkgName}: file entry references unknown deviation ${id}`);
  }
}

function checkCoverage(manifest, { fail, warn, tests }) {
  const mapped = new Set(manifest.files.map((entry) => entry.local));
  const duplicates = manifest.files.length - mapped.size;
  if (duplicates > 0) fail(`${manifest.pkgName}: ${duplicates} duplicate local path(s) in files`);
  for (const { local } of localProductionFiles(manifest)) {
    if (mapped.has(local)) continue;
    if (TEST_FILE_RE.test(local)) tests.push(local);
    else fail(`${manifest.pkgName}: ${local} has no manifest entry`);
  }
  void warn;
}

function checkUnmappedUpstream(manifest, { upstreamDir, warn, fail, strict }) {
  const claimed = new Set(manifest.files.map((entry) => entry.upstream).filter(Boolean));
  const omitted = manifest.omitted.map((entry) => entry.upstream);
  const unmapped = [];
  for (const root of manifest.roots) {
    // A root without an `upstream` prefix is a local-only tree (a fusion-owned package).
    if (!root.upstream) continue;
    for (const file of gitListTree(upstreamDir, manifest.baselineCommit, root.upstream)) {
      if (!file.endsWith(".ts") || TEST_FILE_RE.test(file)) continue;
      if (claimed.has(file)) continue;
      // An `omitted.upstream` may name a file or a directory covering everything beneath it.
      if (omitted.some((entry) => entry === file || file.startsWith(`${entry}/`))) continue;
      unmapped.push(file);
    }
  }
  if (unmapped.length === 0) return;
  const message = `${manifest.pkgName}: ${unmapped.length} unmapped upstream file(s), first: ${unmapped.slice(0, 5).join(", ")}`;
  if (strict) fail(message);
  else warn(message);
}

export function checkManifest(
  manifestPath,
  { upstreamDir = defaultUpstreamDir(), strict = false } = {},
) {
  const manifest = loadManifest(manifestPath);
  const failures = [];
  const warnings = [];
  const tests = [];
  const fail = (message) => failures.push(message);
  const warn = (message) => warnings.push(message);
  const referenced = new Set();
  if (!manifest.baselineCommit) fail(`${manifest.pkgName}: manifest has no baselineCommit`);
  const context = { manifest, upstreamDir, fail, warn, strict };
  for (const entry of manifest.files) {
    checkFileEntry(entry, context);
    for (const id of deviationIds(entry)) referenced.add(id);
  }
  checkDeviations(manifest, { fail, referenced });
  checkCoverage(manifest, { fail, warn, tests });
  if (manifest.baselineCommit) checkUnmappedUpstream(manifest, context);
  return { manifest, failures, warnings, tests, counts: countByStatus(manifest) };
}

export function countByStatus(manifest) {
  const counts = {};
  for (const status of STATUSES) counts[status] = 0;
  for (const entry of manifest.files) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return counts;
}

function runCheck({ manifests, upstreamDir, strict }) {
  let failed = 0;
  for (const manifestPath of manifests) {
    const result = checkManifest(manifestPath, { upstreamDir, strict });
    const statuses = Object.entries(result.counts)
      .map(([status, count]) => `${status}=${count}`)
      .join(" ");
    process.stdout.write(
      `${result.manifest.pkgName}: ${result.manifest.files.length} files (${statuses}), ${result.tests.length} test files, ${result.manifest.deviations.length} deviations\n`,
    );
    for (const warning of result.warnings) process.stdout.write(`  WARN ${warning}\n`);
    for (const failure of result.failures) process.stdout.write(`  FAIL ${failure}\n`);
    if (result.failures.length > 0) failed += 1;
    else process.stdout.write("  PASS\n");
  }
  return failed === 0 ? 0 : 1;
}

// --------------------------------------------------------------------- report

function upstreamPackageJsonPath(upstreamDir, commit, root) {
  let dir = root.upstream;
  while (dir && dir !== ".") {
    const candidate = `${dir}/package.json`;
    if (gitHasPath(upstreamDir, commit, candidate)) return candidate;
    dir = path.posix.dirname(dir);
  }
  return null;
}

function thirdPartyDeps(pkgJson) {
  const deps = { ...pkgJson?.dependencies, ...pkgJson?.peerDependencies };
  const out = {};
  for (const [name, range] of Object.entries(deps)) {
    // Third-party only: the OpenClaw runtime and the Fusion workspace are not sync surface.
    if (name === "openclaw" || name.startsWith("@openclaw/") || name.startsWith("@getpaseo/"))
      continue;
    if (typeof range === "string" && /^(workspace|file|link|catalog):/.test(range)) continue;
    out[name] = range;
  }
  return out;
}

function readUpstreamJson(upstreamDir, commit, filePath) {
  const text = filePath ? gitShow(upstreamDir, commit, filePath) : null;
  return text ? JSON.parse(text) : null;
}

function reportFileDeltas(manifest, upstreamDir, to) {
  const mapped = manifest.files.map((entry) => entry.upstream).filter(Boolean);
  if (mapped.length === 0) return [];
  const numstat = git(
    upstreamDir,
    ["diff", "--numstat", manifest.baselineCommit, to, "--", ...mapped],
    {
      allowFail: true,
    },
  );
  const changed = new Map();
  for (const line of (numstat ?? "").split("\n").filter(Boolean)) {
    const [added, deleted, file] = line.split("\t");
    changed.set(file, { added, deleted });
  }
  return manifest.files
    .filter((entry) => entry.upstream)
    .map((entry) => ({
      local: entry.local,
      upstream: entry.upstream,
      status: entry.status,
      delta: changed.get(entry.upstream) ?? null,
    }));
}

function reportNewUpstreamFiles(manifest, upstreamDir, to) {
  const news = [];
  for (const root of manifest.roots) {
    if (!root.upstream) continue;
    const before = new Set(gitListTree(upstreamDir, manifest.baselineCommit, root.upstream));
    for (const file of gitListTree(upstreamDir, to, root.upstream)) {
      if (!before.has(file) && file.endsWith(".ts") && !TEST_FILE_RE.test(file)) news.push(file);
    }
  }
  return news;
}

function reportDeps(manifest, upstreamDir, to) {
  const local = thirdPartyDeps(readJson(path.join(manifest.pkgDir, "package.json")));
  const rows = new Map();
  for (const [name, range] of Object.entries(local)) rows.set(name, { name, local: range });
  for (const root of manifest.roots) {
    if (!root.upstream) continue;
    const basePath = upstreamPackageJsonPath(upstreamDir, manifest.baselineCommit, root);
    const toPath = upstreamPackageJsonPath(upstreamDir, to, root) ?? basePath;
    const base = thirdPartyDeps(readUpstreamJson(upstreamDir, manifest.baselineCommit, basePath));
    const head = thirdPartyDeps(readUpstreamJson(upstreamDir, to, toPath));
    for (const name of new Set([...Object.keys(base), ...Object.keys(head)])) {
      const row = rows.get(name) ?? { name };
      row.baseline = base[name] ?? row.baseline;
      row.to = head[name] ?? row.to;
      rows.set(name, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function buildReport(manifestPath, { upstreamDir = defaultUpstreamDir(), to } = {}) {
  const manifest = loadManifest(manifestPath);
  const target = to ?? git(upstreamDir, ["rev-parse", "HEAD"]).trim();
  return {
    pkg: manifest.pkgName,
    baselineCommit: manifest.baselineCommit,
    to: target,
    files: reportFileDeltas(manifest, upstreamDir, target),
    newUpstreamFiles: reportNewUpstreamFiles(manifest, upstreamDir, target),
    deps: reportDeps(manifest, upstreamDir, target),
  };
}

function printReport(report) {
  const changed = report.files.filter((row) => row.delta);
  process.stdout.write(`\n## ${report.pkg} — ${report.baselineCommit} → ${report.to}\n\n`);
  process.stdout.write(
    `${changed.length} of ${report.files.length} mapped upstream files changed; ${report.newUpstreamFiles.length} new upstream files.\n\n`,
  );
  if (changed.length > 0) {
    process.stdout.write("| Local | Upstream | Status | +/- |\n| --- | --- | --- | --- |\n");
    for (const row of changed) {
      process.stdout.write(
        `| \`${row.local}\` | \`${row.upstream}\` | ${row.status} | +${row.delta.added}/-${row.delta.deleted} |\n`,
      );
    }
    process.stdout.write("\n");
  }
  if (report.newUpstreamFiles.length > 0) {
    process.stdout.write("New upstream files under mapped roots:\n\n");
    for (const file of report.newUpstreamFiles) process.stdout.write(`- \`${file}\`\n`);
    process.stdout.write("\n");
  }
  process.stdout.write(
    "| Dependency | upstream@baseline | upstream@to | local |\n| --- | --- | --- | --- |\n",
  );
  for (const dep of report.deps) {
    process.stdout.write(
      `| \`${dep.name}\` | ${dep.baseline ?? "—"} | ${dep.to ?? "—"} | ${dep.local ?? "—"} |\n`,
    );
  }
}

// -------------------------------------------------------------------- sync-md

/** Column-padded so the generated section survives `npm run format` unchanged. */
function renderTable(headers, rows) {
  const widths = headers.map((header, column) =>
    Math.max(header.length, 3, ...rows.map((row) => row[column].length)),
  );
  const line = (cells, pad) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column], pad)).join(" | ")} |`;
  return [
    line(headers, " "),
    line(
      widths.map(() => ""),
      "-",
    ),
    ...rows.map((row) => line(row, " ")),
  ];
}

export function renderSyncSection(manifest) {
  const counts = countByStatus(manifest);
  const roots = manifest.roots
    .map((root) =>
      root.upstream ? `\`${root.upstream}\` → \`${root.local}\`` : `\`${root.local}\` (local only)`,
    )
    .join(", ");
  const lines = [
    SYNC_SECTION_HEADING,
    "",
    "Generated by `node scripts/channel-upstream-sync.mjs sync-md`. Do not edit by hand;",
    `edit \`${MANIFEST_NAME}\` and regenerate. Reasons live in \`DEVIATIONS.md\`.`,
    "",
    `Upstream \`${manifest.raw.upstreamRepo}\` at \`${manifest.baselineCommit}\`. Roots: ${roots || "none"}.`,
    "",
    ...renderTable(
      ["Status", "Files"],
      [...STATUSES].map((status) => [status, String(counts[status] ?? 0)]),
    ),
    "",
    ...renderTable(
      ["Local", "Upstream", "Status", "Deviation"],
      manifest.files.map((entry) => [
        `\`${entry.local}\``,
        entry.upstream ? `\`${entry.upstream}\`` : "—",
        entry.status,
        deviationIds(entry).join(", ") || "—",
      ]),
    ),
  ];
  if (manifest.omitted.length > 0) {
    lines.push(
      "",
      ...renderTable(
        ["Omitted upstream", "Reason"],
        manifest.omitted.map((entry) => [`\`${entry.upstream}\``, entry.reason]),
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function mergeSyncMd(existing, section) {
  const kept = [];
  let dropping = false;
  for (const line of (existing ?? "").split("\n")) {
    if (line.startsWith("## "))
      dropping = line === SYNC_SECTION_HEADING || LEGACY_SECTION_RE.test(line);
    if (!dropping) kept.push(line);
  }
  while (kept.length && kept.at(-1) === "") kept.pop();
  return `${kept.join("\n")}\n\n${section}`;
}

function runSyncMd(manifests) {
  for (const manifestPath of manifests) {
    const manifest = loadManifest(manifestPath);
    const syncPath = path.join(manifest.pkgDir, "SYNC.md");
    const existing = existsSync(syncPath)
      ? readFileSync(syncPath, "utf8")
      : `# ${manifest.pkgName} SYNC\n`;
    writeFileSync(syncPath, mergeSyncMd(existing, renderSyncSection(manifest)));
    process.stdout.write(`wrote ${path.relative(REPO_ROOT, syncPath)}\n`);
  }
  return 0;
}

// ----------------------------------------------------------------------- main

function parseArgs(argv) {
  const options = {
    command: argv[0],
    pkg: null,
    from: null,
    to: null,
    json: false,
    strict: false,
    dryRun: false,
    includeAdapted: false,
    forceBaseline: false,
    manifest: null,
    file: null,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pkg") options.pkg = argv[++index];
    else if (arg === "--from") options.from = argv[++index];
    else if (arg === "--to") options.to = argv[++index];
    else if (arg === "--manifest") options.manifest = argv[++index];
    else if (arg === "--file") options.file = argv[++index];
    else if (arg === "--json") options.json = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--include-adapted") options.includeAdapted = true;
    else if (arg === "--force-baseline") options.forceBaseline = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function resolveManifests(options) {
  if (options.manifest) return [path.resolve(REPO_ROOT, options.manifest)];
  const packages = listManifestPackages().filter((name) => !options.pkg || name === options.pkg);
  if (packages.length === 0)
    throw new Error(`no manifest found (looked for packages/channels/*/${MANIFEST_NAME})`);
  return packages.map((name) => path.join(CHANNELS_DIR, name, MANIFEST_NAME));
}

async function runApplyCommand(manifests, options, upstreamDir) {
  if (!options.to) throw new Error("apply needs --to <commit>");
  const { runApply } = await import("./channel-upstream-sync-apply.mjs");
  return runApply(manifests, {
    upstreamDir,
    from: options.from,
    to: options.to,
    dryRun: options.dryRun,
    includeAdapted: options.includeAdapted,
    forceBaseline: options.forceBaseline,
    json: options.json,
  });
}

/**
 * Rebuilds a `verbatim` file from upstream at the manifest baseline, keeping the
 * local `// upstream:` header and the local module specifiers (zipped in scan
 * order). This is the repair for a whitespace-only drift (a formatter reflow):
 * the upstream line shape comes back, nothing else changes.
 */
export function restoreVerbatimFile(localText, upstreamText, header) {
  const localSpecs = listSpecifiers(localText);
  const upstreamSpecs = listSpecifiers(upstreamText);
  if (localSpecs.length !== upstreamSpecs.length) {
    return {
      ok: false,
      reason: `specifier count differs (local ${localSpecs.length}, upstream ${upstreamSpecs.length})`,
    };
  }
  let index = 0;
  const body = replaceSpecifiers(
    upstreamText,
    (_spec, quote) => `${quote}${localSpecs[index++]}${quote}`,
  );
  return { ok: true, text: `${header}\n${body}` };
}

function runRestore({ manifests, upstreamDir, file }) {
  let failed = 0;
  for (const manifestPath of manifests) {
    const manifest = loadManifest(manifestPath);
    const base = manifest.pkgDir;
    for (const entry of manifest.files) {
      if (entry.status !== "verbatim" || !entry.upstream) continue;
      if (file && entry.local !== file) continue;
      const localPath = path.join(base, entry.local);
      if (!existsSync(localPath)) continue;
      const localText = readFileSync(localPath, "utf8");
      const upstreamText = gitShow(upstreamDir, manifest.baselineCommit, entry.upstream);
      if (upstreamText === null) continue;
      if (compareVerbatim(localText, upstreamText).equal) continue;
      const header = localText.split("\n")[0];
      const result = restoreVerbatimFile(localText, upstreamText, header);
      if (!result.ok) {
        failed += 1;
        console.log(`  SKIP ${entry.local}: ${result.reason}`);
        continue;
      }
      writeFileSync(localPath, result.text);
      console.log(`  restored ${entry.local}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

async function main(argv) {
  const options = parseArgs(argv);
  const upstreamDir = defaultUpstreamDir();
  if (!existsSync(path.join(upstreamDir, ".git"))) {
    throw new Error(`upstream checkout not found at ${upstreamDir} (set OPENCLAW_UPSTREAM_DIR)`);
  }
  const manifests = resolveManifests(options);
  if (options.command === "check")
    return runCheck({ manifests, upstreamDir, strict: options.strict });
  if (options.command === "apply") {
    // `--from` defaults to each manifest's own baseline, which is the commit the
    // ported files actually sit at.
    if (options.from) return runApplyCommand(manifests, options, upstreamDir);
    let failed = 0;
    for (const manifestPath of manifests) {
      const from = loadManifest(manifestPath).baselineCommit;
      failed += await runApplyCommand([manifestPath], { ...options, from }, upstreamDir);
    }
    return failed === 0 ? 0 : 1;
  }
  if (options.command === "sync-md") return runSyncMd(manifests);
  if (options.command === "restore")
    return runRestore({ manifests, upstreamDir, file: options.file });
  if (options.command === "report") {
    const reports = manifests.map((manifestPath) =>
      buildReport(manifestPath, { upstreamDir, to: options.to }),
    );
    if (options.json) process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
    else for (const report of reports) printReport(report);
    return 0;
  }
  throw new Error(
    "usage: channel-upstream-sync.mjs <check|report|apply|sync-md|restore> [--pkg <name>] [--file <local>] " +
      "[--manifest <path>] [--from <commit>] [--to <commit>] [--json] [--strict] " +
      "[--dry-run] [--include-adapted] [--force-baseline]",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Not `await` at top level: `apply` imports this module back, and a top-level
  // await here would deadlock that cycle.
  main(process.argv.slice(2))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      return 2;
    })
    .then((code) => {
      process.exitCode = code;
      return code;
    });
}
