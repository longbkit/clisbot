// Fusion-owned boundary for `openclaw/plugin-sdk/ssrf-runtime` (D-FS-011).
//
// Upstream's `fetchWithSsrFGuard` sits on OpenClaw's pinned-dispatcher stack
// (`src/infra/net/fetch-guard.ts` + `src/infra/net/ssrf.ts` +
// `@openclaw/net-policy/ip`, ~2000 lines): it resolves the hostname once,
// pins the resolved address into an undici dispatcher, re-checks every
// redirect hop and leases the dispatcher back on `release()`. Fusion channel
// transports own their own fetch stack (the Discord vertical's D-DC-006 and
// the Telegram vertical's D-TG-013 make the same cut), so this module keeps
// the call contract — `{ url, init, auditContext, timeoutMs, policy, signal }`
// in, `{ response, release }` out — and the two guards the Feishu closure
// actually depends on:
//
//   * the hostname suffix allowlist (`policy.allowedHostnameSuffixes`), which
//     pins Lark traffic to `feishu.cn` / `larksuite.com`;
//   * a private/loopback/link-local address block on the resolved hostname, so
//     a redirected or DNS-rebound media URL cannot reach the Hub's own network.
//
// NOT carried, and deliberately named so no caller assumes it: per-hop redirect
// re-validation (redirects are refused outright instead), address pinning
// between the DNS check and the connect (a rebind race is possible), and the
// explicit-proxy / TLS-client-cert dispatcher policies — a `dispatcherPolicy`
// is accepted and ignored, which only costs the ported Feishu media reader its
// proxy support.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Upstream `src/infra/net/ssrf.ts`; the members the ported files pass. */
export type SsrFPolicy = {
  allowedHostnameSuffixes?: string[];
  allowPrivateNetwork?: boolean;
  [key: string]: unknown;
};

/** Upstream `src/plugin-sdk/ssrf-dispatcher.ts`; accepted and ignored here. */
export type PinnedDispatcherPolicy = {
  mode: "direct" | "explicit-proxy" | "env-proxy";
  [key: string]: unknown;
};

export class SsrFBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrFBlockedError";
  }
}

export interface GuardedFetchOptions {
  url: string;
  init?: RequestInit;
  auditContext: string;
  timeoutMs?: number;
  policy?: SsrFPolicy;
  dispatcherPolicy?: PinnedDispatcherPolicy;
  signal?: AbortSignal | null;
}

export interface GuardedFetchResult {
  response: Response;
  release: () => Promise<void>;
}

/** Builds the suffix-allowlist policy upstream's `ssrf-policy.ts` builds. */
export function buildHostnameAllowlistPolicyFromSuffixAllowlist(suffixes: string[]): SsrFPolicy {
  return {
    allowedHostnameSuffixes: suffixes
      .map((suffix) => suffix.trim().toLowerCase())
      .filter((suffix) => suffix.length > 0),
  };
}

function matchesAllowedSuffix(hostname: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

/** RFC1918 / loopback / link-local / unique-local / cloud-metadata literals. */
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

async function assertHostAllowed(url: URL, policy?: SsrFPolicy): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const suffixes = policy?.allowedHostnameSuffixes;
  if (suffixes !== undefined && suffixes.length > 0 && !matchesAllowedSuffix(hostname, suffixes)) {
    throw new SsrFBlockedError(`host ${hostname} is not in the allowed hostname suffix list`);
  }
  if (policy?.allowPrivateNetwork === true) return;
  if (isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) {
      throw new SsrFBlockedError(`host ${hostname} resolves to a blocked address`);
    }
    return;
  }
  const addresses = await lookup(hostname, { all: true });
  for (const entry of addresses) {
    if (isBlockedAddress(entry.address)) {
      throw new SsrFBlockedError(`host ${hostname} resolves to a blocked address`);
    }
  }
}

/**
 * Test seam: the fetch the guard calls once the host has passed. The ported
 * transport tests point a real `node:http` listener at `127.0.0.1`, which the
 * private-address block would otherwise refuse, so they install their own fetch
 * AND their own policy (`allowPrivateNetwork`).
 */
let guardedFetchImpl: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);

export function setGuardedFetchImplementation(next: typeof globalThis.fetch | undefined): void {
  guardedFetchImpl = next ?? ((input, init) => globalThis.fetch(input, init));
}

/** The upstream call contract; `release()` is a no-op without a pinned pool. */
export async function fetchWithSsrFGuard(
  params: GuardedFetchOptions,
): Promise<GuardedFetchResult> {
  const url = new URL(params.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SsrFBlockedError(`unsupported protocol ${url.protocol}`);
  }
  await assertHostAllowed(url, params.policy);
  const timeoutMs = params.timeoutMs;
  const controller = new AbortController();
  const timer =
    timeoutMs !== undefined && timeoutMs > 0
      ? setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs)
      : undefined;
  const caller = params.signal ?? params.init?.signal ?? undefined;
  const onCallerAbort = () => controller.abort(caller?.reason);
  caller?.addEventListener("abort", onCallerAbort, { once: true });
  if (caller?.aborted === true) onCallerAbort();
  try {
    const response = await guardedFetchImpl(url, {
      ...params.init,
      // A redirect is a second, unvalidated host. Upstream re-runs the guard per
      // hop; this boundary refuses instead so no hop is ever unchecked.
      redirect: "error",
      signal: controller.signal,
    });
    return {
      response,
      release: async () => {
        if (timer !== undefined) clearTimeout(timer);
        caller?.removeEventListener("abort", onCallerAbort);
      },
    };
  } catch (error) {
    if (timer !== undefined) clearTimeout(timer);
    caller?.removeEventListener("abort", onCallerAbort);
    throw error;
  }
}
