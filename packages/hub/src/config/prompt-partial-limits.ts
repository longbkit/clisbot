/**
 * Prompt partial limits, kept free of node imports so the browser editor and the
 * server boundary schema can share the same numbers as the resolver.
 */

export const PROMPT_PARTIAL_ROOT = ".paseo/workflows";
export const MAX_PROMPT_PARTIAL_COUNT = 100;
export const MAX_PROMPT_PARTIAL_PATH_LENGTH = 512;
export const MAX_PROMPT_PARTIAL_CONTENT_BYTES = 1_000_000;
export const MAX_PROMPT_PARTIAL_BUNDLE_BYTES = 5_000_000;
