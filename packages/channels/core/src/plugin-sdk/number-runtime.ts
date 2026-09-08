// upstream: src/plugin-sdk/number-runtime.ts@5d8067a4483
// Numeric coercion helpers for plugin runtimes.
export {
  addTimerTimeoutGraceMs,
  asFiniteNumber,
  clampPositiveTimerTimeoutMs,
  clampTimerTimeoutMs,
  finiteSecondsToTimerSafeMilliseconds,
  isFutureDateTimestampMs,
  MAX_TIMER_TIMEOUT_MS,
  nonNegativeSecondsToSafeMilliseconds,
  parseFiniteNumber,
  parseStrictFiniteNumber,
  parseStrictInteger,
  parseStrictNonNegativeInteger,
  parseStrictPositiveInteger,
  resolveExpiresAtMsFromDurationMs,
} from "../normalization-core/number-coercion.js";
// D-CORE-215: the upstream barrel also re-exports the byte/duration formatters
// (`packages/normalization-core/src/format.ts`) and the TCP port helpers
// (`src/infra/tcp-port.ts`), which the ported channel closure does not use.

// Slice 10b addition (Slack thread port): the Date-range timestamp coercion the
// ported Slack thread reader uses, from the same source module.
export { asDateTimestampMs } from "../normalization-core/number-coercion.js";
// Slice 13 addition (Discord vertical port): the Date-range ceiling the ported
// Discord REST rate-limit tests assert against.
export { MAX_DATE_TIMESTAMP_MS } from "../normalization-core/number-coercion.js";

// Slice 13 additions (Discord vertical port): the ported Discord REST scheduler,
// gateway, chunker, guild sender and monitor formatter read these from the same
// upstream barrel and the same source module.
export {
  asFiniteNumberInRange,
  asSafeIntegerInRange,
  parseDateStringTimestampMs,
  resolveDateTimestampMs,
  resolveIntegerOption,
  resolveTimerTimeoutMs,
  timestampMsToIsoString,
} from "../normalization-core/number-coercion.js";
