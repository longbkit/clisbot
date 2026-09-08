// Fusion-owned network boundary for the ported Slack client and upload path
// (D-030). It stands in for four OpenClaw SDK subpaths the vertical must not
// import: `fetch-runtime`, `ssrf-runtime`, `proxy-capture` and the guarded-fetch
// half of `infra/net/*`.
//
// Upstream wires Slack's `WebClient` fetch and its external-upload POST through
// OpenClaw's net stack: a pinned-DNS dispatcher pool, the SSRF guard with
// per-request policies, the managed-proxy TLS injector, the debug proxy capture
// patch and the global undici dispatcher (~11k lines under `src/infra/net/`).
// Fusion channel transports own their own fetch stack, the same call the
// Telegram vertical made (D-TG-013).
//
// What is kept: upstream's call shape, its option records and its release
// contract, so `client-options.ts` and `client-delivery.ts` stay verbatim. Env
// proxy options are read with upstream's precedence
// (`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` plus the lowercase spellings).
//
// What is dropped, and why it is safe here: DNS pinning and the private-network
// SSRF policy. Both Slack call sites address Slack-owned hosts only — the Web
// API base URL, and an upload URL minted by `files.getUploadURLExternal` whose
// host `client-delivery.ts` already constrains with its own
// `resolveSlackUploadTransportPolicy` allowlist before calling here. The
// `policy` and `requireHttps` fields are still honoured: an upload URL that is
// not HTTPS, or whose host the caller did not allow, is refused. Rebinding
// protection for user-supplied URLs is not in scope for this vertical; it lands
// with the host media/SSRF slice.
//
// What is NOT dropped, because dropping it would void the host allowlist above:
// a redirect is a SECOND host the allowlist never saw, so redirects are refused
// outright (`redirect: "error"`), matching the Google Chat, Feishu and Zalo
// boundaries. Upstream re-runs its guard per hop instead; both answers refuse
// an unchecked hop, and neither Slack call site redirects in practice.
// `timeoutMs` is enforced here too — upstream's guard owns the deadline, and an
// accepted-but-ignored timeout is a hang with no ceiling.

import type { EnvHttpProxyAgentProxyOptions } from "./fetch.types.js";

/** Upstream's per-request SSRF policy record, narrowed to the fields Slack sets.
 *
 * `hostnameAllowlist` and `allowedOrigins` are upstream's OWN field names, and
 * they are the ones every Slack call site fills (`client-delivery.ts`'s upload
 * policies, `monitor/media.ts`'s file-host list). This boundary used to read a
 * `allowedHosts` field that nothing anywhere sets, so the allowlist branch was
 * unreachable and the guard enforced only `requireHttps` — the upload POST
 * would have carried the file to whatever host `files.getUploadURLExternal`
 * named. `allowedHosts` is kept as an alias so no caller has to change. */
export type SsrFPolicy = {
  /** Hostnames the request may address. `*.example.com` matches the domain and
   * its subdomains (upstream's spelling, used by `monitor/media.ts`). */
  hostnameAllowlist?: readonly string[];
  /** Origins the request may address, compared exactly. */
  allowedOrigins?: readonly string[];
  /** Alias of `hostnameAllowlist`. */
  allowedHosts?: readonly string[];
  /** Allow private/loopback destinations (Slack never sets this). */
  allowPrivateNetwork?: boolean;
  [key: string]: unknown;
};

/** `example.com` matches exactly; `*.example.com` matches it and any
 * subdomain. */
function hostMatchesAllowlistEntry(host: string, entry: string): boolean {
  const candidate = entry.trim().toLowerCase();
  if (candidate.startsWith("*.")) {
    const domain = candidate.slice(2);
    return host === domain || host.endsWith(`.${domain}`);
  }
  return host === candidate;
}

type GuardedFetchOptions = {
  url: string;
  init?: RequestInit;
  timeoutMs?: number;
  signal?: AbortSignal;
  requireHttps?: boolean;
  policy?: SsrFPolicy;
  capture?: boolean;
  auditContext?: string;
  mode?: string;
  [key: string]: unknown;
};

/** Upstream's guarded-fetch mode preset. The mode is carried, not interpreted. */
export function withTrustedEnvProxyGuardedFetchMode(
  params: GuardedFetchOptions,
): GuardedFetchOptions {
  return { ...params, mode: "trusted-env-proxy" };
}

function readProxyEnv(...names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Build explicit options for undici's EnvHttpProxyAgent.
 *
 * EnvHttpProxyAgent does not read ALL_PROXY itself, but it accepts explicit
 * HTTP/HTTPS proxy overrides.
 */
export function resolveEnvHttpProxyAgentOptions(): EnvHttpProxyAgentProxyOptions | undefined {
  const allProxy = readProxyEnv("ALL_PROXY", "all_proxy");
  const httpProxy = readProxyEnv("HTTP_PROXY", "http_proxy") ?? allProxy;
  const httpsProxy = readProxyEnv("HTTPS_PROXY", "https_proxy") ?? httpProxy;
  const options: EnvHttpProxyAgentProxyOptions = {
    ...(httpProxy ? { httpProxy } : {}),
    ...(httpsProxy ? { httpsProxy } : {}),
  };
  return options.httpProxy || options.httpsProxy ? options : undefined;
}

/**
 * Adds managed-proxy TLS options to env proxy agent options. Fusion has no
 * managed proxy, so the options pass through unchanged; the signature is
 * upstream's so the call site stays verbatim.
 */
export function addActiveManagedProxyTlsOptions<TOptions extends object>(
  options: TOptions,
): TOptions;
export function addActiveManagedProxyTlsOptions(options: undefined): undefined;
export function addActiveManagedProxyTlsOptions<TOptions extends object>(
  options: TOptions | undefined,
): TOptions | undefined {
  return options;
}

/** Resolves an optional fetch implementation. Upstream also wraps it so a caller
 * abort propagates into the response body stream; the Slack Web API reads the
 * whole body before returning, so the plain implementation is used here. */
export function resolveFetch(fetchImpl?: typeof fetch): typeof fetch | undefined {
  return fetchImpl ?? globalThis.fetch;
}

/** Upstream reports whether the debug proxy patched global fetch. Fusion has no
 * debug proxy capture, so the vertical always installs its own dispatcher. */
export function isDebugProxyGlobalFetchPatchInstalled(): boolean {
  return false;
}

function assertGuardedUrlAllowed(options: GuardedFetchOptions): URL {
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new Error(`Blocked request: ${options.auditContext ?? "fetch"} URL is not absolute`);
  }
  if (options.requireHttps !== false && parsed.protocol !== "https:") {
    throw new Error(
      `Blocked request: ${options.auditContext ?? "fetch"} requires https, got ${parsed.protocol}`,
    );
  }
  const allowedHosts = options.policy?.hostnameAllowlist ?? options.policy?.allowedHosts;
  if (allowedHosts && allowedHosts.length > 0) {
    const host = parsed.hostname.toLowerCase();
    if (!allowedHosts.some((entry) => hostMatchesAllowlistEntry(host, entry))) {
      throw new Error(
        `Blocked request: ${options.auditContext ?? "fetch"} host ${host} is not allowed`,
      );
    }
  }
  const allowedOrigins = options.policy?.allowedOrigins;
  if (allowedOrigins && allowedOrigins.length > 0) {
    const origin = parsed.origin.toLowerCase();
    if (!allowedOrigins.some((entry) => entry.trim().toLowerCase() === origin)) {
      throw new Error(
        `Blocked request: ${options.auditContext ?? "fetch"} origin ${origin} is not allowed`,
      );
    }
  }
  return parsed;
}

/**
 * Guarded fetch. Enforces the caller's https requirement and host allowlist,
 * then performs the request. `release()` is upstream's contract: the caller
 * calls it once it is done with the response so the connection is not retained.
 */
export async function fetchWithSsrFGuard(
  options: GuardedFetchOptions,
): Promise<{ response: Response; release: () => Promise<void> }> {
  assertGuardedUrlAllowed(options);
  const timeoutMs = options.timeoutMs;
  const timeout =
    typeof timeoutMs === "number" && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  const caller = options.signal ?? options.init?.signal ?? undefined;
  const signal =
    timeout === undefined
      ? caller
      : caller === undefined
        ? timeout
        : AbortSignal.any([caller, timeout]);
  const response = await fetch(options.url, {
    ...options.init,
    // The allowlist above checked ONE host. A redirect is a second host it
    // never saw, so no hop is ever followed unchecked.
    redirect: "error",
    ...(signal ? { signal } : {}),
  });
  return {
    response,
    release: async () => {
      await response.body?.cancel().catch(() => undefined);
    },
  };
}
