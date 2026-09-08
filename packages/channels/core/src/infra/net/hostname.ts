// upstream: src/infra/net/hostname.ts@5d8067a4483
// Hostname normalization helpers keep SSRF and proxy policy comparisons stable
// across case, trailing dots, and bracketed IPv6 literals.
import { normalizeLowercaseStringOrEmpty } from "../../normalization-core/string-coerce.js";

/** Normalize a hostname for policy comparisons. */
export function normalizeHostname(hostname: string): string {
  const normalized = normalizeLowercaseStringOrEmpty(hostname).replace(/\.+$/, "");
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}
