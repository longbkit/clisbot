// upstream: src/plugin-sdk/json-store.ts@5d8067a4483
// JSON store helpers provide small atomic persistence primitives for plugin runtime state.
//
// D-CORE-218: upstream reads and writes through OpenClaw's fs-safe package
// (root policy, owned temp files, atomic replace, restrictive permissions).
// Fusion channel stores persist through the Hub, so the readers keep upstream's
// signatures over plain `node:fs` and the atomic writers are not carried.
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Read small JSON blobs synchronously for token/state caches. */
export function loadJsonFile<T = unknown>(filePath: string): T | undefined {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Read JSON from disk and fall back cleanly when the file is missing or invalid. */
export async function readJsonFileWithFallback<T>(
  filePath: string,
  fallback: T,
): Promise<{ value: T; exists: boolean }> {
  let parsed: T | undefined;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    parsed = undefined;
  }
  if (parsed != null) {
    return { value: parsed, exists: true };
  }
  return { value: fallback, exists: await pathExists(filePath) };
}
