// Fusion-owned replacement for `src/infra/path-guards.ts` (D-CORE-059).
//
// Upstream implements containment on top of `@openclaw/fs-safe/path`, which also
// installs OpenClaw's rooted-filesystem defaults as a side effect. Fusion does not
// adopt that filesystem layer, so the one predicate the ported media path uses is
// implemented directly over `node:path` with the same semantics: a path is inside
// a root when it is the root or sits under it after resolution.
import path from "node:path";

/** True when `target` is `parent` itself or a descendant of it. */
export function isPathInside(parent: string, target: string): boolean {
  const base = path.resolve(parent);
  const candidate = path.resolve(target);
  return candidate === base || candidate.startsWith(`${base}${path.sep}`);
}
