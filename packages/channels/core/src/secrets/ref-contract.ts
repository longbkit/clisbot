// Fusion-owned partial port of `src/secrets/ref-contract.ts` (D-CORE-335).
//
// Upstream's module is the full SecretRef grammar plus the default-provider
// resolution the host uses when it reads a credential. Fusion's Hub resolves
// credentials, so only the id/alias validators the ported secret-input schema
// references are carried; their bodies and messages are upstream's.
export const SECRET_PROVIDER_ALIAS_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const EXEC_SECRET_REF_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/;
const FILE_SECRET_REF_SEGMENT_PATTERN = /^[A-Za-z0-9._~!$&'()*+,;=:@%-]+$/;

/** Canonical id for file secret providers that expose exactly one value. */
export const SINGLE_VALUE_FILE_REF_ID = "value";

/** Failure class returned when an exec secret ref id is syntactically invalid. */
type ExecSecretRefIdValidationReason = "pattern" | "traversal-segment";

/** Result for callers that need to distinguish grammar failures from traversal attempts. */
type ExecSecretRefIdValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: ExecSecretRefIdValidationReason;
    };

/** Validates file secret ref ids against the shared JSON-pointer-style contract. */
export function isValidFileSecretRefId(value: string): boolean {
  if (value === SINGLE_VALUE_FILE_REF_ID) {
    return true;
  }
  if (!value.startsWith("/")) {
    return false;
  }
  // File refs mirror JSON Pointer segment escaping; keep this in parity with gateway/schema
  // patterns so config, plugin SDK, and remote gateway validation accept the same ids.
  return value
    .slice(1)
    .split("/")
    .every((segment) => FILE_SECRET_REF_SEGMENT_PATTERN.test(segment));
}

/** Validates a secret provider alias against the shared config/gateway grammar. */
export function isValidSecretProviderAlias(value: string): boolean {
  return SECRET_PROVIDER_ALIAS_PATTERN.test(value);
}

/** Validates exec secret ref ids and reports why invalid ids failed. */
export function validateExecSecretRefId(value: string): ExecSecretRefIdValidationResult {
  if (!EXEC_SECRET_REF_ID_PATTERN.test(value)) {
    return { ok: false, reason: "pattern" };
  }
  // The JSON schema uses a negative lookahead for traversal. Runtime validation keeps the same
  // rule explicit so UI/doctor flows can explain the safer failure class.
  for (const segment of value.split("/")) {
    if (segment === "." || segment === "..") {
      return { ok: false, reason: "traversal-segment" };
    }
  }
  return { ok: true };
}

/** Boolean convenience wrapper for callers that only need accept/reject behavior. */
export function isValidExecSecretRefId(value: string): boolean {
  return validateExecSecretRefId(value).ok;
}

/** Explains the exec secret ref id grammar in validation output. */
export function formatExecSecretRefIdValidationMessage(): string {
  return [
    "Exec secret reference id must match /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/",
    'and must not include "." or ".." path segments',
    '(example: "vault/openai/api-key" or "aws/secret#json_key").',
  ].join(" ");
}
