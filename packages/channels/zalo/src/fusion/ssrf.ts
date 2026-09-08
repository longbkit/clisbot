// Fusion-owned boundary for `openclaw/plugin-sdk/ssrf-runtime` (D-ZL-006).
//
// The ported `api.ts` calls `resolvePinnedHostnameWithPolicy` on ONE path: the
// `sendPhoto` media URL, which Zalo's servers fetch on our behalf. Upstream's
// implementation (`src/infra/net/ssrf.ts`, ~700 lines) resolves the hostname,
// re-checks every DNS answer against the private-network policy and returns a
// pinned `lookup` an undici dispatcher can be built from. Fusion channel
// transports own their own fetch stack (Discord D-DC-006, Telegram D-TG-013,
// Google Chat D-GC-005), and this call site never builds a dispatcher from the
// result — it only needs the throw. So the boundary keeps the call contract and
// the check that matters: a hostname whose DNS answers include a private,
// loopback, link-local, CGNAT or cloud-metadata address is refused.
//
// NOT carried, and named so no caller assumes it: address pinning between the
// DNS check and the connect (a rebind race is possible — but note Zalo, not
// this process, performs the fetch), the trusted-hostname exemptions, and the
// dispatcher/proxy policies.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Upstream `src/infra/net/ssrf.ts`; the members the ported files pass. */
export type SsrFPolicy = {
  allowedHostnameSuffixes?: string[];
  allowPrivateNetwork?: boolean;
  [key: string]: unknown;
};

/** Upstream's return shape, minus the pinned `lookup` nothing here builds. */
export type PinnedHostname = {
  hostname: string;
  addresses: string[];
};

/** RFC1918 / loopback / link-local / unique-local / CGNAT / metadata literals. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map((part) => Number.parseInt(part, 10));
    const [a = 0, b = 0] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fe80") || normalized.startsWith("fc") || normalized.startsWith("fd"))
      return true;
    // IPv4-mapped (`::ffff:10.0.0.1`) reaches the same networks.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    return mapped?.[1] !== undefined && isBlockedAddress(mapped[1]);
  }
  return false;
}

function matchesAllowedSuffix(hostname: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

/** Test seam: the resolver the guard asks. Defaults to `node:dns`. */
let lookupImpl: typeof lookup = lookup;

export function setSsrfLookupImplementation(next: typeof lookup | undefined): void {
  lookupImpl = next ?? lookup;
}

/** Upstream's call contract; throws when the host is not allowed. */
export async function resolvePinnedHostnameWithPolicy(
  hostname: string,
  params: { policy?: SsrFPolicy } = {},
): Promise<PinnedHostname> {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const suffixes = params.policy?.allowedHostnameSuffixes;
  if (suffixes !== undefined && suffixes.length > 0 && !matchesAllowedSuffix(normalized, suffixes)) {
    throw new Error(`Blocked hostname: ${hostname}`);
  }
  const allowPrivate = params.policy?.allowPrivateNetwork === true;
  if (isIP(normalized) !== 0) {
    if (!allowPrivate && isBlockedAddress(normalized)) {
      throw new Error(`Blocked hostname: ${hostname}`);
    }
    return { hostname: normalized, addresses: [normalized] };
  }
  const results = await lookupImpl(normalized, { all: true });
  if (results.length === 0) {
    throw new Error(`Unable to resolve hostname: ${hostname}`);
  }
  if (!allowPrivate) {
    for (const entry of results) {
      if (isBlockedAddress(entry.address)) {
        throw new Error(`Blocked hostname: ${hostname}`);
      }
    }
  }
  return { hostname: normalized, addresses: results.map((entry) => entry.address) };
}
