// upstream: src/plugin-sdk/string-coerce-runtime.ts@5d8067a4483
// Browser-safe primitive coercion, normalization, and UTF-16 helpers for plugins.

export {
  hasNonEmptyString,
  localeLowercasePreservingWhitespace,
  lowercasePreservingWhitespace,
  normalizeFastMode,
  normalizeBoundedOptionalString,
  normalizeLowercaseStringOrEmpty,
  normalizeNullableString,
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
  normalizeOptionalStringifiedId,
  normalizeStringifiedEntries,
  normalizeStringifiedOptionalString,
  readNonBlankString,
  readNonEmptyStringPreservingWhitespace,
  readStringValue,
} from "../normalization-core/string-coerce.js";
// D-CORE-001: the upstream barrel also re-exports number-coercion,
// boolean/record/json coercion and the UTF-16 slice helpers. Slice 5 ports only
// the string-coercion group the formatting closure uses; see upstream-sync.json.
export { asOptionalRecord, isRecord } from "../normalization-core/record-coerce.js";

// Slice 9 additions (Telegram send/actions port): the ported send path also
// reads the record/number coercion and string-normalization helpers from this
// subpath. Same upstream barrel, same source modules.
export { asFiniteNumber } from "../normalization-core/number-coercion.js";
export { asNonArrayRecord } from "../normalization-core/record-coerce.js";
export {
  normalizeStringEntries,
  uniqueStrings,
} from "../normalization-core/string-normalization.js";

// Slice 10b additions (Slack send/actions port): the same upstream barrel, the
// string-normalization source module.
export {
  normalizeTrimmedStringList,
  sortUniqueStrings,
} from "../normalization-core/string-normalization.js";

// Slice 13 addition (Discord vertical port): the ported Discord action runtime
// coerces boolean-ish action params through upstream's `asBoolean`.
export { asBoolean } from "../utils/boolean.js";

// Slice 20 addition (Telegram inbound port): the ported update-offset
// persistence reads the safe-integer range coercion from the same barrel.
export { asSafeIntegerInRange } from "../normalization-core/number-coercion.js";

// Slice 14 addition (Google Chat vertical port): the ported google-auth
// transport reads agent/TLS options through upstream's nullable-object coercion.
export { asNullableObjectRecord } from "../normalization-core/record-coerce.js";


// Slice 15 addition (Feishu vertical port): the ported dedupe-key builder reads
// nullable record fields off a raw Lark envelope. Same upstream barrel, same
// source module (`packages/normalization-core/src/record-coerce.ts`).
export { asNullableRecord } from "../normalization-core/record-coerce.js";
