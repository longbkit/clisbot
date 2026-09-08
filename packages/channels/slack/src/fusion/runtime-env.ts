// Fusion-owned boundary for the theme half of
// `openclaw/plugin-sdk/runtime-env` (D-033).
//
// Upstream's barrel exports `warn` / `danger` / `info` / `success` as *theme
// formatters* (chalk-backed `(text) => string`) alongside the verbose logging
// helpers; a ported file writes `runtime.log(warn("..."))`. Core's carried
// `globals.ts` is Fusion-owned and exports `warn` as a logger call instead
// (D-CORE-203), which every other ported file already uses that way. This
// module keeps the barrel's shape for the Slack files that use the formatter
// spelling: everything comes from core, except the formatters, which are the
// identity function — the Hub logger owns colour.
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
