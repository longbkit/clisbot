// upstream: src/plugin-sdk/webhook-ingress.ts@5d8067a4483
/**
 * Public SDK subpath for webhook ingress guards, targets, and request helpers.
 */
// D-CORE-322: the upstream barrel also re-exports the OpenClaw gateway auth
// rate limiter (`src/gateway/auth-rate-limit.ts`), the ws raw-data coercion, the
// plugin HTTP path normalizer and `registerPluginHttpRoute` — all bound to the
// OpenClaw gateway server (D-CORE-321). `resolveRequestClientIp` upstream first
// asks the gateway request scope for the already-validated client ip and only
// then falls back to the raw headers; Fusion has no gateway scope, so the
// header resolver IS the resolver, and it is declared here rather than pulled
// from the 575-line `src/gateway/net.ts`.
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { normalizeOptionalString } from "../normalization-core/string-coerce.js";

export {
  createBoundedCounter,
  createFixedWindowRateLimiter,
  createWebhookAnomalyTracker,
  WEBHOOK_ANOMALY_COUNTER_DEFAULTS,
  WEBHOOK_ANOMALY_STATUS_CODES,
  WEBHOOK_RATE_LIMIT_DEFAULTS,
  type BoundedCounter,
  type FixedWindowRateLimiter,
  type WebhookAnomalyTracker,
} from "./webhook-memory-guards.js";
export {
  applyBasicWebhookRequestGuards,
  beginWebhookRequestPipelineOrReject,
  createWebhookInFlightLimiter,
  isJsonContentType,
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  readJsonWebhookBodyOrReject,
  readWebhookBodyOrReject,
  requestBodyErrorToText,
  runDetachedWebhookWork,
  WEBHOOK_BODY_READ_DEFAULTS,
  WEBHOOK_IN_FLIGHT_DEFAULTS,
  type WebhookBodyReadProfile,
  type WebhookInFlightLimiter,
} from "./webhook-request-guards.js";
export {
  canonicalizeWebhookRouteKey,
  registerWebhookTarget,
  resolveSingleWebhookTarget,
  resolveSingleWebhookTargetAsync,
  normalizeWebhookPath,
  resolveWebhookPath,
  resolveWebhookTargetWithAuthOrReject,
  resolveWebhookTargetWithAuthOrRejectSync,
  resolveWebhookTargets,
  withResolvedWebhookRequestPipeline,
  type RegisterWebhookTargetOptions,
  type RegisteredWebhookTarget,
  type WebhookTargetMatchResult,
} from "./webhook-targets.js";
export { DEFAULT_WEBHOOK_MAX_BODY_BYTES } from "../infra/http-body.js";

/**
 * The request's client ip for rate-limit keying.
 *
 * This is upstream's `resolveClientIp` algorithm (`src/gateway/net.ts`), which
 * FAILS CLOSED: a request arriving from a configured trusted proxy that carries
 * no usable client-origin header resolves to `undefined`, not to the proxy's own
 * address, so unrelated requests behind one proxy cannot share a bucket. With no
 * `trustedProxies` configured the socket address is the answer and headers are
 * ignored, so a spoofed `x-forwarded-for` cannot buy a fresh bucket.
 *
 * `trustedProxies` entries are CIDRs or plain addresses.
 */
export function resolveRequestClientIp(
  req?: IncomingMessage,
  trustedProxies?: string[],
  allowRealIpFallback = false,
): string | undefined {
  if (!req) return undefined;
  const remote = parseIpLiteral(req.socket?.remoteAddress);
  if (remote === undefined) return undefined;
  if (!isTrustedProxyAddress(remote, trustedProxies)) return remote;
  const forwarded = resolveForwardedClientIp({
    forwardedFor: headerValue(req.headers?.["x-forwarded-for"]),
    ...(trustedProxies === undefined ? {} : { trustedProxies }),
  });
  if (forwarded !== undefined) return forwarded;
  if (allowRealIpFallback) return parseIpLiteral(headerValue(req.headers?.["x-real-ip"]));
  return undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function stripOptionalPort(ip: string): string {
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end !== -1) return ip.slice(1, end);
  }
  if (isIP(ip)) return ip;
  const lastColon = ip.lastIndexOf(":");
  if (lastColon > -1 && ip.includes(".") && ip.indexOf(":") === lastColon) {
    const candidate = ip.slice(0, lastColon);
    if (isIP(candidate) === 4) return candidate;
  }
  return ip;
}

function parseIpLiteral(raw: string | undefined): string | undefined {
  const trimmed = normalizeOptionalString(raw);
  if (trimmed === undefined) return undefined;
  const stripped = stripOptionalPort(trimmed);
  // IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is how a dual-stack socket reports an
  // IPv4 peer; upstream's `normalizeIpAddress` unwraps it before matching.
  const unwrapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(stripped)?.[1] ?? stripped;
  return isIP(unwrapped) === 0 ? undefined : unwrapped.toLowerCase();
}

function isLoopbackAddress(ip: string): boolean {
  return ip === "::1" || ip.startsWith("127.");
}

function resolveForwardedClientIp(params: {
  forwardedFor?: string;
  trustedProxies?: string[];
}): string | undefined {
  if (params.trustedProxies === undefined || params.trustedProxies.length === 0) return undefined;
  const chain: string[] = [];
  for (const entry of params.forwardedFor?.split(",") ?? []) {
    const normalized = parseIpLiteral(entry);
    if (normalized !== undefined) chain.push(normalized);
  }
  // Walk right-to-left and return the first untrusted hop.
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const hop = chain[index];
    if (hop === undefined || isLoopbackAddress(hop)) continue;
    if (!isTrustedProxyAddress(hop, params.trustedProxies)) return hop;
  }
  return undefined;
}

/**
 * D-CORE-322: upstream matches through `@openclaw/net-policy`'s `isIpInCidr`.
 * The workspace package is not carried, so the CIDR match is declared here for
 * the two families a proxy entry can name; a bare address matches exactly.
 */
export function isTrustedProxyAddress(
  ip: string | undefined,
  trustedProxies?: string[],
): boolean {
  const normalized = parseIpLiteral(ip);
  if (normalized === undefined || trustedProxies === undefined) return false;
  return trustedProxies.some((proxy) => {
    const candidate = proxy.trim();
    if (candidate === "") return false;
    const slash = candidate.indexOf("/");
    if (slash === -1) return parseIpLiteral(candidate) === normalized;
    const network = parseIpLiteral(candidate.slice(0, slash));
    const bits = Number.parseInt(candidate.slice(slash + 1), 10);
    if (network === undefined || !Number.isInteger(bits) || bits < 0) return false;
    const family = isIP(network);
    if (family !== isIP(normalized)) return false;
    const width = family === 4 ? 32 : 128;
    if (bits > width) return false;
    return ipToBits(normalized, family).slice(0, bits) === ipToBits(network, family).slice(0, bits);
  });
}

function ipToBits(ip: string, family: number): string {
  if (family === 4) {
    return ip
      .split(".")
      .map((part) => (Number.parseInt(part, 10) & 0xff).toString(2).padStart(8, "0"))
      .join("");
  }
  const groups = expandIpv6(ip);
  return groups.map((group) => group.toString(2).padStart(16, "0")).join("");
}

function expandIpv6(ip: string): number[] {
  const [head = "", tail = ""] = ip.split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === "" ? [] : tail.split(":");
  const fill = ip.includes("::") ? 8 - headGroups.length - tailGroups.length : 0;
  return [...headGroups, ...Array.from({ length: fill }, () => "0"), ...tailGroups].map((group) =>
    Number.parseInt(group === "" ? "0" : group, 16),
  );
}
