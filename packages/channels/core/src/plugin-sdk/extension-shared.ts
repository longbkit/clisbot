// Fusion-owned boundary for `src/plugin-sdk/extension-shared.ts` (D-CORE-245).
//
// Upstream's barrel also carries the passive channel lifecycle runner, the
// logger-backed runtime factory, ambient proxy agents and zod parse helpers —
// host lifecycle surfaces the port stops at (D-CORE-010). The ported Slack
// upload path reads only the fetch timeout signal builder.
export { buildTimeoutAbortSignal } from "../utils/fetch-timeout.js";

// Slice 10b addition (Slack action tests): upstream's barrel builds its
// `createDeferred` from `src/shared/deferred.ts` `createDeferredCore`; the
// source module is carried and re-exported under the barrel's name.
export { createDeferredCore as createDeferred, type Deferred } from "../shared/deferred.js";

// Slice 15 additions (Feishu vertical port). `readPluginPackageVersion` is
// upstream's, body and candidate list unchanged: the ported Feishu client
// stamps its User-Agent with it.
const DEFAULT_PACKAGE_JSON_VERSION_CANDIDATES = [
  "../package.json",
  "./package.json",
  "../../package.json",
] as const;

type PackageJsonRequire = (id: string) => unknown;

/** Reads plugin package versions across source, bundled, and test layouts with a fallback. */
export function readPluginPackageVersion(params: {
  require: PackageJsonRequire;
  candidates?: readonly string[];
  fallback?: string;
}): string {
  for (const candidate of params.candidates ?? DEFAULT_PACKAGE_JSON_VERSION_CANDIDATES) {
    try {
      const version = (params.require(candidate) as { version?: unknown }).version;
      if (typeof version === "string" && version.trim().length > 0) {
        return version;
      }
    } catch {
      // Ignore missing candidate paths across source and bundled layouts.
    }
  }
  return params.fallback ?? "unknown";
}

/**
 * D-CORE-342: upstream builds this agent from `@openclaw/proxyline` plus its
 * managed-proxy TLS store — an OpenClaw workspace package and a host egress
 * subsystem, neither of which Fusion carries (the goal forbids depending on
 * OpenClaw packages). No ambient proxy agent is ever produced here.
 *
 * This is not silent: a caller that has a managed proxy configured and gets no
 * agent back is expected to fail loudly rather than send unproxied traffic —
 * the ported Feishu client does exactly that.
 */
export async function resolveAmbientNodeProxyAgent<TAgent>(_params?: {
  onError?: (error: unknown) => void;
  onUsingProxy?: () => void;
  protocol?: "http" | "https";
}): Promise<TAgent | undefined> {
  return undefined;
}
