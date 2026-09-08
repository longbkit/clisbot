// upstream: src/plugin-sdk/boolean-param.ts@5d8067a4483
// Boolean parameter helpers parse plugin-facing string flags into stable booleans.
import { parseBoolean } from "../normalization-core/boolean-coercion.js";
import { readSnakeCaseParamRaw } from "../param-key.js";

/** Read boolean or string params from exact or snake_case tool-input keys. */
export function readBooleanParam(
  params: Record<string, unknown>,
  key: string,
): boolean | undefined {
  return parseBoolean(readSnakeCaseParamRaw(params, key));
}
