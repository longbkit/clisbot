// Fusion-owned host adapter for `src/agents/internal-runtime-context.ts` (D-CORE-023).
//
// Upstream strips OpenClaw's own `<runtime-context>` preamble (session, workspace
// and channel facts it injects into the model prompt) back out of model-authored
// text. Paseo's daemon never injects that preamble, so there is nothing to strip
// and the text passes through unchanged.

/** Opening delimiter for protected OpenClaw runtime context blocks. */
export const INTERNAL_RUNTIME_CONTEXT_BEGIN = "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>";
/** Closing delimiter for protected OpenClaw runtime context blocks. */
export const INTERNAL_RUNTIME_CONTEXT_END = "<<<END_OPENCLAW_INTERNAL_CONTEXT>>>";

export function stripInternalRuntimeContext(
  text: string,
  _options: { preserveSurroundingWhitespace?: boolean; separator?: string } = {},
): string {
  return text;
}
