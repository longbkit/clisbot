#!/usr/bin/env node
// Word budget for public-docs/ pages. A page may grow at most 10% over its
// recorded baseline; see docs/public-docs.md.
//   node scripts/public-docs/word-budget.mjs          report every page
//   node scripts/public-docs/word-budget.mjs --check  exit 1 when a page is over budget
//   node scripts/public-docs/word-budget.mjs --baseline  print counts as baseline JSON
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docsDir = path.join(root, "public-docs");
const baselinePath = path.join(root, "scripts/public-docs/word-baseline.json");
const GROWTH = 1.1;

/** Body words: no frontmatter, no table separator rows, table pipes are not words. */
export function countWords(markdown) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  return body
    .split("\n")
    .filter((line) => !/^\s*\|[\s:|-]+\|\s*$/.test(line))
    .join("\n")
    .replaceAll("|", " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function pages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pages(full);
    return entry.name.endsWith(".md") ? [path.relative(docsDir, full)] : [];
  });
}

const counts = Object.fromEntries(
  pages(docsDir)
    .sort()
    .map((page) => [page, countWords(readFileSync(path.join(docsDir, page), "utf8"))]),
);

if (process.argv.includes("--baseline")) {
  process.stdout.write(`${JSON.stringify(counts, null, 2)}\n`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
let over = 0;
for (const [page, words] of Object.entries(counts)) {
  const base = baseline[page];
  const budget = base === undefined ? undefined : Math.floor(base * GROWTH);
  let status = "ok";
  if (budget === undefined) status = "no baseline";
  else if (words > budget) status = "OVER";
  if (status === "OVER") over += 1;
  if (status !== "ok" || !process.argv.includes("--check"))
    console.log(`${status.padEnd(11)} ${String(words).padStart(5)} / ${budget ?? "-"}  ${page}`);
}
if (process.argv.includes("--check") && over > 0) process.exit(1);
