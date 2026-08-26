// Public npm registry access for the pinned OpenClaw supply (plan §14.4: public
// npm, no mirror). The integrity pin is the trust boundary; the registry only
// tells us where to fetch a tarball. We never trust registry metadata beyond the
// `dist.tarball` URL for the exact pinned version — the bytes are verified against
// `dist.integrity` before they touch the install dir.
//
// All registry I/O goes through `fetchTarball` so tests inject local bytes and the
// whole install path runs offline.

import type { ChannelPin, MainPin } from "./pins.js";

export class RegistryError extends Error {
  readonly status?: number;
  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "RegistryError";
    if (options?.status !== undefined) this.status = options.status;
  }
}

/** The abbreviated packument (install-v1) is small and still carries each
 * version's `dist.tarball` + `dist.integrity`. */
const ABBREV_HEADER: Record<string, string> = {
  accept: "application/vnd.npm.install-v1+json",
  "npm-version": "10.9.8",
};

/** Resolve the tarball URL for a pinned package from the registry. */
export async function resolveTarballUrl(
  registry: string,
  pin: MainPin | ChannelPin,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const base = registry.replace(/\/+$/u, "");
  const packumentUrl = `${base}/${pin.package.replace(/\//gu, "%2F")}`;
  const response = await fetchImpl(packumentUrl, { headers: ABBREV_HEADER });
  if (!response.ok) {
    throw new RegistryError(`registry lookup failed for ${pin.package}: ${response.status}`, {
      status: response.status,
    });
  }
  const doc = (await response.json()) as {
    versions?: Record<string, { dist?: { tarball?: string } }>;
  };
  const version = doc.versions?.[pin.version];
  const tarball = version?.dist?.tarball;
  if (typeof tarball !== "string") {
    throw new RegistryError(`no tarball recorded for ${pin.package}@${pin.version}`);
  }
  return tarball;
}

/** Fetch a pinned tarball. In tests this is replaced by a local-bytes provider. */
export async function fetchTarball(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const response = await fetchImpl(url);
  if (!response.ok)
    throw new RegistryError(`tarball fetch failed: ${response.status}`, {
      status: response.status,
    });
  return new Uint8Array(await response.arrayBuffer());
}
