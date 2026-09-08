// Fusion-owned host adapter for `src/config/types.secrets.ts` (D-CORE-256).
//
// Upstream's module is the SecretRef contract plus the resolution state machine
// that reads env/file/exec/store providers through OpenClaw's secret runtime and
// its gateway snapshot. Fusion's Hub owns credentials and resolves them before a
// drive-time `cfg` reaches a vertical, so a channel config field is either a
// literal string (available) or a still-unresolved reference (absent). The
// `SecretRef` predicate and the three readers the ported Slack account/token
// code calls keep upstream's names, signatures and bodies over that rule.
import { isRecord } from "../normalization-core/record-coerce.js";
import { normalizeOptionalString } from "../normalization-core/string-coerce.js";

export type SecretRefSource = "env" | "file" | "exec" | "store";

/** Upstream's env secret-reference id grammar, unchanged. */
export const ENV_SECRET_REF_ID_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

/** A configured but unresolved reference to a secret held by a provider. */
export type SecretRef = {
  source: SecretRefSource;
  provider: string;
  id: string;
};

/** A secret-bearing config field: a literal value or a provider reference. */
export type SecretInput = string | SecretRef;

/** Provider/source defaults applied to a partially spelled reference. */
export type SecretDefaults = {
  source?: SecretRefSource;
  provider?: string;
};

export function isSecretRef(value: unknown): value is SecretRef {
  if (!isRecord(value)) {
    return false;
  }
  if (Object.keys(value).length !== 3) {
    return false;
  }
  return (
    (value.source === "env" ||
      value.source === "file" ||
      value.source === "exec" ||
      value.source === "store") &&
    typeof value.provider === "string" &&
    value.provider.trim().length > 0 &&
    typeof value.id === "string" &&
    value.id.trim().length > 0
  );
}

/** Trim a literal secret input string while leaving non-string inputs unresolved. */
export function normalizeSecretInputString(value: unknown): string | undefined {
  return normalizeOptionalString(value);
}

/** True when the field carries a literal value or a well-formed reference. */
export function hasConfiguredSecretInput(value: unknown, _defaults?: SecretDefaults): boolean {
  if (normalizeSecretInputString(value)) {
    return true;
  }
  return isSecretRef(value);
}

/**
 * The resolved literal for a secret field, or undefined when it is still a
 * reference. Upstream resolves the reference here against the active runtime
 * snapshot; in Fusion the Hub has already substituted resolved credentials into
 * the drive-time config, so a remaining reference is genuinely unavailable.
 */
export function normalizeResolvedSecretInputString(params: {
  value: unknown;
  refValue?: unknown;
  defaults?: SecretDefaults;
  path: string;
}): string | undefined {
  return normalizeSecretInputString(params.value);
}

/** Resolution outcome for a secret-bearing config field. */
export type SecretInputStringResolution =
  | { status: "available"; value: string; ref: null }
  | { status: "configured_unavailable"; value: undefined; ref: SecretRef }
  | { status: "missing"; value: undefined; ref: null };

export type SecretInputStringResolutionMode = "strict" | "inspect";

/**
 * Upstream resolves the reference against the active secret providers; in Fusion
 * the Hub substitutes resolved credentials into the drive-time config, so a
 * literal is available, a remaining `SecretRef` is configured-but-unavailable,
 * and anything else is missing. `mode` is accepted for source compatibility: an
 * unresolved reference is never a throw here, because the Hub — not the vertical
 * — owns credential resolution.
 */
export function resolveSecretInputString(params: {
  value: unknown;
  refValue?: unknown;
  defaults?: SecretDefaults;
  path: string;
  mode?: SecretInputStringResolutionMode;
}): SecretInputStringResolution {
  const normalized = normalizeSecretInputString(params.value);
  if (normalized) {
    return { status: "available", value: normalized, ref: null };
  }
  const ref = isSecretRef(params.value)
    ? params.value
    : isSecretRef(params.refValue)
      ? params.refValue
      : undefined;
  if (ref) {
    return { status: "configured_unavailable", value: undefined, ref };
  }
  return { status: "missing", value: undefined, ref: null };
}

/**
 * Slice 15 addition (Feishu vertical port). Upstream coerces canonical refs plus
 * the `${ENV:NAME}` shorthand a hand-written `config.json` may use; the Hub
 * compiles channel config and never emits that shorthand, so only the canonical
 * shape is recognized here.
 */
export function coerceSecretRef(value: unknown, _defaults?: SecretDefaults): SecretRef | null {
  return isSecretRef(value) ? value : null;
}

/**
 * Slice 15 addition (Feishu vertical port), upstream
 * `src/plugin-sdk/secret-ref-readonly.internal.ts`. Upstream answers whether a
 * read-only path may resolve an env-sourced reference itself, by consulting the
 * host's configured secret providers and their allowlists. In Fusion the Hub
 * owns secret providers and substitutes resolved credentials into the
 * drive-time config, so a vertical never borrows an ambient process env var: a
 * reference that survived into the vertical is unavailable.
 */
export function canResolveEnvSecretRefInReadOnlyPath(_params: {
  cfg?: unknown;
  provider: string;
  id: string;
}): boolean {
  return false;
}
