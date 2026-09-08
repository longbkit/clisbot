// upstream: packages/gateway-protocol/src/protocol-value-normalization.ts@5d8067a4483
export {
  asNullableRecord as asProtocolRecord,
  isRecord as isProtocolRecord,
} from "../normalization-core/record-coerce.js";
export { normalizeOptionalString as normalizeOptionalProtocolString } from "../normalization-core/string-coerce.js";

/** Checks string presence without changing wire-significant whitespace. */
export function isNonEmptyProtocolString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
