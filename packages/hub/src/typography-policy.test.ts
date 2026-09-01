import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const sourceExtensions = new Set([".css", ".ts", ".tsx"]);
const weightClass =
  /font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|[1-9]00|\[[^\]]+\])/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!sourceExtensions.has(extname(entry.name)) || entry.name.includes(".test.")) return [];
    return [path];
  });
}

function isPageTitleWeight(source: string, index: number, weight: string): boolean {
  if (weight !== "font-medium") return false;
  const openingHeading = source.lastIndexOf("<h1", index);
  const openingTagEnd = source.lastIndexOf(">", index);
  return openingHeading > openingTagEnd;
}

function hasDisallowedCssWeight(source: string): boolean {
  const declarations = source.matchAll(/\bfont-weight\s*:\s*([^;]+)/gi);
  for (const declaration of declarations) {
    const value = (declaration[1] ?? "").replace(/\s*!important\s*$/, "").trim();
    if (value === "400") continue;
    const selector = source.slice(
      source.lastIndexOf("}", declaration.index) + 1,
      declaration.index,
    );
    if (value === "500" && selector.includes("h1")) continue;
    return true;
  }
  return false;
}

describe("typography policy", () => {
  it("uses medium weight only for page titles", () => {
    const violations: string[] = [];

    for (const path of sourceFiles(sourceRoot)) {
      const source = readFileSync(path, "utf8");
      const name = relative(sourceRoot, path);

      for (const match of source.matchAll(weightClass)) {
        if (!isPageTitleWeight(source, match.index, match[0])) {
          violations.push(`${name}: ${match[0]}`);
        }
      }

      if (/\bfontWeight\b|<(?:strong|b)\b/i.test(source) || hasDisallowedCssWeight(source)) {
        violations.push(`${name}: non-class font weight`);
      }
    }

    assert.deepEqual(violations, []);
  });
});
