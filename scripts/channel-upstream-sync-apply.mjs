// `apply`: replay an upstream delta onto the ported files of one package.
//
// The port is a copy with two known edits: a line-1 `// upstream: <path>@<sha>`
// header and rewritten module specifiers. So the delta is replayed by putting
// the two upstream revisions into *local* specifier space first — the map is
// derived from the local file against upstream@from — and then running a
// diff3 merge with the local file as "current". Base then equals current except
// where the port really drifted, which is where a conflict is the right answer.
//
// Rows are `clean | conflict | unchanged | skipped(reason)`; new and deleted
// upstream files under the mapped roots are listed but never written.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  gitListTree,
  gitShow,
  HEADER_RE,
  listSpecifiers,
  loadManifest,
  replaceSpecifiers,
  TEST_FILE_RE,
} from "./channel-upstream-sync.mjs";

// ------------------------------------------------------------------ specifiers

/**
 * upstream specifier → local specifier, derived positionally. Zipping only
 * makes sense when both sides have the same specifier count; when they don't,
 * the port added or dropped an import and the caller is told the map is not
 * derivable rather than being handed a guess.
 */
export function deriveSpecifierMap(localBody, upstreamText) {
  const local = listSpecifiers(localBody);
  const upstream = listSpecifiers(upstreamText);
  if (local.length !== upstream.length) {
    return { map: new Map(), derivable: false, counts: [local.length, upstream.length] };
  }
  const map = new Map();
  const ambiguous = new Set();
  for (const [index, spec] of upstream.entries()) {
    if (spec === local[index]) continue;
    if (map.has(spec) && map.get(spec) !== local[index]) ambiguous.add(spec);
    else map.set(spec, local[index]);
  }
  return { map, derivable: true, ambiguous: [...ambiguous] };
}

function rewriteSpecifiers(text, map) {
  return replaceSpecifiers(text, (spec, quote) => `${quote}${map.get(spec) ?? spec}${quote}`);
}

/** The upstream file a relative specifier names, in upstream path space. */
function resolveRelative(upstreamPath, spec) {
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(upstreamPath), spec));
  if (joined.startsWith("..")) return null;
  return joined.endsWith(".js") ? `${joined.slice(0, -3)}.ts` : `${joined}.ts`;
}

/** The specifier a local file should use to reach another local file. */
function localSpecifier(fromLocal, toLocal) {
  const rel = path.posix.relative(path.posix.dirname(fromLocal), toLocal).replace(/\.ts$/, ".js");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** The local file a relative local specifier names. */
function localTarget(fromLocal, spec) {
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromLocal), spec));
  return joined.endsWith(".js") ? `${joined.slice(0, -3)}.ts` : `${joined}.ts`;
}

/**
 * The local entry a ported upstream file lives in. Some upstream files are
 * claimed by two entries (a Fusion-owned split plus the verbatim port); when
 * one of them already sits at the specifier upstream uses, that one wins and
 * nothing is rewritten. Otherwise ambiguity is reported, not resolved.
 */
function portedEntry(spec, entry, candidates) {
  if (candidates.length === 0) return { entry: null };
  const identical = candidates.find((row) => localSpecifier(entry.local, row.local) === spec);
  if (identical) return { entry: identical };
  if (candidates.length === 1) return { entry: candidates[0] };
  return { entry: null, ambiguous: candidates.map((row) => row.local) };
}

/**
 * Rewrites for the imports `to` adds, plus the notes for the ones no evidence
 * covers. Two sources of evidence, never a guess:
 *   - a relative import whose target is ported: the manifest says where it
 *     lives locally, and the local layout is flatter than upstream's;
 *   - a bare import some other file in this package already rewrites the same
 *     way (`packageMap`).
 * What is left is hand work — a package to add, or a file to port — and is why
 * a conflict-free apply can still fail to typecheck.
 */
function resolveIntroducedImports(
  entry,
  { fromText, toText, map, claimed, byUpstream, packageMap },
) {
  const before = new Set(listSpecifiers(fromText));
  const rewrites = new Map();
  const notes = [];
  for (const spec of new Set(listSpecifiers(toText))) {
    if (before.has(spec) || map.has(spec)) continue;
    if (!spec.startsWith(".")) {
      const known = packageMap.get(spec);
      if (!known) {
        notes.push(`new upstream import "${spec}"`);
        continue;
      }
      const local = known.spec ?? localSpecifier(entry.local, known.file);
      rewrites.set(spec, local);
      notes.push(`rewrote new import "${spec}" → "${local}"`);
      continue;
    }
    const target = resolveRelative(entry.upstream, spec);
    if (!target) continue;
    const ported = portedEntry(spec, entry, byUpstream.get(target) ?? []);
    if (ported.ambiguous)
      notes.push(`ambiguous port target for ${spec}: ${ported.ambiguous.join(", ")}`);
    if (!ported.entry) {
      if (!claimed.has(target)) notes.push(`unported import ${target}`);
      continue;
    }
    const expected = localSpecifier(entry.local, ported.entry.local);
    if (expected !== spec) {
      rewrites.set(spec, expected);
      notes.push(`rewrote new import ${spec} → ${expected}`);
    }
  }
  return { rewrites, notes };
}

/**
 * Every upstream→local specifier rewrite this package already makes, so a
 * newly introduced import can be rewritten the same way. A rewrite lands on a
 * package (`spec`) or on a vendored local file (`file`) — the file form is
 * needed because the same vendored module is reached by a different relative
 * path from every depth. Evidence that disagrees is dropped, not resolved.
 */
export function buildPackageSpecifierMap(manifest, { upstreamDir, from }) {
  const seen = new Map();
  for (const entry of manifest.files) {
    if (!entry.upstream) continue;
    const localPath = path.join(manifest.pkgDir, entry.local);
    if (!existsSync(localPath)) continue;
    const fromText = gitShow(upstreamDir, from, entry.upstream);
    if (fromText === null) continue;
    const localText = readFileSync(localPath, "utf8");
    const { map, derivable } = deriveSpecifierMap(localText.replace(HEADER_RE, ""), fromText);
    if (!derivable) continue;
    for (const [upstreamSpec, localSpec] of map) {
      if (upstreamSpec.startsWith(".")) continue;
      if (!seen.has(upstreamSpec)) seen.set(upstreamSpec, new Set());
      seen
        .get(upstreamSpec)
        .add(
          localSpec.startsWith(".")
            ? `file:${localTarget(entry.local, localSpec)}`
            : `spec:${localSpec}`,
        );
    }
  }
  const resolved = new Map();
  for (const [upstreamSpec, locals] of seen) {
    if (locals.size !== 1) continue;
    const [only] = [...locals];
    resolved.set(
      upstreamSpec,
      only.startsWith("file:") ? { file: only.slice(5) } : { spec: only.slice(5) },
    );
  }
  return resolved;
}

// ----------------------------------------------------------------- merge + git

/**
 * `git merge-file` exits with the conflict count; anything above 127 is a
 * refusal (a file it considers binary, most often), which is reported for that
 * one file instead of aborting the package.
 */
export function mergeThreeWay(current, base, other, labels) {
  const dir = mkdtempSync(path.join(tmpdir(), "channel-sync-merge-"));
  try {
    const paths = ["current", "base", "other"].map((name) => path.join(dir, name));
    for (const [index, text] of [current, base, other].entries()) writeFileSync(paths[index], text);
    const args = ["merge-file", "-p", "--diff3"];
    for (const label of labels) args.push("-L", label);
    try {
      return {
        merged: execFileSync("git", [...args, ...paths], { encoding: "utf8" }),
        conflicts: 0,
      };
    } catch (error) {
      if (typeof error.status !== "number" || error.status < 0 || error.status > 127) {
        return {
          failed: String(error.stderr ?? error.message)
            .trim()
            .split("\n")
            .at(-1),
        };
      }
      return { merged: error.stdout, conflicts: error.status };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function retargetHeader(header, upstreamPath, to) {
  return header ? `// upstream: ${upstreamPath}@${to}\n` : "";
}

// -------------------------------------------------------------------- per file

function applyFile(entry, context) {
  const { manifest, upstreamDir, from, to, dryRun } = context;
  const localPath = path.join(manifest.pkgDir, entry.local);
  if (!existsSync(localPath)) return { result: "skipped", reason: "local file missing" };
  const fromText = gitShow(upstreamDir, from, entry.upstream);
  const toText = gitShow(upstreamDir, to, entry.upstream);
  if (fromText === null) return { result: "skipped", reason: "absent upstream at --from" };
  if (toText === null) return { result: "skipped", reason: "deleted upstream at --to" };
  if (fromText === toText) return { result: "unchanged" };

  const localText = readFileSync(localPath, "utf8");
  const header = localText.match(HEADER_RE)?.[0] ?? "";
  const body = localText.slice(header.length);
  const { map, derivable, counts, ambiguous } = deriveSpecifierMap(body, fromText);
  const introduced = resolveIntroducedImports(entry, { ...context, fromText, toText, map });
  const { merged, conflicts, failed } = mergeThreeWay(
    body,
    rewriteSpecifiers(fromText, map),
    rewriteSpecifiers(toText, new Map([...map, ...introduced.rewrites])),
    ["local", `upstream@${from}`, `upstream@${to}`],
  );
  if (failed) return { result: "skipped", reason: `merge refused: ${failed}` };
  const notes = [];
  if (!derivable) notes.push(`specifier map underivable (${counts[0]} local vs ${counts[1]})`);
  if (ambiguous?.length) notes.push(`ambiguous specifier ${ambiguous.join(", ")}`);
  notes.push(...introduced.notes);
  const next = (conflicts ? header : retargetHeader(header, entry.upstream, to)) + merged;
  if (next === localText) return { result: "unchanged", notes };
  if (!dryRun) writeFileSync(localPath, next);
  return { result: conflicts ? "conflict" : "clean", conflicts, notes };
}

// ------------------------------------------------------------ tree-level delta

/**
 * Roots to scan for added/removed upstream files. A package whose roots carry
 * no `upstream` prefix (channels-core gathers files from many upstream dirs)
 * falls back to the directories its own entries name.
 */
function scanRoots(manifest) {
  const declared = manifest.roots.map((root) => root.upstream).filter(Boolean);
  if (declared.length > 0) return declared;
  const dirs = manifest.files
    .map((entry) => entry.upstream)
    .filter(Boolean)
    .map((file) => path.posix.dirname(file));
  return [...new Set(dirs)].sort();
}

function isPortable(file) {
  return file.endsWith(".ts") && !TEST_FILE_RE.test(file);
}

function treeDelta(manifest, { upstreamDir, from, to, claimed }) {
  const added = new Set();
  const removed = new Set();
  for (const root of scanRoots(manifest)) {
    const before = new Set(gitListTree(upstreamDir, from, root));
    const after = new Set(gitListTree(upstreamDir, to, root));
    for (const file of after) if (!before.has(file) && isPortable(file)) added.add(file);
    for (const file of before) if (!after.has(file) && isPortable(file)) removed.add(file);
  }
  return {
    newUpstreamFiles: [...added].sort(),
    deletedUpstreamFiles: [...removed].sort().map((file) => ({ file, mapped: claimed.has(file) })),
  };
}

// ------------------------------------------------------------------- per package

function describe(entry) {
  return { local: entry.local, upstream: entry.upstream, status: entry.status };
}

function selectEntries(manifest, includeAdapted) {
  return manifest.files.filter(
    (entry) =>
      entry.upstream &&
      (entry.status === "verbatim" || (includeAdapted && entry.status === "adapted")),
  );
}

/** True when every candidate landed and no file we map vanished upstream. */
function isFullyClean(rows, deleted) {
  return (
    rows.every((row) => row.result === "clean" || row.result === "unchanged") &&
    deleted.every((row) => !row.mapped)
  );
}

function bumpBaseline(manifest, { to, upstreamDir }) {
  for (const entry of manifest.files) {
    if (entry.status !== "verbatim" || !entry.upstream) continue;
    const localPath = path.join(manifest.pkgDir, entry.local);
    if (!existsSync(localPath)) continue;
    const text = readFileSync(localPath, "utf8");
    const header = text.match(HEADER_RE)?.[0];
    if (!header || header === retargetHeader(header, entry.upstream, to)) continue;
    if (gitShow(upstreamDir, to, entry.upstream) === null) continue;
    writeFileSync(
      localPath,
      retargetHeader(header, entry.upstream, to) + text.slice(header.length),
    );
  }
  manifest.raw.baselineCommit = to;
  writeFileSync(manifest.manifestPath, `${JSON.stringify(manifest.raw, null, 2)}\n`);
}

export function applyManifest(
  manifestPath,
  { upstreamDir, from, to, dryRun = false, includeAdapted = false, forceBaseline = false },
) {
  const manifest = loadManifest(manifestPath);
  const claimed = new Set(manifest.files.map((entry) => entry.upstream).filter(Boolean));
  const byUpstream = new Map();
  for (const entry of manifest.files) {
    if (!entry.upstream) continue;
    byUpstream.set(entry.upstream, [...(byUpstream.get(entry.upstream) ?? []), entry]);
  }
  const packageMap = buildPackageSpecifierMap(manifest, { upstreamDir, from });
  const context = { manifest, upstreamDir, from, to, dryRun, claimed, byUpstream, packageMap };
  const rows = selectEntries(manifest, includeAdapted).map((entry) =>
    Object.assign(describe(entry), applyFile(entry, context)),
  );
  for (const entry of manifest.files) {
    if (entry.upstream && entry.status === "adapted" && !includeAdapted)
      rows.push({
        ...describe(entry),
        result: "skipped",
        reason: "adapted (use --include-adapted)",
      });
  }
  const tree = treeDelta(manifest, context);
  const fullyClean = isFullyClean(rows, tree.deletedUpstreamFiles);
  const baselineBumped = !dryRun && (fullyClean || forceBaseline);
  if (baselineBumped) bumpBaseline(manifest, context);
  return {
    pkg: manifest.pkgName,
    from,
    to,
    rows,
    ...tree,
    counts: countResults(rows),
    fullyClean,
    baselineBumped,
  };
}

export function countResults(rows) {
  const counts = { clean: 0, conflict: 0, unchanged: 0, skipped: 0 };
  for (const row of rows) counts[row.result] += 1;
  return counts;
}

// ---------------------------------------------------------------------- output

const LIST_CAP = 20;

function printCapped(label, items) {
  for (const item of items.slice(0, LIST_CAP))
    process.stdout.write(`  ${label.padEnd(8)} ${item}\n`);
  if (items.length > LIST_CAP)
    process.stdout.write(`  ${label.padEnd(8)} … ${items.length - LIST_CAP} more\n`);
}

function printApply(result, { dryRun }) {
  const { counts } = result;
  process.stdout.write(`\n## ${result.pkg} — ${result.from} → ${result.to}\n\n`);
  for (const row of result.rows) {
    if (row.result === "unchanged" && !row.notes?.length) continue;
    const detail = row.reason ?? row.conflicts;
    const notes = row.notes?.length ? ` — ${row.notes.join("; ")}` : "";
    process.stdout.write(
      `  ${row.result.padEnd(9)} ${row.local}${detail ? ` (${detail})` : ""}${notes}\n`,
    );
  }
  process.stdout.write(
    `\nclean=${counts.clean} conflict=${counts.conflict} unchanged=${counts.unchanged} skipped=${counts.skipped}` +
      ` new=${result.newUpstreamFiles.length} deleted=${result.deletedUpstreamFiles.length}\n`,
  );
  // A package that cherry-picks files out of shared upstream directories sees
  // every unrelated sibling here, so the untargeted lists are capped; the
  // `unported import` notes above are the targeted version of the same fact.
  printCapped("new", result.newUpstreamFiles);
  printCapped(
    "deleted",
    result.deletedUpstreamFiles.map((row) => `${row.file}${row.mapped ? " (mapped!)" : ""}`),
  );
  if (dryRun) process.stdout.write("dry run: nothing written\n");
  else if (result.baselineBumped) process.stdout.write(`baselineCommit → ${result.to}\n`);
}

export function runApply(manifests, options) {
  let conflicted = 0;
  for (const manifestPath of manifests) {
    const result = applyManifest(manifestPath, options);
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else printApply(result, options);
    if (result.counts.conflict > 0) conflicted += 1;
  }
  return conflicted === 0 ? 0 : 1;
}
