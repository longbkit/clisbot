import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// HISTORICAL: exercise upstream's old behavior using Clisbot wire names. This
// changes only isolated npm fixtures, never production clients or daemons.
function clisbotNames(value: string): string {
  return value
    .replaceAll("PASEO", "CLISBOT")
    .replaceAll("Paseo", "Clisbot")
    .replace(/(?<!get)paseo/g, "clisbot");
}

export async function normalizeHistoricalUpstreamFixture(root: string): Promise<void> {
  const scope = path.join(root, "node_modules", "@getpaseo");
  async function normalize(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      // Third-party dependencies and native binaries retain their published identities.
      if (entry.name === "node_modules" || entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await normalize(file);
      else if (/\.(?:[cm]?js|json)$/.test(entry.name)) {
        const original = await readFile(file, "utf8");
        const normalized = clisbotNames(original);
        if (normalized !== original) await writeFile(file, normalized);
      }
      const name = clisbotNames(entry.name);
      if (name !== entry.name) await rename(file, path.join(directory, name));
    }
  }
  // Keep @getpaseo package imports resolvable; only their product/wire names change.
  for (const entry of await readdir(scope, { withFileTypes: true })) {
    if (entry.isDirectory()) await normalize(path.join(scope, entry.name));
  }
}
