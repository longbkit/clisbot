// COMPAT(clisbot-control-plane): the guarded remote-media read (slice 11b).
//
// An agent may hand the `message` tool an `http(s)` URL as a media source. That
// URL is model-authored input, so it is the one outbound media source the Hub
// itself dereferences, and it gets the same treatment the verticals give
// remote input they are handed: scheme check, DNS-answer check against the
// private-network policy, no redirect (a redirect is a second host the policy
// never saw), and a hard byte ceiling checked on `Content-Length` and again per
// chunk.
//
// The per-vertical `fusion/ssrf*.ts` boundaries stand in for the OpenClaw SDK
// subpath *inside a vertical's own transport*; this module is the Hub-side one
// and is the only place Hub code fetches a model-supplied URL. It buffers
// rather than streaming to disk because the caller stages the bytes itself
// (mime sniffing, extension repair); `media.ts` owns the streaming inbound half.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** RFC1918 / loopback / link-local / unique-local / CGNAT / metadata literals. */
export function isBlockedMediaAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return false;
}

function isBlockedIpv4(address: string): boolean {
  const [a = 0, b = 0] = address.split(".").map((part) => Number.parseInt(part, 10));
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return a === 100 && b >= 64 && b <= 127; // CGNAT
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80") || normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  // IPv4-mapped (`::ffff:10.0.0.1`) reaches the same networks.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  return mapped?.[1] !== undefined && isBlockedIpv4(mapped[1]);
}

/** A remote media URL the policy refuses, or whose bytes exceed the ceiling. */
export class RemoteMediaRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteMediaRefusedError";
  }
}

export interface RemoteMediaFetchParams {
  url: string;
  /** Hard byte ceiling; the channel's outbound cap. */
  maxBytes: number;
  fetchImpl?: typeof globalThis.fetch;
  /** Test seam: the resolver the guard asks. Defaults to `node:dns`. */
  lookupImpl?: typeof lookup;
  timeoutMs?: number;
}

export interface RemoteMedia {
  buffer: Buffer;
  contentType?: string;
  /** The last path segment, when the URL carries one. */
  fileName?: string;
}

/** Refuses the URL unless it is http(s) and every DNS answer is public. */
export async function assertRemoteMediaHostAllowed(
  url: string,
  lookupImpl: typeof lookup = lookup,
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RemoteMediaRefusedError(`remote media URL is not absolute: ${url}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new RemoteMediaRefusedError(
      `remote media must be http(s), got ${parsed.protocol.replace(":", "")}`,
    );
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    if (isBlockedMediaAddress(host)) {
      throw new RemoteMediaRefusedError(`remote media host is not allowed: ${host}`);
    }
    return parsed;
  }
  const answers = await lookupImpl(host, { all: true });
  if (answers.length === 0) {
    throw new RemoteMediaRefusedError(`remote media host does not resolve: ${host}`);
  }
  for (const answer of answers) {
    if (isBlockedMediaAddress(answer.address)) {
      throw new RemoteMediaRefusedError(`remote media host is not allowed: ${host}`);
    }
  }
  return parsed;
}

/** Reads a model-supplied remote media URL under the SSRF and size policy. */
export async function fetchRemoteMedia(params: RemoteMediaFetchParams): Promise<RemoteMedia> {
  const parsed = await assertRemoteMediaHostAllowed(params.url, params.lookupImpl);
  const fetchFn = params.fetchImpl ?? globalThis.fetch;
  const response = await fetchFn(params.url, {
    method: "GET",
    // The policy above checked ONE host. A redirect is a second host it never
    // saw, so no hop is followed unchecked.
    redirect: "error",
    ...(params.timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(params.timeoutMs) }),
  });
  if (!response.ok) {
    throw new RemoteMediaRefusedError(`remote media fetch failed: HTTP ${response.status}`);
  }
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > params.maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new RemoteMediaRefusedError(
      `remote media is ${declared} bytes, over the ${params.maxBytes}-byte limit`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  // Checked again on the bytes: a missing or lying `Content-Length` must not
  // get past the ceiling.
  if (buffer.byteLength > params.maxBytes) {
    throw new RemoteMediaRefusedError(
      `remote media is ${buffer.byteLength} bytes, over the ${params.maxBytes}-byte limit`,
    );
  }
  const fileName = parsed.pathname.split("/").findLast(Boolean);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
  return {
    buffer,
    ...(contentType ? { contentType } : {}),
    ...(fileName ? { fileName } : {}),
  };
}
