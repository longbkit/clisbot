import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import { en } from "./resources/en";

// `t()` keys are plain strings, so a mistyped Hub key renders as the key itself. Every
// literal `hub.…` key in app source must exist in the English resources.
const appSourceRoot = join(__dirname, "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "i18n" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

function resolves(key: string): boolean {
  let value: unknown = en;
  for (const part of key.split(".")) {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    // i18next plural lookups name the base key; the resource holds `_one` / `_other`.
    value = part in record ? record[part] : record[`${part}_other`];
  }
  return typeof value === "string";
}

it("resolves every literal hub.*, connectors.*, bots.* and heartbeats.* translation key used in source", () => {
  const missing = sourceFiles(appSourceRoot).flatMap((path) =>
    [
      ...readFileSync(path, "utf8").matchAll(
        /\bt\(\s*["']((?:hub|connectors|bots|heartbeats)\.[\w.]+)["']/g,
      ),
    ]
      .map((match) => match[1]!)
      .filter((key) => !resolves(key))
      .map((key) => `${relative(appSourceRoot, path)}: ${key}`),
  );
  expect(missing).toEqual([]);
});
