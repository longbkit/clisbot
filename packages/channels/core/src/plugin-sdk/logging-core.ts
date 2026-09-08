// upstream: src/plugin-sdk/logging-core.ts@5d8067a4483
// Logging primitives available to plugins.
export { redactSensitiveText } from "../logging/redact.js";
export { createSubsystemLogger } from "../logging/subsystem.js";
// D-CORE-214: the upstream barrel also re-exports the root logger, the
// diagnostic log sink and identifier redaction from `src/logger.ts`,
// `src/logging/diagnostic.ts`, `src/logging/logger.ts` and
// `src/logging/redact-identifier.ts`. Fusion's Hub owns logging (D-CORE-002,
// D-CORE-203).

// Slice 10b addition (Slack inbound-media port): the ported Slack media reader
// redacts a Slack file payload before logging it. Upstream's
// `redactToolPayloadText` forces tools-mode redaction and merges the user's
// `logging.redactPatterns` with the built-in defaults; Fusion's Hub owns
// logging config (D-CORE-002), so the carried `redactSensitiveText` is the
// tools-mode default with no user patterns to merge.
export { redactSensitiveText as redactToolPayloadText } from "../logging/redact.js";

// Slice 13 additions (Discord vertical port): the ported Discord REST error and
// route redactors call the identifier hash and the structured-field redactor
// from this same upstream barrel. `redactIdentifier` is upstream's verbatim
// module; `redactSensitiveFieldValue` is the narrowed one (D-CORE-002).
export { redactIdentifier, sha256HexPrefix } from "../logging/redact-identifier.js";
export { redactSensitiveFieldValue, isSensitiveFieldKey } from "../logging/redact.js";
