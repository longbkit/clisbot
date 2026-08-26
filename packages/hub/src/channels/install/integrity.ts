// Tarball integrity verification (plan §14.4 / §9 step 1): fetch a pinned tarball
// from the public npm registry and check its SHA-512 against `dist.integrity`
// before the bytes touch the install dir. The pin is the trust boundary — anything
// that does not hash to the pinned value is refused, not quarantined.
//
// npm's `dist.integrity` is `sha512-<base64>` (Subresource Integrity). We compare
// the freshly-computed digest against the pinned string, exactly.

import { createHash } from "node:crypto";

/** Compute an npm `sha512-…` integrity value for a buffer. */
export function sha512Integrity(data: Uint8Array): string {
  return `sha512-${createHash("sha512").update(data).digest("base64")}`;
}

/** True when `actual` matches the pinned `expected` integrity exactly. */
export function integrityMatches(expected: string, actual: string): boolean {
  return expected === actual;
}
