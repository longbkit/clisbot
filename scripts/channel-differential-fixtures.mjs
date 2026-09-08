#!/usr/bin/env node
// Regenerates the differential fixture corpora for the ported channel pure
// functions (formatting, chunking, mentions, targets, error classification).
//
//   node --import tsx scripts/channel-differential-fixtures.mjs generate --pkg slack
//   node --import tsx scripts/channel-differential-fixtures.mjs check
//
// Sibling of channel-upstream-sync.mjs on purpose: that script proves the
// ported SOURCE still matches upstream bytes, this one proves the ported
// BEHAVIOUR still matches what it produced at the recorded baseline.
//
// Limitation, stated in every corpus file: the recorded outputs come from the
// local functions, never from upstream. Executing upstream functions would mean
// building an OpenClaw checkout per commit, which is out of scope. So
// regeneration at a new upstream commit diffs local-then against local-now —
// it catches a port that changed behaviour, not a port that disagrees with
// upstream. Byte fidelity against upstream stays `npm run channels:sync:check`.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANNELS_DIR = path.join(REPO_ROOT, "packages", "channels");
const UPSTREAM_REPO = "openclaw-private";
const FIXTURE_BASENAME = "upstream-differential.json";
const CASES_BASENAME = "upstream-differential.cases.ts";

/** Every channel with a differential corpus, and the export holding its cases. */
export const DIFFERENTIAL_PACKAGES = [
  { pkg: "slack", casesExport: "slackDifferentialCases" },
  { pkg: "telegram", casesExport: "telegramDifferentialCases" },
  { pkg: "discord", casesExport: "discordDifferentialCases" },
];

export function fixtureDir(pkg) {
  return path.join(CHANNELS_DIR, pkg, "src", "__fixtures__");
}

export function fixturePath(pkg) {
  return path.join(fixtureDir(pkg), FIXTURE_BASENAME);
}

export function casesPath(pkg) {
  return path.join(fixtureDir(pkg), CASES_BASENAME);
}

/** The upstream commit the ported files sit at, read from the sync manifest. */
export function baselineCommit(pkg) {
  const manifestPath = path.join(CHANNELS_DIR, pkg, "upstream-sync.json");
  if (!existsSync(manifestPath)) throw new Error(`no upstream-sync.json for ${pkg}`);
  const commit = JSON.parse(readFileSync(manifestPath, "utf8")).baselineCommit;
  if (!commit) throw new Error(`${pkg}: upstream-sync.json has no baselineCommit`);
  return commit;
}

async function loadCases({ pkg, casesExport }) {
  const modulePath = casesPath(pkg);
  if (!existsSync(modulePath)) throw new Error(`${pkg}: missing ${modulePath}`);
  const module = await import(pathToFileURL(modulePath).href);
  const cases = module[casesExport];
  if (!Array.isArray(cases)) throw new Error(`${pkg}: ${casesExport} is not an array`);
  return cases;
}

async function buildCorpus(entry, upstreamCommit) {
  const { buildDifferentialCorpus } = await import(
    pathToFileURL(path.join(CHANNELS_DIR, "shared", "src", "upstream-differential.ts")).href
  );
  return buildDifferentialCorpus({
    channel: entry.pkg,
    upstreamRepo: UPSTREAM_REPO,
    upstreamCommit,
    cases: await loadCases(entry),
  });
}

function serialize(corpus) {
  return `${JSON.stringify(corpus, null, 2)}\n`;
}

async function runGenerate(entries, { to, check }) {
  let changed = 0;
  for (const entry of entries) {
    const upstreamCommit = to ?? baselineCommit(entry.pkg);
    const corpus = await buildCorpus(entry, upstreamCommit);
    const target = fixturePath(entry.pkg);
    const next = serialize(corpus);
    const previous = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (previous === next) {
      process.stdout.write(`${entry.pkg}: ${corpus.cases.length} cases, unchanged\n`);
      continue;
    }
    changed += 1;
    if (check) {
      process.stdout.write(
        `${entry.pkg}: FAIL corpus is stale — ${summarizeDrift(previous, next)}\n`,
      );
      continue;
    }
    writeFileSync(target, next);
    process.stdout.write(
      `${entry.pkg}: wrote ${path.relative(REPO_ROOT, target)} (${corpus.cases.length} cases @ ${upstreamCommit})` +
        `${previous === null ? " [new]" : ` — ${summarizeDrift(previous, next)}`}\n`,
    );
  }
  return check && changed > 0 ? 1 : 0;
}

/** Names the drifted case ids rather than dumping a whole-file diff. */
function summarizeDrift(previousText, nextText) {
  if (previousText === null) return "new corpus";
  const previous = new Map(
    (JSON.parse(previousText).cases ?? []).map((entry) => [entry.id, JSON.stringify(entry.output)]),
  );
  const next = new Map(
    (JSON.parse(nextText).cases ?? []).map((entry) => [entry.id, JSON.stringify(entry.output)]),
  );
  const added = [...next.keys()].filter((id) => !previous.has(id));
  const removed = [...previous.keys()].filter((id) => !next.has(id));
  const drifted = [...next.keys()].filter(
    (id) => previous.has(id) && previous.get(id) !== next.get(id),
  );
  const parts = [];
  if (drifted.length > 0)
    parts.push(`${drifted.length} output(s) changed: ${drifted.slice(0, 5).join(", ")}`);
  if (added.length > 0) parts.push(`${added.length} added: ${added.slice(0, 5).join(", ")}`);
  if (removed.length > 0)
    parts.push(`${removed.length} removed: ${removed.slice(0, 5).join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : "metadata changed";
}

function parseArgs(argv) {
  const options = { command: argv[0] ?? "generate", pkg: null, to: null };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pkg") options.pkg = argv[++index];
    else if (arg === "--to") options.to = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const entries = DIFFERENTIAL_PACKAGES.filter(
    (entry) => !options.pkg || entry.pkg === options.pkg,
  );
  if (entries.length === 0) throw new Error(`no differential corpus for package "${options.pkg}"`);
  if (options.command === "generate") return runGenerate(entries, { to: options.to, check: false });
  if (options.command === "check") return runGenerate(entries, { to: options.to, check: true });
  throw new Error(
    "usage: node --import tsx scripts/channel-differential-fixtures.mjs <generate|check> " +
      "[--pkg <slack|telegram|discord>] [--to <upstream commit>]",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 2;
    },
  );
}
