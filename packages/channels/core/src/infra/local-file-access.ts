// Fusion-owned replacement for `src/infra/local-file-access.ts` (D-CORE-059).
//
// Upstream reads local media through `@openclaw/fs-safe/advanced` with OpenClaw's
// rooted-filesystem defaults installed as an import side effect. Fusion's Hub
// checks containment before a path reaches this layer, so the two pure helpers the
// ported code uses are implemented over `node:path`/`node:url`.
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Converts a `file:` URL to a path, throwing on a malformed URL as upstream does. */
export function safeFileURLToPath(source: string): string {
  return fileURLToPath(source.trim());
}

/** Converts a `file:` URL to a path; returns undefined for anything else. */
export function trySafeFileURLToPath(source: string): string | undefined {
  if (!/^file:/i.test(source.trim())) {
    return undefined;
  }
  try {
    return fileURLToPath(source.trim());
  } catch {
    return undefined;
  }
}

/** Base name of a media source given as a path or a `file:` URL. */
export function basenameFromMediaSource(source: string): string | undefined {
  const filePath = trySafeFileURLToPath(source) ?? source;
  const base = path.basename(filePath.split(/[?#]/, 1)[0] ?? filePath).trim();
  return base === "" ? undefined : base;
}
