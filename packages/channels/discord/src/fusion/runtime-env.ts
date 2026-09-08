// Fusion-owned boundary for the theme half of
// `openclaw/plugin-sdk/runtime-env` (D-DC-005).
//
// Upstream's barrel exports `warn` / `danger` / `info` / `success` as *theme
// formatters* (chalk-backed `(text) => string`) alongside the verbose logging
// helpers; a ported file writes `runtime.error(danger("..."))`. Core's carried
// `globals.ts` is Fusion-owned and exports them as logger calls instead
// (D-CORE-203). This module keeps the barrel's shape for the Discord files that
// use the formatter spelling — the same adapter the Slack vertical ships.
export * from "@getpaseo/channels-core/plugin-sdk/runtime-env";

/** Theme formatter. The Hub's logger owns presentation, so the text passes through. */
export function warn(text: string): string {
  return text;
}

/** Theme formatter. See `warn`. */
export function danger(text: string): string {
  return text;
}

/** Theme formatter. See `warn`. */
export function info(text: string): string {
  return text;
}

/** Theme formatter. See `warn`. */
export function success(text: string): string {
  return text;
}
