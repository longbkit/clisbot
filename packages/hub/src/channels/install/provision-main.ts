// Main-package dependency provisioning. The pinned `openclaw` main tarball ships
// no `node_modules` — it ships declared `dependencies` + a fully-resolved
// `npm-shrinkwrap.json` (lockfile packages, each with a `resolved` URL +
// `sha512` integrity). But the main dist chunks bare-import their deps (e.g.
// `typebox` from `dist/schema-validator-*.js`), and both channel entries load
// main-dist chunks, so the main dir needs its dependency tree to load at all.
//
// `npm ci` is the obvious tool, but arborist crashes on this lockfile's peer-set
// shape on npm 10.9.x (`Cannot read properties of null (reading 'edgesOut')`,
// reproduced with `ci`, `install`, and `--omit=dev`), so the install plane
// provisions the tree itself, the way it already handles the pinned tarballs:
// read the shrinkwrap out of the extracted main dir, compute the production
// closure, fetch each entry's tarball through the injectable `fetch` seam,
// verify the bytes against the lockfile-recorded integrity BEFORE extraction
// (the shrinkwrap is inside the integrity-pinned main tarball, so its records
// are inside the pin's trust boundary), and extract into
// `mainDir/node_modules/…` with the traversal-safe extractor. No build scripts
// are run; module resolution is all the loader needs.
//
// A main tarball that already ships its own `node_modules` (the shape the
// `@openclaw/slack` tarball has) needs no provisioning; the orchestrator only
// calls this when `npm-shrinkwrap.json` is present in the extracted main dir.
//
// Idempotence comes from the shrinkwrap and the installed package tree. The
// caller already ties `mainDir` to the integrity in the managed root lockfile,
// so a complete production closure needs no second custom lock file.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha512Integrity } from "./integrity.js";
import type { MainPin } from "./pins.js";
import { extractNpmTarball } from "./tarball.js";

/** The install-plane domain error for provisioning failures (same shape as
 * `InstallError`; a separate class so a failed dependency fetch is not
 * misread as a failed pin). */
export class ProvisionError extends Error {
  readonly channel?: string;
  constructor(message: string, options?: { channel?: string }) {
    super(message);
    this.name = "ProvisionError";
    if (options?.channel !== undefined) this.channel = options.channel;
  }
}

/** One `npm-shrinkwrap.json` `packages` entry (only the fields the
 * provisioner trusts). */
interface ShrinkwrapEntry {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  resolved?: string;
  integrity?: string;
}

export interface ProvisionResult {
  /** True when this call fetched + extracted the tree; false when a matching
   * shrinkwrap-backed dependency tree made it a no-op. */
  provisioned: boolean;
  /** Lockfile entries in the production closure. */
  entries: number;
}

/**
 * The lockfile keys of the production closure reachable from the root's
 * `dependencies` + `optionalDependencies`. Resolution mirrors npm's flat
 * layout: a dep named by the package at `node_modules/a/node_modules/b` lives
 * at the deepest `node_modules/<dep>` key at or under that path, else at the
 * nearest `node_modules` ancestor. Dev-only packages never enter the closure
 * because only the runtime sections are followed.
 */
export function prodClosure(shrinkwrap: { packages: Record<string, ShrinkwrapEntry> }): string[] {
  const keys = new Set(Object.keys(shrinkwrap.packages));
  const root = shrinkwrap.packages[""];
  if (root === undefined) {
    throw new ProvisionError("npm-shrinkwrap.json has no root package entry");
  }
  const resolveFrom = (key: string, name: string): string => {
    for (let cursor = key; ; ) {
      const candidate = `${cursor}/node_modules/${name}`;
      if (keys.has(candidate)) return candidate;
      const idx = cursor.lastIndexOf("/node_modules/");
      if (idx < 0) return `node_modules/${name}`;
      cursor = cursor.slice(0, idx);
    }
  };
  const seed = [
    ...Object.keys(root.dependencies ?? {}),
    ...Object.keys(root.optionalDependencies ?? {}),
  ].map((name) => `node_modules/${name}`);
  const seen = new Set<string>();
  const queue = seed.filter((key) => keys.has(key));
  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    const entry = shrinkwrap.packages[key];
    if (entry === undefined) continue;
    const deps = [
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}),
    ];
    for (const name of deps) queue.push(resolveFrom(key, name));
  }
  return [...seen].sort();
}

/** True when every package in the shrinkwrap's production closure exists. */
export function isProvisioned(mainDir: string, _mainPin: MainPin): boolean {
  try {
    const shrinkwrap = readShrinkwrap(mainDir);
    return prodClosure(shrinkwrap).every((key) => existsSync(join(mainDir, key, "package.json")));
  } catch {
    return false;
  }
}

/** Read + validate the main dir's `npm-shrinkwrap.json`. */
function readShrinkwrap(mainDir: string): { packages: Record<string, ShrinkwrapEntry> } {
  try {
    return JSON.parse(readFileSync(join(mainDir, "npm-shrinkwrap.json"), "utf8")) as {
      packages: Record<string, ShrinkwrapEntry>;
    };
  } catch (error) {
    throw new ProvisionError(
      `cannot read npm-shrinkwrap.json from ${mainDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Fetch + verify + extract every production-closure entry into
 * `mainDir/node_modules/…`. A lockfile key
 * IS the node_modules-relative target path (`node_modules/typebox` extracts to
 * `<mainDir>/node_modules/typebox`). Refuses when any entry's bytes do not
 * match the lockfile-recorded integrity; the
 * tree is rebuilt from scratch on the next call.
 */
export async function provisionMainDependencies(
  mainDir: string,
  mainPin: MainPin,
  fetchImpl: typeof fetch,
  channel: string,
): Promise<ProvisionResult> {
  if (isProvisioned(mainDir, mainPin)) {
    return { provisioned: false, entries: 0 };
  }
  const shrinkwrap = readShrinkwrap(mainDir);
  const entries = prodClosure(shrinkwrap);
  await fetchAndExtractEntries(mainDir, shrinkwrap, entries, fetchImpl, channel);
  return { provisioned: true, entries: entries.length };
}

/** Fetch + integrity-verify + extract all closure entries (bounded
 * concurrency; the first failure rejects the batch before the marker is
 * written). */
async function fetchAndExtractEntries(
  mainDir: string,
  shrinkwrap: { packages: Record<string, ShrinkwrapEntry> },
  entries: string[],
  fetchImpl: typeof fetch,
  channel: string,
): Promise<void> {
  const CONCURRENCY = 8;
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= entries.length) return;
      await fetchAndExtractEntry(mainDir, shrinkwrap, entries[index]!, fetchImpl, channel);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker()));
}

async function fetchAndExtractEntry(
  mainDir: string,
  shrinkwrap: { packages: Record<string, ShrinkwrapEntry> },
  key: string,
  fetchImpl: typeof fetch,
  channel: string,
): Promise<void> {
  const entry = shrinkwrap.packages[key];
  if (entry?.resolved === undefined || entry.integrity === undefined) {
    throw new ProvisionError(`npm-shrinkwrap.json entry ${key} is missing resolved/integrity`, {
      channel,
    });
  }
  const response = await fetchImpl(entry.resolved);
  if (!response.ok) {
    throw new ProvisionError(`dependency fetch failed for ${key}: ${response.status}`, { channel });
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  const actual = sha512Integrity(buffer);
  if (actual !== entry.integrity) {
    throw new ProvisionError(
      `integrity mismatch for dependency ${key}: expected ${entry.integrity}, got ${actual}`,
      { channel },
    );
  }
  // The extractor confines every path to the target and refuses traversal.
  extractNpmTarball(buffer, join(mainDir, key));
}

/** True when the shrinkwrap-backed production dependency tree is complete. */
export function provisionTreePresent(mainDir: string): boolean {
  try {
    const shrinkwrap = readShrinkwrap(mainDir);
    return prodClosure(shrinkwrap).every((key) => existsSync(join(mainDir, key, "package.json")));
  } catch {
    return false;
  }
}
