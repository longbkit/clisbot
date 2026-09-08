// upstream: src/logging/redact-identifier.ts@5d8067a4483
// Identifier redaction helpers replace sensitive identifiers with stable hashes.
import { normalizeOptionalString } from "../normalization-core/string-coerce.js";
import { sha256HexPrefixCore } from "../infra/crypto-digest.js";

/** Returns a stable sha256 hex prefix for non-secret identifier correlation. */
export function sha256HexPrefix(value: string, len = 12): string {
  const safeLen = Number.isFinite(len) ? Math.max(1, Math.floor(len)) : 12;
  return sha256HexPrefixCore(value, safeLen);
}

/** Redacts an identifier to a stable hash label, or "-" for missing values. */
export function redactIdentifier(value: string | undefined, opts?: { len?: number }): string {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) {
    return "-";
  }
  return `sha256:${sha256HexPrefix(trimmed, opts?.len ?? 12)}`;
}
