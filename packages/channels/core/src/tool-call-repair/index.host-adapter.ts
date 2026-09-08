// Fusion-owned host adapter for `packages/tool-call-repair/src/index.ts` (D-CORE-057).
//
// Upstream repairs models that emit tool calls as plain text inside the assistant
// message, stripping those blocks before the text is delivered. Paseo's providers
// deliver native tool calls, and the repair package carries its own grammar and
// stream normalizer; the port stops at this boundary and passes text through.
export type PlainTextToolCallBlock = { name: string; args: Record<string, unknown> };

export function stripPlainTextToolCallBlocks(
  text: string,
  _options?: unknown,
): string {
  return text;
}

export function parseStandalonePlainTextToolCallBlocks(
  _text: string,
  _options?: unknown,
): PlainTextToolCallBlock[] {
  return [];
}

/** Upstream's parse-option contract from `packages/tool-call-repair/src/contracts.ts`. */
export type PlainTextToolCallNameMatcher = (name: string) => boolean;
export type PlainTextToolCallProtectedRange = { start: number; end: number };
export type PlainTextToolCallProtectedRangeResolver = (
  text: string,
) => PlainTextToolCallProtectedRange[];
export type PlainTextToolCallParseOptions = {
  isToolName?: PlainTextToolCallNameMatcher;
  protectedRanges?: PlainTextToolCallProtectedRange[] | PlainTextToolCallProtectedRangeResolver;
  [key: string]: unknown;
};
