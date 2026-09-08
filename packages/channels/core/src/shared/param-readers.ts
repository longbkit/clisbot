// Fusion-owned boundary for the `src/agents/tools/common.ts` param readers (D-CORE-210).
//
// Upstream's `common.ts` is the shared agent-tool helper module (tool results,
// sandbox path normalization, gateway argument coercion, media params). The
// channel-action helpers need only the string reader below; it is copied from
// that module.
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options?: { trim?: boolean },
): string | undefined {
  const value = params[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = options?.trim === false ? value : value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readStringOrNumberParam(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return readStringParam(params, key);
}
